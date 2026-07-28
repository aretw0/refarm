// The connection probe loop — bring a declared connection up and decide readiness by
// ASKING THE SYSTEM, never by matching a string in the process's output.
//
// This mirrors `browser-driver`'s `awaitLoginDetected(probe, signals)`: the probe decides,
// the signals inform. Output here produces only human notices; a missed notice can never
// make a connection wrongly considered up or down.
//
// Both the process (a channel of output chunks) and the probe (a closure) are INJECTED, so
// this whole loop is unit-tested with no real process and no real command.

use std::sync::Arc;

use tokio::sync::{mpsc, Notify};
// `Duration` is already in scope here: this file is `include!`d into the flattened
// `host_effects_bridge` module, which imports it via `core.rs`'s
// `use tokio::time::{timeout, Duration};`. A second `use tokio::time::Duration;` would
// collide (E0252) — only `Instant` is genuinely missing.
use tokio::time::Instant;

// `NativeSync` is already in scope here via `connection_frames.rs`'s
// `use crate::sync::NativeSync;` — a second import would collide (E0252).

/// Cap on the accumulated notice-match buffer. A chatty process must not grow host memory.
pub(crate) const MAX_CONNECTION_BUFFER: usize = 64 * 1024;

#[derive(Debug)]
pub(crate) enum EstablishOutcome {
    /// The probe succeeded. The process is LEFT RUNNING — it holds the connection.
    Ready,
    /// The probe never succeeded within `ready_timeout_ms`. The process was stopped.
    Timeout,
    /// The process ended before the probe succeeded. It is already gone.
    Exit,
}

/// A live process reduced to what the loop needs: raw output chunks in order, and a way to
/// stop it. Injectable — a test drives it with a channel.
pub(crate) struct FlowProcess {
    /// Raw stdout+stderr chunks. The channel closing means the process ended.
    pub(crate) chunks: mpsc::Receiver<String>,
    /// Notifying this stops the process and its group.
    pub(crate) stop: Arc<Notify>,
}

/// Keep the buffer bounded while preserving its TAIL, so a marker arriving after a flood is
/// still matchable.
fn push_bounded(buffer: &mut String, chunk: &str) {
    buffer.push_str(chunk);
    if buffer.len() > MAX_CONNECTION_BUFFER {
        let mut cut = buffer.len() - MAX_CONNECTION_BUFFER;
        while cut < buffer.len() && !buffer.is_char_boundary(cut) {
            cut += 1;
        }
        buffer.drain(..cut);
    }
}

