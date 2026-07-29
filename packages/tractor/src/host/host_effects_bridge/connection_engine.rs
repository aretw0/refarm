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
#[derive(Debug)]
pub(crate) struct FlowProcess {
    /// Raw stdout+stderr chunks. The channel closing means the process ended.
    pub(crate) chunks: mpsc::Receiver<String>,
    /// Signalling this stops the process and its group. See `signal_stop`.
    pub(crate) stop: Arc<Notify>,
}

// These surfaces are complete and fully unit-tested, but nothing in the crate CALLS them
// yet: the consumer is the `host-connection` WIT surface, which is a later plan. Marked
// `allow(dead_code)` for the non-test build ONLY — the test build still audits them — so the
// crate stays warning-clean and a genuinely new warning is not buried under twenty of these.

/// Signal a process to stop, in the ONE way that cannot be lost.
///
/// `Notify::notify_waiters` stores no permit: it wakes whoever is already registered and
/// drops the signal on the floor otherwise. The killer task registers LATE — it is a
/// `tokio::spawn`ed task inside `spawn_establish_process`, and on the fast failure paths
/// there is no `.await` between the spawn returning and the first stop, so on a
/// current-thread runtime the task has not been polled yet. The signal vanished and the
/// SIGKILL never fired: a live VPN process with nothing left able to signal it.
///
/// `notify_one` DOES store a permit, so a stop signalled before the killer task first polls
/// still kills the process. One permit is exactly right — there is exactly one killer task
/// per `FlowProcess`, and one kill is enough.
#[cfg_attr(not(test), allow(dead_code))]
pub(crate) fn signal_stop(stop: &Notify) {
    stop.notify_one();
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
///
/// The probe is generic over a FUTURE-returning closure, not a synchronous `bool`. The real
/// probe (`run_probe`) is `async` — it spawns a process and awaits it — so a synchronous
/// signature could only be bridged with `block_on`, which blocks a worker thread and panics
/// outright on a current-thread runtime. Making the loop `await` the probe is what lets the
/// two halves of this engine actually compose.
#[cfg_attr(not(test), allow(dead_code))]
pub(crate) async fn establish<P, F>(
    decl: &ConnectionDeclaration,
    process: &mut FlowProcess,
    probe: &mut P,
    publisher: &mut ConnectionFramePublisher,
    sync: &NativeSync,
    now_ns: &(dyn Fn() -> u64 + Sync),
) -> Result<EstablishOutcome, String>
where
    P: FnMut() -> F + Send,
    F: std::future::Future<Output = bool> + Send,
{
    let mut buffer = String::new();
    // ONCE PER ATTEMPT, deliberately — not once per occurrence. Matching is over the
    // ACCUMULATED buffer, so once a pattern has matched it keeps matching on every later
    // chunk: resetting this flag would announce the same single occurrence again on every
    // subsequent line, a notice storm rather than a repeat. A genuine per-occurrence repeat
    // (which a push-approval retry would deserve) needs occurrence COUNTING, and counting
    // has to survive `push_bounded` dropping the buffer's head — that is a separate piece of
    // work, not a flag flip. Until then the contract is one announcement per attempt.
    let mut fired: Vec<bool> = vec![false; decl.notices.len()];
    let interval = Duration::from_millis(decl.probe_interval_ms.max(1));
    let deadline = Instant::now() + Duration::from_millis(decl.ready_timeout_ms.max(1) as u64);
    let mut ended = false;

    let outcome = loop {
        if probe().await {
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
                            // A publisher failure here still ends the attempt — this early
                            // return must not skip the stop-the-process step below, or a
                            // just-spawned real child leaks with nothing left able to
                            // signal it (it never reaches the loop's own Ready/Timeout/Exit
                            // outcome, so the `if !matches!(outcome, Ready)` guard further
                            // down is never even evaluated for this path).
                            if let Err(e) = publisher.notice(sync, &rule.message, now_ns()) {
                                signal_stop(&process.stop);
                                return Err(e);
                            }
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
    // A publisher failure here must ALSO stop the process, even when `outcome` is `Ready`:
    // `establish` returning `Err` at all makes the caller (`ensure`) treat this attempt as
    // failed and disown the process (see `mark_failed`), so leaving it running because the
    // outcome was technically Ready would strand it — nothing would retain a way to stop it.
    if let Err(e) = publisher.terminal(sync, reason, &detail, now_ns()) {
        signal_stop(&process.stop);
        return Err(e);
    }

    // Ready LEAVES the process running (it holds the connection). Anything else stops it —
    // a failed attempt must never leak a live process.
    if !matches!(outcome, EstablishOutcome::Ready) {
        signal_stop(&process.stop);
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
    /// How many times a process was ACTUALLY spawned — the sharing guarantee is asserted
    /// on this. Only incremented once `spawn` has returned `Ok`; an attempt that errored
    /// before a process existed is not a login and must not be counted as one.
    spawn_count: u32,
    linger: Linger,
}

pub(crate) struct ConnectionRegistry {
    live: Mutex<HashMap<String, LiveConnection>>,
    /// One establish gate per connection name, acquired before spawning and held across
    /// the whole establish attempt. This is what makes `ensure` single-flight: without it,
    /// two callers racing a Down connection both pass the `Up` fast path below and both
    /// spawn — for the Serpro VPN that is two logins, i.e. two pushes on the operator's
    /// phone. Deliberately `tokio::sync::Mutex`, not `std::sync::Mutex`: this one is held
    /// across `.await`, which a `std::sync::Mutex` guard must never be.
    gates: Mutex<HashMap<String, Arc<tokio::sync::Mutex<()>>>>,
    next_claim_id: std::sync::atomic::AtomicU64,
}

#[cfg_attr(not(test), allow(dead_code))]
impl ConnectionRegistry {
    pub(crate) fn new() -> Self {
        Self {
            live: Mutex::new(HashMap::new()),
            gates: Mutex::new(HashMap::new()),
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

    /// The gate that serializes establish attempts for one connection name. Fetched (or
    /// created) under the metadata lock only long enough to clone the `Arc` — that lock is
    /// dropped before the returned `tokio::sync::Mutex` is ever locked, so a `.await` on it
    /// never happens while the `std::sync::Mutex` guard is held.
    fn establish_gate(&self, name: &str) -> Arc<tokio::sync::Mutex<()>> {
        let mut gates = self.gates.lock().expect("connection registry poisoned");
        gates
            .entry(name.to_string())
            .or_insert_with(|| Arc::new(tokio::sync::Mutex::new(())))
            .clone()
    }

    /// An establish attempt is over and did not reach `Ready`. Every early return out of
    /// `ensure` after the transition to `Connecting` — spawn failing, `establish` erroring,
    /// timeout, exit — must land here so `status` never reports `Connecting` forever.
    ///
    /// Whatever `stop` handle the entry is holding is notified BEFORE it is cleared: a
    /// connection marked failed by any route must also stop its process, from any caller —
    /// disowning a live process without signalling it first is exactly how one leaks.
    fn mark_failed(&self, name: &str) {
        let mut live = self.live.lock().expect("connection registry poisoned");
        if let Some(entry) = live.get_mut(name) {
            entry.status = ConnectionStatus::Failed;
            if let Some(stop) = entry.stop.take() {
                signal_stop(&stop);
            }
        }
    }

    /// A cached `Up` is only the MEMORY of a probe that succeeded once. A tunnel can drop
    /// with nothing telling the registry, and there is no supervisor re-checking it yet, so
    /// every fast path that would hand out a claim on a cached `Up` re-asks the system
    /// first. A stale entry is marked failed (which also stops whatever it was still
    /// holding) and the caller falls through to a fresh establish.
    ///
    /// Returns `true` when the connection is genuinely up right now.
    async fn revalidate_up<P, F>(&self, name: &str, probe: &mut P) -> bool
    where
        P: FnMut() -> F + Send,
        F: std::future::Future<Output = bool> + Send,
    {
        if !matches!(self.status(name), ConnectionStatus::Up) {
            return false;
        }
        if probe().await {
            return true;
        }
        self.mark_failed(name);
        false
    }

    /// Idempotent. Already up ⇒ a new claim and NO new login. Down ⇒ establish once — and
    /// AT MOST once even under concurrent callers, via the per-name establish gate.
    #[allow(clippy::too_many_arguments)]
    pub(crate) async fn ensure<P, F>(
        &self,
        name: &str,
        owner: &str,
        decls: &HashMap<String, ConnectionDeclaration>,
        spawn: impl FnOnce(&ConnectionDeclaration) -> Result<FlowProcess, String>,
        probe: &mut P,
        sync: &NativeSync,
        now_ns: &(dyn Fn() -> u64 + Sync),
    ) -> Result<Claim, String>
    where
        P: FnMut() -> F + Send,
        F: std::future::Future<Output = bool> + Send,
    {
        let decl = decls.get(name).ok_or_else(|| {
            format!("no connection named '{name}' is declared in .refarm/config.json")
        })?;

        // Fast path: already up. This is the whole point of sharing — but the cached status
        // is re-verified against the SYSTEM before a claim is issued on it.
        if self.revalidate_up(name, probe).await {
            return Ok(self.issue_claim(name, owner));
        }

        // Serialize establish attempts for this name. Held across every await below: two
        // callers racing a Down connection must not both spawn — for the Serpro VPN a
        // second spawn is a second login, i.e. a second push on the operator's phone.
        let gate = self.establish_gate(name);
        let _permit = gate.lock().await;

        // Re-check now that we hold the gate: another caller may have finished
        // establishing it while we were waiting, in which case we share it — no spawn.
        if self.revalidate_up(name, probe).await {
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
        }

        let mut process = match spawn(decl) {
            Ok(process) => process,
            Err(e) => {
                // `?` here would skip straight past the Failed-setting block below and
                // leave `status` stuck at `Connecting` forever.
                self.mark_failed(name);
                return Err(e);
            }
        };

        // A process now genuinely exists — THIS is what `spawn_count` counts, never an
        // attempt that errored before one did.
        {
            let mut live = self.live.lock().expect("connection registry poisoned");
            if let Some(entry) = live.get_mut(name) {
                entry.spawn_count += 1;
            }
        }

        let stop = process.stop.clone();
        // `new` RESUMES the connection's stream: the frame cursor continues from the last
        // published sequence so a consumer following this name never sees it go backwards.
        let mut publisher = ConnectionFramePublisher::new(sync, name, now_ns());
        let outcome = match establish(decl, &mut process, &mut *probe, &mut publisher, sync, now_ns).await {
            Ok(outcome) => outcome,
            Err(e) => {
                // Same hazard as the spawn error above: `?` would leave `status` stuck at
                // `Connecting`.
                self.mark_failed(name);
                return Err(e);
            }
        };

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

    /// Release a claim identified only by its id — the shape the `host-connection`
    /// WIT surface hands back to a plugin: `release: func(claim: u64)` carries no
    /// connection name (D7 — as little as possible crosses the boundary), unlike
    /// the native `Claim{id, name}` `release` above. Claim ids are minted from ONE
    /// registry-wide counter (`next_claim_id`), so they are unique across every
    /// declared connection — a linear scan over the (capped at `MAX_CONNECTIONS`)
    /// live entries finds the right one. Lenient like `release`: an unknown or
    /// already-released id is a harmless no-op, never an error — a plugin's
    /// shutdown path must not fail on a stale claim.
    pub(crate) fn release_by_id(&self, claim_id: u64) {
        let mut live = self.live.lock().expect("connection registry poisoned");
        for entry in live.values_mut() {
            if entry.claims.iter().any(|(id, _)| *id == claim_id) {
                entry.claims.retain(|(id, _)| *id != claim_id);
                Self::apply_linger(entry);
                return;
            }
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
                signal_stop(&stop);
            }
            entry.status = ConnectionStatus::Down;
        }
    }
}

// ── The real adapters ────────────────────────────────────────────────────────
//
// Both reuse the SAME guards a batch `spawn` passes: a declared connection is another door
// in the same corridor, never an exemption from the machine's own policy.

/// Probe timeout. A health check that hangs must not stall the probe loop; the loop's own
/// deadline owns the overall failure.
const PROBE_TIMEOUT_MS: u32 = 5_000;

/// Ask the SYSTEM whether the connection is up. Success is exit code 0 AND, when `expect`
/// is declared, the combined output matching it. Any error means "not up" — a probe that
/// cannot run is not evidence of health.
#[cfg_attr(not(test), allow(dead_code))]
pub(crate) async fn run_probe(decl: &ConnectionDeclaration, policy: &HostEffectPolicy) -> bool {
    let Ok((stdout, stderr, exit_code, timed_out)) = spawn_process(
        &decl.probe.run,
        &decl.env,
        decl.cwd.as_deref(),
        PROBE_TIMEOUT_MS,
        None,
        policy,
    )
    .await
    else {
        return false;
    };
    if timed_out || exit_code != 0 {
        return false;
    }
    let Some(expect) = decl.probe.expect.as_ref() else {
        return true;
    };
    let mut text = String::from_utf8_lossy(&stdout).to_string();
    text.push_str(&String::from_utf8_lossy(&stderr));
    expect.is_match(&text)
}

/// Decode as much of `pending` as valid UTF-8, returning the decoded text and any leftover
/// bytes that must be carried into the next read. `pending` is the concatenation of any
/// leftover from a prior call plus the newly-read bytes.
///
/// A truncated trailing sequence (the tail ran out of bytes mid-character — exactly what
/// happens when a multi-byte character straddles two OS-level reads) is carried over intact
/// rather than corrupted. A tail that is genuinely invalid (not merely truncated) is instead
/// flushed via lossy decoding immediately — more bytes would never make garbage valid, and
/// holding it back would stall the notice pipeline forever.
fn split_utf8_prefix(pending: Vec<u8>) -> (String, Vec<u8>) {
    match String::from_utf8(pending) {
        Ok(text) => (text, Vec::new()),
        Err(e) => {
            let incomplete_tail = e.utf8_error().error_len().is_none();
            let valid_up_to = e.utf8_error().valid_up_to();
            let mut bytes = e.into_bytes();
            let rest = bytes.split_off(valid_up_to);
            let text = String::from_utf8(bytes).expect("valid_up_to bounds a valid UTF-8 prefix");
            if incomplete_tail {
                (text, rest)
            } else {
                let mut text = text;
                text.push_str(&String::from_utf8_lossy(&rest));
                (text, Vec::new())
            }
        }
    }
}

/// Spawn the establish argv and stream its merged stdout+stderr into a `FlowProcess`.
/// Unlike `spawn_process`, nothing here kills on a timeout: a connection is SUPPOSED to
/// outlive the call. The bounds are the probe loop's deadline, then the registry's
/// claim/linger policy, then the explicit stop signal.
#[cfg_attr(not(test), allow(dead_code))]
pub(crate) fn spawn_establish_process(
    decl: &ConnectionDeclaration,
    policy: &HostEffectPolicy,
) -> Result<FlowProcess, String> {
    enforce_shell_allowlist(&decl.establish, policy)?;
    enforce_spawn_env(&decl.env)?;
    if let Some(dir) = decl.cwd.as_deref() {
        enforce_spawn_cwd(dir, policy)?;
    }

    let mut cmd = tokio::process::Command::new(&decl.establish[0]);
    cmd.args(&decl.establish[1..])
        .env_clear()
        .envs(decl.env.iter().map(|(k, v)| (k.as_str(), v.as_str())))
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .stdin(std::process::Stdio::null())
        // Own process group, so stopping the connection kills any grandchild it forked
        // instead of leaving an orphan reparented to init — the same reason
        // `spawn_process` does this.
        .process_group(0);
    if let Some(dir) = decl.cwd.as_deref() {
        cmd.current_dir(dir);
    }

    let mut child = cmd.spawn().map_err(|e| {
        format!("connection '{}': spawn({}): {e}", decl.name, decl.establish[0])
    })?;

    let (tx, rx) = tokio::sync::mpsc::channel::<String>(64);

    // Pump stdout and stderr into ONE ordered stream — a login's meaningful lines land on
    // either pipe and must be seen interleaved as they arrive.
    let mut readers: Vec<Box<dyn tokio::io::AsyncRead + Unpin + Send>> = Vec::new();
    if let Some(out) = child.stdout.take() {
        readers.push(Box::new(out));
    }
    if let Some(err) = child.stderr.take() {
        readers.push(Box::new(err));
    }
    for mut reader in readers {
        let tx = tx.clone();
        tokio::spawn(async move {
            let mut buf = [0u8; 4096];
            // A multi-byte character (the notices this engine matches are Portuguese with
            // accents and emoji, e.g. "📲 Aprove a conexão…") can straddle two OS-level
            // reads. Decoding each 4096-byte read independently with `from_utf8_lossy`
            // would corrupt the split character into replacement chars on BOTH sides of
            // the boundary — so an incomplete trailing sequence is held here and prefixed
            // onto the next read instead.
            let mut pending: Vec<u8> = Vec::new();
            loop {
                match tokio::io::AsyncReadExt::read(&mut reader, &mut buf).await {
                    Ok(0) | Err(_) => {
                        // The process ended (or the pipe broke) with an incomplete tail
                        // still buffered — flush it lossily rather than silently dropping
                        // the last bytes a dying process wrote.
                        if !pending.is_empty() {
                            let _ = tx.send(String::from_utf8_lossy(&pending).to_string()).await;
                        }
                        break;
                    }
                    Ok(n) => {
                        pending.extend_from_slice(&buf[..n]);
                        let (text, rest) = split_utf8_prefix(std::mem::take(&mut pending));
                        pending = rest;
                        if !text.is_empty() && tx.send(text).await.is_err() {
                            break;
                        }
                    }
                }
            }
        });
    }
    drop(tx);

    let stop = Arc::new(Notify::new());
    let stop_for_task = stop.clone();
    tokio::spawn(async move {
        stop_for_task.notified().await;
        kill_process_group(&mut child).await;
    });

    Ok(FlowProcess { chunks: rx, stop })
}
