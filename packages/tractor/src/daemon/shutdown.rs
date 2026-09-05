//! Which signal asked this node to stop, and the ONE path both of them take.
//!
//! Until this module existed the daemon handled `tokio::signal::ctrl_c()` and
//! nothing else — SIGINT only. That made the SAFE way to stop this node the
//! MANUAL one: Ctrl-C was graceful, while `systemctl stop`, `cron`, or any
//! supervisor — all of which send SIGTERM — was a hard kill. Exactly backwards
//! for a node anyone would want to restart on a schedule.
//!
//! Both signals now resolve into the same `ShutdownSignal` and are handed to the
//! same `drain_for_shutdown`. "SIGTERM is treated exactly like SIGINT" is
//! therefore a property of the code — there is one path, and the signal is an
//! ARGUMENT to it — not a claim in a comment. The signal's only privilege is to
//! name itself in the log, because an operator debugging a restart needs to know
//! whether something asked politely or a supervisor timed out.
//!
//! SIGTERM is a POSIX fact, so `wait()` has a `#[cfg(unix)]` body and a
//! `#[cfg(not(unix))]` one. The non-unix body keeps the SAME shape (one
//! `first_signal` call) with a terminate arm that never resolves, so the Windows
//! build compiles the same control flow rather than a second implementation.

use std::future::Future;

/// Which signal asked. Carried, never branched on: nothing downstream is allowed
/// to treat one as more graceful than the other.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ShutdownSignal {
    /// Ctrl-C, or anything else sending SIGINT.
    Interrupt,
    /// SIGTERM — what `systemctl stop`, a cron wrapper, or any supervisor sends.
    Terminate,
}

impl ShutdownSignal {
    pub(crate) fn label(self) -> &'static str {
        match self {
            Self::Interrupt => "SIGINT",
            Self::Terminate => "SIGTERM",
        }
    }
}

/// Whichever arrives first, named. Split out from `wait` so the selection is
/// testable without installing a process-global signal handler.
pub(crate) async fn first_signal(
    interrupt: impl Future<Output = ()>,
    terminate: impl Future<Output = ()>,
) -> ShutdownSignal {
    tokio::select! {
        _ = interrupt => ShutdownSignal::Interrupt,
        _ = terminate => ShutdownSignal::Terminate,
    }
}

/// Block until this process is asked to stop.
#[cfg(unix)]
pub(crate) async fn wait() -> ShutdownSignal {
    use tokio::signal::unix::{signal, SignalKind};

    // A SIGTERM handler that cannot be installed is a degradation, not a reason
    // to stop serving: fall back to the SIGINT-only behaviour this daemon had
    // before, and say so once, loudly, so the operator knows a scheduled restart
    // of THIS process would be a hard kill.
    let mut terminate = match signal(SignalKind::terminate()) {
        Ok(stream) => stream,
        Err(error) => {
            tracing::warn!(
                %error,
                "could not install a SIGTERM handler — this node will shut down gracefully on SIGINT only"
            );
            let _ = tokio::signal::ctrl_c().await;
            return ShutdownSignal::Interrupt;
        }
    };

    first_signal(
        async {
            let _ = tokio::signal::ctrl_c().await;
        },
        async move {
            terminate.recv().await;
        },
    )
    .await
}

/// Same shape, minus a signal the platform does not have: the terminate arm can
/// never resolve, so `Interrupt` is the only outcome — stated by construction
/// instead of by a second, divergent implementation.
#[cfg(not(unix))]
pub(crate) async fn wait() -> ShutdownSignal {
    first_signal(
        async {
            let _ = tokio::signal::ctrl_c().await;
        },
        std::future::pending::<()>(),
    )
    .await
}