/// Bring the connection up: poll the probe on its interval, publishing notices matched in
/// the output along the way, until the probe succeeds, the process ends, or the deadline
/// passes.
pub(crate) async fn establish(
    decl: &ConnectionDeclaration,
    process: &mut FlowProcess,
    probe: &mut (dyn FnMut() -> bool + Send),
    publisher: &mut ConnectionFramePublisher,
    sync: &NativeSync,
    now_ns: &(dyn Fn() -> u64 + Sync),
) -> Result<EstablishOutcome, String> {
    let mut buffer = String::new();
    let mut fired: Vec<bool> = vec![false; decl.notices.len()];
    let interval = Duration::from_millis(decl.probe_interval_ms.max(1));
    let deadline = Instant::now() + Duration::from_millis(decl.ready_timeout_ms.max(1) as u64);
    let mut ended = false;

    let outcome = loop {
        if probe() {
            break EstablishOutcome::Ready;
        }
        // The probe is the only authority, so an ended process is only decisive AFTER a
        // final probe: a connect command may exit once the tunnel is established by a
        // daemon it handed off to.
        if ended {
            break EstablishOutcome::Exit;
        }
        if Instant::now() >= deadline {
            break EstablishOutcome::Timeout;
        }

        // Drain whatever output arrived within this probe interval, publishing notices.
        // Clamped to `deadline`: without this, a slice can outlast the ready-timeout by up
        // to one full `probe_interval_ms` — the outer loop only re-checks the deadline
        // AFTER this inner drain returns, so an unclamped slice lets `establish` block past
        // `ready_timeout_ms`.
        let slice_end = (Instant::now() + interval).min(deadline);
        loop {
            let remaining = slice_end.saturating_duration_since(Instant::now());
            if remaining.is_zero() {
                break;
            }
            match tokio::time::timeout(remaining, process.chunks.recv()).await {
                Err(_) => break,          // interval elapsed — go probe again
                Ok(None) => {             // the process ended
                    ended = true;
                    break;
                }
                Ok(Some(chunk)) => {
                    push_bounded(&mut buffer, &chunk);
                    for (i, rule) in decl.notices.iter().enumerate() {
                        if !fired[i] && rule.pattern.is_match(&buffer) {
                            fired[i] = true;
                            publisher.notice(sync, &rule.message, now_ns())?;
                        }
                    }
                }
            }
        }
    };

    let (reason, detail) = match &outcome {
        EstablishOutcome::Ready => ("ready", String::new()),
        EstablishOutcome::Timeout => (
            "timeout",
            format!("probe did not succeed within {}ms", decl.ready_timeout_ms),
        ),
        EstablishOutcome::Exit => (
            "exit",
            "the establish process ended before the probe succeeded".to_string(),
        ),
    };
    publisher.terminal(sync, reason, &detail, now_ns())?;

    // Ready LEAVES the process running (it holds the connection). Anything else stops it —
    // a failed attempt must never leak a live process.
    if !matches!(outcome, EstablishOutcome::Ready) {
        process.stop.notify_waiters();
    }

    Ok(outcome)
}

// ── The shared registry ──────────────────────────────────────────────────────
//
// A connection is a NAMED, HOST-OWNED, SHARED resource. Callers do not hold processes;
// they hold claims on a name. One live instance per declared name exists by construction —
// asking for a connection that is already up performs NO second login, which for the Serpro
// VPN means no second push on the operator's phone.

// `HashMap` is already in scope here: this file is `include!`d into the flattened
// `host_effects_bridge` module, which imports it via `connection_decl.rs`'s
// `use std::collections::HashMap;`. A second `use std::collections::HashMap;` would
// collide (E0252).
use std::sync::Mutex;

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum ConnectionStatus {
    Down,
    Connecting,
    Up,
    Failed,
}

/// A caller's interest in a live connection.
#[derive(Debug, Clone)]
pub(crate) struct Claim {
    pub(crate) id: u64,
    pub(crate) name: String,
}

struct LiveConnection {
    status: ConnectionStatus,
    /// Stop handle for the held process; `None` once it is gone.
    stop: Option<Arc<Notify>>,
    /// (claim id, owner).
    claims: Vec<(u64, String)>,
    /// How many times a process was actually spawned — the sharing guarantee is asserted
    /// on this.
    spawn_count: u32,
    linger: Linger,
}

pub(crate) struct ConnectionRegistry {
    live: Mutex<HashMap<String, LiveConnection>>,
    next_claim_id: std::sync::atomic::AtomicU64,
}

impl ConnectionRegistry {
    pub(crate) fn new() -> Self {
        Self {
            live: Mutex::new(HashMap::new()),
            next_claim_id: std::sync::atomic::AtomicU64::new(1),
        }
    }

    pub(crate) fn status(&self, name: &str) -> ConnectionStatus {
        self.live
            .lock()
            .expect("connection registry poisoned")
            .get(name)
            .map(|c| c.status.clone())
            .unwrap_or(ConnectionStatus::Down)
    }

    pub(crate) fn spawn_count(&self, name: &str) -> u32 {
        self.live
            .lock()
            .expect("connection registry poisoned")
            .get(name)
            .map(|c| c.spawn_count)
            .unwrap_or(0)
    }

    pub(crate) fn claim_count(&self, name: &str) -> usize {
        self.live
            .lock()
            .expect("connection registry poisoned")
            .get(name)
            .map(|c| c.claims.len())
            .unwrap_or(0)
    }

    fn issue_claim(&self, name: &str, owner: &str) -> Claim {
        let id = self.next_claim_id.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        let mut live = self.live.lock().expect("connection registry poisoned");
        if let Some(entry) = live.get_mut(name) {
            entry.claims.push((id, owner.to_string()));
        }
        Claim { id, name: name.to_string() }
    }

    /// Idempotent. Already up ⇒ a new claim and NO new login. Down ⇒ establish once.
    #[allow(clippy::too_many_arguments)]
    pub(crate) async fn ensure(
        &self,
        name: &str,
        owner: &str,
        decls: &HashMap<String, ConnectionDeclaration>,
        spawn: impl FnOnce(&ConnectionDeclaration) -> Result<FlowProcess, String>,
        probe: &mut (dyn FnMut() -> bool + Send),
        sync: &NativeSync,
        now_ns: &(dyn Fn() -> u64 + Sync),
    ) -> Result<Claim, String> {
        let decl = decls.get(name).ok_or_else(|| {
            format!("no connection named '{name}' is declared in .refarm/config.json")
        })?;

        // Fast path: already up. This is the whole point of sharing.
        if matches!(self.status(name), ConnectionStatus::Up) {
            return Ok(self.issue_claim(name, owner));
        }

        {
            let mut live = self.live.lock().expect("connection registry poisoned");
            let entry = live.entry(name.to_string()).or_insert_with(|| LiveConnection {
                status: ConnectionStatus::Down,
                stop: None,
                claims: Vec::new(),
                spawn_count: 0,
                linger: decl.linger.clone(),
            });
            entry.status = ConnectionStatus::Connecting;
            entry.spawn_count += 1;
        }

        let mut process = spawn(decl)?;
        let stop = process.stop.clone();
        let mut publisher = ConnectionFramePublisher::new(name, now_ns());
        let outcome = establish(decl, &mut process, probe, &mut publisher, sync, now_ns).await?;

        {
            let mut live = self.live.lock().expect("connection registry poisoned");
            let entry = live.get_mut(name).expect("entry inserted above");
            match outcome {
                EstablishOutcome::Ready => {
                    entry.status = ConnectionStatus::Up;
                    entry.stop = Some(stop);
                }
                EstablishOutcome::Timeout => {
                    entry.status = ConnectionStatus::Failed;
                    entry.stop = None;
                    return Err(format!(
                        "connection '{name}' did not become ready within {}ms",
                        decl.ready_timeout_ms
                    ));
                }
                EstablishOutcome::Exit => {
                    entry.status = ConnectionStatus::Failed;
                    entry.stop = None;
                    return Err(format!(
                        "connection '{name}' did not become ready: the establish process ended first"
                    ));
                }
            }
        }

        Ok(self.issue_claim(name, owner))
    }

    /// Drop one claim. Whether the connection itself falls is the DECLARATION's linger
    /// policy, never the caller's choice.
    pub(crate) fn release(&self, claim: &Claim) {
        let mut live = self.live.lock().expect("connection registry poisoned");
        if let Some(entry) = live.get_mut(&claim.name) {
            entry.claims.retain(|(id, _)| *id != claim.id);
            Self::apply_linger(entry);
        }
    }

    /// Release every claim held by an owner — called when a plugin is unloaded or revoked,
    /// so interest can never outlive its holder.
    pub(crate) fn release_owner(&self, owner: &str) {
        let mut live = self.live.lock().expect("connection registry poisoned");
        for entry in live.values_mut() {
            entry.claims.retain(|(_, o)| o != owner);
            Self::apply_linger(entry);
        }
    }

    /// `Linger::Operator` (the default) keeps a connection up once established:
    /// re-establishing costs a human interruption, holding costs nearly nothing. A
    /// non-zero `Idle` window is swept by the caller, not here.
    fn apply_linger(entry: &mut LiveConnection) {
        if !entry.claims.is_empty() {
            return;
        }
        if let Linger::Idle { ms: 0 } = entry.linger {
            if let Some(stop) = entry.stop.take() {
                stop.notify_waiters();
            }
            entry.status = ConnectionStatus::Down;
        }
    }
}