/// The one shutdown path. Closes the effort gate, waits out whatever is in
/// flight within the bound those efforts themselves declared, and reports.
/// Returns `None` when this daemon runs no sidecar: with no effort store there
/// is nothing that could be in flight, and the shutdown is the one it always was.
pub(crate) async fn drain_for_shutdown(
    signal: ShutdownSignal,
    drain: Option<&crate::sidecar::drain::ShutdownDrain>,
) -> Option<crate::sidecar::drain::DrainReport> {
    let Some(drain) = drain else {
        tracing::info!(
            signal = signal.label(),
            "shutdown: no effort store attached to this daemon — nothing to drain"
        );
        return None;
    };
    let report = drain.run().await;
    report.log(signal.label());
    Some(report)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    #[tokio::test]
    async fn whichever_signal_arrives_first_names_itself() {
        let terminated = first_signal(std::future::pending::<()>(), async {}).await;
        assert_eq!(terminated, ShutdownSignal::Terminate);
        assert_eq!(terminated.label(), "SIGTERM");

        let interrupted = first_signal(async {}, std::future::pending::<()>()).await;
        assert_eq!(interrupted, ShutdownSignal::Interrupt);
        assert_eq!(interrupted.label(), "SIGINT");
    }

    /// A real SIGTERM, raised at this process, must resolve `wait()` — the wiring
    /// itself, not just the selection above.
    ///
    /// The stream is created HERE first and held for the whole test: tokio
    /// installs its handler when a stream is constructed and never restores the
    /// default disposition, so by the time `raise` runs, SIGTERM provably cannot
    /// terminate the test binary.
    ///
    /// `#[ignore]`, and run ONLY through `a_real_sigterm_resolves_the_wait` below, in a
    /// child process. A signal is process-global: raised inside the shared `cargo test`
    /// binary it reached every server any other test had waiting on `wait()` at that
    /// instant — the WS handshake audit test saw its server vanish between two guesses
    /// (`ConnectionRefused`) on the cold Tractor coverage gate of PR #59, 2026-08-30,
    /// while locally the schedules never overlapped. The same doctrine ws_server already
    /// states for `std::env::set_var`: process-global effects do not belong in a shared
    /// test process.
    #[cfg(unix)]
    #[ignore = "raises a real SIGTERM at its process — run by a_real_sigterm_resolves_the_wait in a child"]
    #[tokio::test]
    async fn a_real_sigterm_resolves_the_wait_in_this_process() {
        let _installed = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
            .expect("install the SIGTERM handler before raising one");

        let waiting = tokio::spawn(wait());
        // Let the spawned task reach its first poll, where it registers its own stream.
        tokio::time::sleep(Duration::from_millis(100)).await;

        // SAFETY: `raise` is async-signal-safe and the handler above is installed,
        // so this delivers to tokio's handler instead of killing the process.
        unsafe {
            libc::raise(libc::SIGTERM);
        }

        let signal = tokio::time::timeout(Duration::from_secs(5), waiting)
            .await
            .expect("SIGTERM must wake the shutdown wait")
            .expect("the wait task must not panic");
        assert_eq!(signal, ShutdownSignal::Terminate);
    }

    /// The real-signal case above, run where a real signal can only reach itself: this
    /// same test binary, relaunched as a child for exactly that one ignored test.
    #[cfg(unix)]
    #[test]
    fn a_real_sigterm_resolves_the_wait() {
        let exe = std::env::current_exe().expect("the test binary knows its own path");
        let output = std::process::Command::new(exe)
            .args([
                "--exact",
                "daemon::shutdown::tests::a_real_sigterm_resolves_the_wait_in_this_process",
                "--ignored",
                "--test-threads=1",
            ])
            .output()
            .expect("relaunch the test binary for the signal case");
        assert!(
            output.status.success(),
            "the in-process SIGTERM case failed in its child process (status {:?})\n--- stdout ---\n{}\n--- stderr ---\n{}",
            output.status,
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr),
        );
        assert!(
            String::from_utf8_lossy(&output.stdout).contains("test result: ok. 1 passed"),
            "the child must have RUN the ignored case, not filtered it out:\n{}",
            String::from_utf8_lossy(&output.stdout),
        );
    }

    /// Both signals reach the same drain, and the drain does the same thing.
    /// Nothing downstream may branch on which one arrived.
    #[tokio::test]
    async fn sigterm_and_sigint_take_the_same_path() {
        let on_sigint = drain_for_shutdown(ShutdownSignal::Interrupt, None).await;
        let on_sigterm = drain_for_shutdown(ShutdownSignal::Terminate, None).await;
        assert_eq!(on_sigint, on_sigterm, "no drain without a sidecar, either way");

        let tmp = tempfile::tempdir().expect("tempdir");
        let state = crate::sidecar::SidecarState::for_test(tmp.path(), ":memory:")
            .expect("sidecar state");
        let drain = crate::sidecar::drain::ShutdownDrain::for_state(&state);

        let on_sigint = drain_for_shutdown(ShutdownSignal::Interrupt, Some(&drain))
            .await
            .expect("a sidecar-backed daemon reports its drain");
        let on_sigterm = drain_for_shutdown(ShutdownSignal::Terminate, Some(&drain))
            .await
            .expect("a sidecar-backed daemon reports its drain");
        assert_eq!(
            on_sigint, on_sigterm,
            "SIGTERM must produce exactly the shutdown SIGINT produces"
        );
        assert_eq!(on_sigint.verdict(), "drained");
    }
}
