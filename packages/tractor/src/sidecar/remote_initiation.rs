//! STARTING one of refarm's own wizards from a device — the third piece of R4.
//!
//! Design: `docs/superpowers/specs/2026-07-31-composable-onboarding-and-remote-initiation-design.md`
//! (R4, R5). Two of the three pieces already existed: the pending-prompt hub carries a
//! wizard's QUESTIONS to whatever the operator is attending on (`pending_prompt.rs`), and
//! the declaration of which operations a device may start already exists in TypeScript
//! (`apps/refarm/src/commands/remote-initiation.ts`, R5). What was missing was a route to
//! START one. This is that route, and it is deliberately the dumbest part of the mechanism.
//!
//! ## THE RULE THIS MODULE EXISTS TO KEEP: Rust never constructs a command line
//!
//! The security decision — *which* of refarm's operations a device may start — is a table in
//! TypeScript (`REMOTELY_INITIABLE_OPERATIONS`), it has a mutation-verified test suite, and
//! it is enforced by `resolveRemoteInitiation`, whose only path to `ok: true` is an exact hit
//! in that table. Re-expressing any part of it here would create a second answer to one
//! question, and two answers to a security question diverge — not immediately, which is what
//! makes it dangerous, but at the first entry somebody adds to one side.
//!
//! So this module knows NOTHING about operations. It accepts an **opaque string**, hands that
//! string to the one fixed entrypoint as ONE argv element, and relays the entrypoint's own
//! verdict. Concretely:
//!
//! ```text
//!   POST /operations  {"operation": "<opaque>"}
//!        ⇒ spawn:  <refarm>  auth  remote  run  <opaque>
//!                  └──────┘  └──────────────┘  └────────┘
//!                  resolved     3 CONSTANTS     the caller's bytes, verbatim,
//!                  binary                       in exactly one element, always
//! ```
//!
//! [`start_invocation`] is a pure function and the ONLY producer of that argv. It never
//! splits, joins, trims, quotes or interpolates: the argument vector has a CONSTANT LENGTH
//! whatever the caller sends, so `"delivery add; rm -rf ~"` is one nonsense operation id that
//! the TypeScript table refuses, not two commands. The tests assert that length over
//! adversarial inputs, which is the mutation-verifiable form of the rule — replace the single
//! `push` with a splitting call and they fail.
//!
//! Nothing here ever runs a command interpreter, and a source-text guard in the test module
//! asserts it: exactly ONE process constructor exists in this file, it is fed the resolved
//! entrypoint path, and none of the spellings a command line would need appears anywhere. A
//! rule the compiler cannot check is checked by reading the source.
//!
//! ## Device-only, by silence
//!
//! No entry is added to [`super::auth::route_requirement`] for these routes, and that IS the
//! decision: a route that declares no scope admits device credentials only. A browser's
//! `prompt:answer` credential may ANSWER the farm's questions; it may never START work. This
//! costs one line of code (zero) and is proved by `a_scoped_credential_cannot_start_anything`,
//! which drives the real `listener_router` over a real socket.
//!
//! ## The bound, stated
//!
//! An unbounded spawn surface reachable from the network is the failure to avoid, so both
//! routes are counted:
//!
//!   - [`MAX_STARTED_OPERATIONS`] = **1**. One remotely-started wizard at a time. Not an
//!     arbitrary number: a wizard's whole interface is its questions, they all land in ONE
//!     pending-prompt list, and two wizards' questions interleaved on a phone screen cannot be
//!     told apart by who asked. A second start is refused `409` while one is live.
//!   - [`MAX_CATALOG_READS`] = **1**. A catalog read is a short-lived child that prints and
//!     exits; one at a time makes this surface non-amplifying.
//!
//! So this surface can hold at most **two** `refarm` children, ever. Both slots are RAII
//! guards ([`StartSlot`], [`CatalogSlot`]) released by `Drop`, so every refusal path, every
//! `?`, and the child's own exit free the slot without anybody remembering to.
//!
//! ## The three refusals, kept apart
//!
//! Collapsing "I do not know that" into "I will not do that" into "I could not" is the
//! distinction this codebase makes everywhere else, so:
//!
//!   - **`unknown-operation`** (404) — the id names no command this CLI has. TypeScript's
//!     judgement, relayed.
//!   - **`not-remotely-invocable`** (403) — the id names a real command that did not declare
//!     itself remotely initiable. TypeScript's judgement, relayed. Silence is closed (R5).
//!   - **`could-not-start`** (503) — the node could not get as far as an answer: no `refarm`
//!     on the declared `spawnEnv.path`, a malformed `spawnEnv`, a spawn that failed, or a
//!     child that produced no verdict before [`VERDICT_DEADLINE_MS`].
//!
//! and, beside them, `already-running` (409, the ceiling) and the gate's own `401` for a
//! credential that is not a device. Five distinguishable answers, never one.
//!
//! ## Where the entrypoint comes from — the operator's own declaration
//!
//! `refarm` is resolved by scanning `spawnEnv.path` (`.refarm/config.json`, P10) in DECLARED
//! ORDER for an executable of that name. Not the daemon's ambient `PATH`, which P10 refuses to
//! inherit for exactly this reason, and not a compiled-in guess.
//!
//! The invariant this buys is worth stating: **the node starts a `refarm` that the wizard's
//! own `PATH` can resolve**, because it is the same list. One declaration, one search order,
//! visible in the operator's own config. A node whose `spawnEnv.path` names no `refarm`
//! refuses with `could-not-start` and says so — it does not silently fall back to whatever the
//! daemon happened to inherit.
//!
//! ## A wizard must not learn it was started remotely
//!
//! Nothing distinguishing travels: the argv is the table's own constant, the environment is
//! the SAME derived spawn environment `connections` uses ([`SpawnEnvDecl::injected_vars`] over
//! `env_clear`), the cwd is the daemon's own, and there is no marker option and no marker
//! variable. There is nothing here to leak, which is stronger than a rule saying not to leak
//! it. The wizard's questions reach the operator through the pending-prompt hub because the
//! CLI already publishes there — that path is untouched.
//!
//! ## The held-open stdin, which is this module's `PromptTicket::Drop`
//!
//! The child's stdin is a PIPE the daemon holds open and never writes to. That is not an
//! oversight; it is the lifeline:
//!
//!   - a wizard's terminal side (`createTerminalOperatorChannel`) reads stdin and simply never
//!     gets a line, so the question is settled by whoever answers it on the hub — the remote
//!     side of the same peered channel a local wizard uses;
//!   - `Stdio::null()` would instead deliver EOF, which `askLine` turns into
//!     `OperatorPromptCancelledError`, which kills the wizard before anyone sees the question;
//!   - and when the DAEMON goes away the write end closes, the wizard gets that same EOF, and
//!     it ends. A remotely-started wizard therefore cannot outlive the node that started it —
//!     the same guarantee `PromptTicket`'s `Drop` gives a pending question, obtained the same
//!     way: by a handle whose destruction IS the withdrawal.
//!
//! ## What this module never does
//!
//! It does not read the child's output beyond ONE verdict line (bounded by
//! [`MAX_VERDICT_LINES`] and [`MAX_VERDICT_BYTES`]) and never logs a byte of it. Streaming a
//! command's output back to the initiating device is explicitly out of this slice — "the
//! wizard's questions are its interface" — and a drain that discarded into a log would smuggle
//! it back in, secrets and all.

use std::{
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    time::Duration,
};

use axum::{
    extract::{Path as AxumPath, State},
    http::StatusCode,
    response::IntoResponse,
    Json,
};
use serde_json::Value;
use tokio::io::{AsyncBufReadExt, AsyncReadExt, BufReader};

use super::SidecarState;
use crate::host::{spawn_env_from_config_at, SpawnEnvDecl};

// ── wire constants ─────────────────────────────────────────────────────────────────────

/// Wire discriminator for this surface, and for the verdict line the entrypoint prints.
/// `REMOTE_INITIATION_WIRE` in `apps/refarm/src/commands/auth-remote.ts` is the other half.
pub(crate) const REMOTE_INITIATION_WIRE: &str = "remote-initiation.v1";

/// The route. Registered from this constant (`sidecar_routes` names it) and DELIBERATELY
/// absent from `auth::route_requirement`, which is what makes it device-only.
pub(crate) const ROUTE_OPERATIONS: &str = "/operations";

/// The binary the node starts. A bare file name, looked for only inside `spawnEnv.path`.
pub(crate) const REFARM_ENTRYPOINT: &str = "refarm";

/// The ONE subcommand a device can cause to run. Three constants; nothing derives them.
pub(crate) const START_SUBCOMMAND: [&str; 3] = ["auth", "remote", "run"];

/// The catalog read — "what may be started here". Also constants, also nothing derived: a
/// `GET` carries no body and this route reads none.
pub(crate) const CATALOG_SUBCOMMAND: [&str; 3] = ["auth", "remote", "--json"];

// ── the bound ──────────────────────────────────────────────────────────────────────────

/// One remotely-started wizard at a time. See the module header for why the number is 1.
pub(crate) const MAX_STARTED_OPERATIONS: usize = 1;

/// One catalog read at a time.
pub(crate) const MAX_CATALOG_READS: usize = 1;

/// How long the entrypoint has to say whether it started. Generous, because a cold Node
/// process on a small node is seconds, not milliseconds — and bounded, because a child that
/// says nothing is a child nobody can account for.
pub(crate) const VERDICT_DEADLINE_MS: u64 = 20_000;

/// How long a catalog read may take before it is killed and reported as unavailable.
pub(crate) const CATALOG_DEADLINE_MS: u64 = 20_000;

/// Ceilings on how much of a child's stdout is read looking for the verdict. A child that
/// floods stdout must not be able to make the daemon buffer it.
pub(crate) const MAX_VERDICT_LINES: usize = 64;
pub(crate) const MAX_VERDICT_BYTES: usize = 16 * 1024;

/// Ceiling on the catalog document. `refarm auth remote --json` prints a small envelope;
/// anything past this is not that.
pub(crate) const MAX_CATALOG_BYTES: usize = 256 * 1024;

// ── the invocation: the one place an argv is produced ───────────────────────────────────

/// A program and its arguments — never a command LINE. Nothing in this type is ever handed
/// to a command interpreter, and nothing in it is ever concatenated into one.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Invocation {
    pub(crate) program: PathBuf,
    pub(crate) args: Vec<String>,
}

/// THE argv, and the whole of Rust's contribution to it.
///
/// PURE, and shaped so the rule is a property of the code rather than a promise: three
/// constants, then the caller's bytes as ONE element. `args.len()` is 4 for every possible
/// input — `""`, `"a b c"`, `"x; rm -rf ~"`, a megabyte of newlines — because the only
/// operation performed on `operation` is a single `push` of the whole string.
pub(crate) fn start_invocation(entrypoint: &Path, operation: &str) -> Invocation {
    let mut args: Vec<String> = START_SUBCOMMAND.iter().map(|token| token.to_string()).collect();
    args.push(operation.to_string());
    Invocation {
        program: entrypoint.to_path_buf(),
        args,
    }
}

/// The catalog argv. Constants only — this one has no input at all.
pub(crate) fn catalog_invocation(entrypoint: &Path) -> Invocation {
    Invocation {
        program: entrypoint.to_path_buf(),
        args: CATALOG_SUBCOMMAND.iter().map(|token| token.to_string()).collect(),
    }
}

// ── resolving the entrypoint from the operator's declaration ────────────────────────────

/// Find `refarm` in the operator's declared `spawnEnv.path`, in DECLARED ORDER.
///
/// PURE over the declaration plus one probe, so the search order is testable without a
/// filesystem — and so the ONLY filesystem question asked is "is this exact path an
/// executable file", never "what does the ambient PATH say".
pub(crate) fn find_entrypoint(
    path_entries: &[String],
    is_executable: impl Fn(&Path) -> bool,
) -> Option<PathBuf> {
    for dir in path_entries {
        let candidate = Path::new(dir).join(REFARM_ENTRYPOINT);
        if is_executable(&candidate) {
            return Some(candidate);
        }
    }
    None
}

/// An executable regular file at this exact path. Follows symlinks (`metadata`, not
/// `symlink_metadata`) because `~/.local/bin/refarm` is very often one.
fn is_executable_file(path: &Path) -> bool {
    use std::os::unix::fs::PermissionsExt;
    match std::fs::metadata(path) {
        Ok(meta) => meta.is_file() && meta.permissions().mode() & 0o111 != 0,
        Err(_) => false,
    }
}

/// The spawn environment and the entrypoint, resolved together — they come from the same
/// declaration and a node that has one without the other cannot start anything.
///
/// Resolved per initiation rather than cached at boot, deliberately: an operator who adds
/// `~/.local/bin` to `spawnEnv.path` in order to make this work should not have to restart
/// their node to find out whether it worked. The cost is one small file read, bounded by the
/// same ceiling that bounds the spawns themselves.
fn resolve_entrypoint() -> Result<(SpawnEnvDecl, PathBuf), String> {
    let base = std::env::current_dir().unwrap_or_default();
    let spawn_env = spawn_env_from_config_at(&base)?;
    if spawn_env.path.is_empty() {
        return Err(format!(
            "this node declares no spawnEnv.path in .refarm/config.json, so it has no \
             search order in which to find `{REFARM_ENTRYPOINT}` — and it will not fall back \
             to whatever the daemon inherited"
        ));
    }
    match find_entrypoint(&spawn_env.path, is_executable_file) {
        Some(entrypoint) => Ok((spawn_env, entrypoint)),
        None => Err(format!(
            "no executable `{REFARM_ENTRYPOINT}` on this node's declared spawnEnv.path \
             ({} entries) — declare the directory that holds it in .refarm/config.json",
            spawn_env.path.len()
        )),
    }
}

// ── the bound, as slots ────────────────────────────────────────────────────────────────

/// What is running, for the one refusal that names it.
#[derive(Debug, Clone, Default)]
struct Slots {
    /// `Some` while a start is in flight. The inner `Option<String>` is the operation's
    /// name, and it is `None` until the entrypoint has CONFIRMED the id is declared — so one
    /// caller's raw input is never echoed to a different caller in a `409`.
    started: Option<StartedOperation>,
    latest: Option<OperationRun>,
    catalog_reads: usize,
}

#[derive(Debug, Clone)]
struct StartedOperation {
    run_id: String,
    operation: Option<String>,
}

#[derive(Debug, Clone)]
struct OperationRun {
    run_id: String,
    operation: String,
    state: &'static str,
    exit_code: Option<i32>,
}

/// The spawn ceiling for this surface, shared by every request. Cloned with `SidecarState`;
/// every clone must see the same slots, hence the `Arc`.
#[derive(Clone, Default)]
pub struct RemoteInitiations {
    inner: Arc<Mutex<Slots>>,
}

/// Counts only — never an operation id, never a pid. A derived `Debug` on a state struct
/// that happens to contain this would otherwise print what the operator is doing.
impl std::fmt::Debug for RemoteInitiations {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let slots = self.inner.lock().expect("remote initiation slots poisoned");
        f.debug_struct("RemoteInitiations")
            .field("started", &usize::from(slots.started.is_some()))
            .field("catalogReads", &slots.catalog_reads)
            .finish()
    }
}

impl RemoteInitiations {
    pub fn new() -> Self {
        Self::default()
    }

    /// Take the start slot, or report what is already holding it (`None` inside the `Err`
    /// when the holder has not been confirmed as a declared operation yet).
    fn claim_start(&self) -> Result<StartSlot, Option<String>> {
        let mut slots = self.inner.lock().expect("remote initiation slots poisoned");
        if let Some(running) = &slots.started {
            return Err(running.operation.clone());
        }
        debug_assert_eq!(MAX_STARTED_OPERATIONS, 1, "the slot is a single Option");
        let run_id = format!("r-{}", uuid::Uuid::new_v4().simple());
        slots.started = Some(StartedOperation {
            run_id: run_id.clone(),
            operation: None,
        });
        Ok(StartSlot {
            registry: self.clone(),
            run_id,
        })
    }

    /// Take a catalog slot, or refuse.
    fn claim_catalog(&self) -> Option<CatalogSlot> {
        let mut slots = self.inner.lock().expect("remote initiation slots poisoned");
        if slots.catalog_reads >= MAX_CATALOG_READS {
            return None;
        }
        slots.catalog_reads += 1;
        Some(CatalogSlot {
            registry: self.clone(),
        })
    }

    fn release_start(&self) {
        let mut slots = self.inner.lock().expect("remote initiation slots poisoned");
        slots.started = None;
    }

    fn release_catalog(&self) {
        let mut slots = self.inner.lock().expect("remote initiation slots poisoned");
        slots.catalog_reads = slots.catalog_reads.saturating_sub(1);
    }

    /// Record that the running operation is a DECLARED one, by the name the entrypoint
    /// itself confirmed. Only after this can a competing caller be told what is running.
    fn confirm_started(&self, operation: &str) {
        let mut slots = self.inner.lock().expect("remote initiation slots poisoned");
        if let Some(started) = slots.started.as_mut() {
            started.operation = Some(operation.to_string());
            slots.latest = Some(OperationRun {
                run_id: started.run_id.clone(),
                operation: operation.to_string(),
                state: "running",
                exit_code: None,
            });
        }
    }

    fn complete(&self, run_id: &str, exit_code: Option<i32>) {
        let mut slots = self.inner.lock().expect("remote initiation slots poisoned");
        if let Some(run) = slots.latest.as_mut().filter(|run| run.run_id == run_id) {
            run.state = if exit_code == Some(0) { "succeeded" } else { "failed" };
            run.exit_code = exit_code;
        }
    }

    fn run(&self, run_id: &str) -> Option<OperationRun> {
        self.inner
            .lock()
            .expect("remote initiation slots poisoned")
            .latest
            .as_ref()
            .filter(|run| run.run_id == run_id)
            .cloned()
    }

    /// Is a start in flight? Test-only: production code asks this to DO something.
    #[cfg(test)]
    pub(crate) fn started_in_flight(&self) -> bool {
        self.inner
            .lock()
            .expect("remote initiation slots poisoned")
            .started
            .is_some()
    }

    #[cfg(test)]
    pub(crate) fn catalog_in_flight(&self) -> usize {
        self.inner
            .lock()
            .expect("remote initiation slots poisoned")
            .catalog_reads
    }
}

/// The start slot, held for exactly as long as the wizard runs. `Drop` is the release, so a
/// refusal after the claim, a `?`, a panic in the handler, and the child's own exit all free
/// it without a single explicit call site having to be right.
pub(crate) struct StartSlot {
    registry: RemoteInitiations,
    run_id: String,
}

impl StartSlot {
    fn run_id(&self) -> &str {
        &self.run_id
    }
}

impl Drop for StartSlot {
    fn drop(&mut self) {
        self.registry.release_start();
    }
}

pub(crate) struct CatalogSlot {
    registry: RemoteInitiations,
}

impl Drop for CatalogSlot {
    fn drop(&mut self) {
        self.registry.release_catalog();
    }
}

// ── the verdict the entrypoint prints ──────────────────────────────────────────────────

/// What the entrypoint said. Rust does not decide any of this; it relays it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum Verdict {
    Started { operation: String },
    UnknownOperation { detail: String },
    NotRemotelyInvocable { detail: String },
}

/// The verdict's wire reasons. Byte-identical to `auth-remote.ts`'s.
pub(crate) const REASON_UNKNOWN_OPERATION: &str = "unknown-operation";
pub(crate) const REASON_NOT_REMOTELY_INVOCABLE: &str = "not-remotely-invocable";

/// Parse ONE line as a verdict. `None` for anything that is not one — a blank line, a log
/// line, a JSON document carrying a different `wire`, a reason this build does not know.
///
/// Fail-closed on the last of those: an unrecognised reason is NOT read as a refusal it
/// resembles and certainly not as a start; it is simply not a verdict, and the caller reports
/// `could-not-start`.
pub(crate) fn parse_verdict(line: &str) -> Option<Verdict> {
    let value: Value = serde_json::from_str(line.trim()).ok()?;
    let object = value.as_object()?;
    if object.get("wire").and_then(Value::as_str) != Some(REMOTE_INITIATION_WIRE) {
        return None;
    }
    match object.get("ok").and_then(Value::as_bool)? {
        true => Some(Verdict::Started {
            operation: object.get("operation").and_then(Value::as_str)?.to_string(),
        }),
        false => {
            let detail = object
                .get("detail")
                .and_then(Value::as_str)
                .unwrap_or("The node refused to start that.")
                .to_string();
            match object.get("reason").and_then(Value::as_str)? {
                REASON_UNKNOWN_OPERATION => Some(Verdict::UnknownOperation { detail }),
                REASON_NOT_REMOTELY_INVOCABLE => Some(Verdict::NotRemotelyInvocable { detail }),
                _ => None,
            }
        }
    }
}

// ── spawning ───────────────────────────────────────────────────────────────────────────

/// Spawn an invocation with the operator's derived environment and NOTHING else.
///
/// `env_clear()` then `injected_vars()` is the same composition `spawn_process` and
/// `spawn_establish_process` use (P10): the child gets the declared `PATH`/`HOME` and no
/// other variable at all — not the daemon's, and no marker this module could have added.
///
/// `process_group(0)` so a kill reaches the whole tree: the entrypoint spawns the wizard
/// itself (that is how the wizard's process is indistinguishable from a local one), and an
/// orphaned grandchild is exactly what the ceiling exists to prevent.
fn spawn(invocation: &Invocation, spawn_env: &SpawnEnvDecl) -> std::io::Result<tokio::process::Child> {
    let mut command = tokio::process::Command::new(&invocation.program);
    command
        .args(&invocation.args)
        .env_clear()
        .envs(spawn_env.injected_vars())
        // Held open by the daemon, never written to — see the module header. This is the
        // wizard's lifeline and its leash at once.
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .kill_on_drop(false)
        .process_group(0);
    command.spawn()
}

/// Kill a child's whole process GROUP, then reap it — the same shape (and the same reason)
/// as `host_effects_bridge::core`'s `kill_process_group`. Used only on the refusal paths,
/// where nothing the operator can see is running: the entrypoint may already have forked the
/// wizard, and killing only the direct child would leave that wizard orphaned and holding a
/// question nobody will answer.
async fn kill_group(child: &mut tokio::process::Child) {
    if let Some(pid) = child.id() {
        // SAFETY: `kill` with a negative pid targets the process group; SIGKILL is a plain
        // signal number. No memory is touched. A dead group returns ESRCH, ignored.
        unsafe {
            libc::kill(-(pid as i32), libc::SIGKILL);
        }
    }
    // Reap the direct child so it does not linger as a zombie.
    let _ = child.kill().await;
}

/// Read stdout until a verdict line appears, bounded three ways: lines, bytes, and (by the
/// caller) time. `None` when the stream ended, the ceilings were hit, or nothing on it was a
/// verdict.
async fn read_verdict<R: tokio::io::AsyncRead + Unpin>(reader: &mut BufReader<R>) -> Option<Verdict> {
    let mut seen_bytes = 0usize;
    for _ in 0..MAX_VERDICT_LINES {
        let mut line = String::new();
        match reader.read_line(&mut line).await {
            Ok(0) | Err(_) => return None,
            Ok(n) => {
                seen_bytes = seen_bytes.saturating_add(n);
                if seen_bytes > MAX_VERDICT_BYTES {
                    return None;
                }
            }
        }
        if let Some(verdict) = parse_verdict(&line) {
            return Some(verdict);
        }
    }
    None
}

/// Read a child's stdout to EOF, capped. The catalog is the only output this surface ever
/// relays, and it relays it as the JSON DOCUMENT the child printed — Rust does not look
/// inside.
async fn read_capped<R: tokio::io::AsyncRead + Unpin>(reader: &mut R, cap: usize) -> String {
    let mut buffer = Vec::new();
    let mut chunk = [0u8; 4096];
    while buffer.len() < cap {
        match reader.read(&mut chunk).await {
            Ok(0) | Err(_) => break,
            Ok(n) => buffer.extend_from_slice(&chunk[..n]),
        }
    }
    buffer.truncate(cap);
    String::from_utf8_lossy(&buffer).to_string()
}

// ── HTTP surface ───────────────────────────────────────────────────────────────────────

fn json_error(status: StatusCode, body: Value) -> axum::response::Response {
    (status, Json(body)).into_response()
}

fn could_not_start(detail: String) -> axum::response::Response {
    json_error(
        StatusCode::SERVICE_UNAVAILABLE,
        serde_json::json!({
            "wire": REMOTE_INITIATION_WIRE,
            "error": "could-not-start",
            "detail": detail,
        }),
    )
}

/// `POST /operations` — start one of refarm's own wizards, named by an opaque id.
///
/// Device-only by silence (see the module header). The body is read for EXACTLY one field,
/// `operation`, and that value becomes exactly one argv element; no other field is consulted,
/// merged, or defaulted.
///
/// Returns as soon as the entrypoint has said whether it started — not when the wizard
/// finishes. The wizard's interface is its QUESTIONS, and they arrive on `GET /prompts`.
pub(crate) async fn post_operations(
    State(state): State<SidecarState>,
    Json(body): Json<Value>,
) -> impl IntoResponse {
    let Some(operation) = body.get("operation").and_then(Value::as_str) else {
        return json_error(
            StatusCode::BAD_REQUEST,
            serde_json::json!({
                "wire": REMOTE_INITIATION_WIRE,
                "error": "no-operation",
                "detail": "Name the operation to start in the `operation` field.",
            }),
        );
    };

    // The ceiling, claimed BEFORE anything is resolved or spawned: a refusal must be cheap.
    let slot = match state.remote_initiations.claim_start() {
        Ok(slot) => slot,
        Err(running) => {
            return json_error(
                StatusCode::CONFLICT,
                serde_json::json!({
                    "wire": REMOTE_INITIATION_WIRE,
                    "error": "already-running",
                    // `null` while the running id is still just some caller's string.
                    "running": running,
                    "maxStarted": MAX_STARTED_OPERATIONS,
                    "detail":
                        "An operation started from a device is already running on this node. \
                         Finish or abandon it before starting another.",
                }),
            );
        }
    };

    let (spawn_env, entrypoint) = match resolve_entrypoint() {
        Ok(resolved) => resolved,
        Err(detail) => return could_not_start(detail),
    };

    let invocation = start_invocation(&entrypoint, operation);
    let mut child = match spawn(&invocation, &spawn_env) {
        Ok(child) => child,
        Err(error) => {
            return could_not_start(format!(
                "could not start {}: {error}",
                entrypoint.display()
            ))
        }
    };
    let pid = child.id();

    let Some(stdout) = child.stdout.take() else {
        kill_group(&mut child).await;
        return could_not_start("the entrypoint produced no output stream".to_string());
    };
    let mut reader = BufReader::new(stdout);

    let verdict = tokio::time::timeout(
        Duration::from_millis(VERDICT_DEADLINE_MS),
        read_verdict(&mut reader),
    )
    .await;

    match verdict {
        Ok(Some(Verdict::Started { operation: named })) => {
            state.remote_initiations.confirm_started(&named);
            let run_id = slot.run_id().to_string();
            let background_run_id = run_id.clone();
            // WHAT was started and by nothing else — no argv, no environment, no output.
            tracing::info!(
                operation = %named,
                pid = pid.unwrap_or(0),
                "an enrolled device started an operation — its questions are on the prompt hub"
            );
            // The child outlives this request. The task owns it — and therefore owns its
            // stdin, whose write end staying open is what keeps the wizard alive — and holds
            // the slot until it exits.
            tokio::spawn(async move {
                let _slot = slot;
                // Drained and DISCARDED: output does not travel (see the header), and a log
                // line here would be the smuggling route.
                let mut sink = reader;
                let _ = read_capped(&mut sink, usize::MAX / 2).await;
                let exit_code = child.wait().await.ok().and_then(|status| status.code());
                _slot.registry.complete(&background_run_id, exit_code);
            });
            (
                StatusCode::ACCEPTED,
                Json(serde_json::json!({
                    "wire": REMOTE_INITIATION_WIRE,
                    "started": true,
                    "operation": named,
                    "runId": run_id,
                    "status": format!("{ROUTE_OPERATIONS}/{run_id}"),
                    "attend": "GET /prompts",
                })),
            )
                .into_response()
        }
        Ok(Some(Verdict::UnknownOperation { detail })) => {
            kill_group(&mut child).await;
            json_error(
                StatusCode::NOT_FOUND,
                serde_json::json!({
                    "wire": REMOTE_INITIATION_WIRE,
                    "error": REASON_UNKNOWN_OPERATION,
                    "detail": detail,
                }),
            )
        }
        Ok(Some(Verdict::NotRemotelyInvocable { detail })) => {
            kill_group(&mut child).await;
            json_error(
                StatusCode::FORBIDDEN,
                serde_json::json!({
                    "wire": REMOTE_INITIATION_WIRE,
                    "error": REASON_NOT_REMOTELY_INVOCABLE,
                    "detail": detail,
                }),
            )
        }
        Ok(None) => {
            kill_group(&mut child).await;
            could_not_start(
                "the entrypoint exited without saying whether it started".to_string(),
            )
        }
        Err(_elapsed) => {
            kill_group(&mut child).await;
            could_not_start(format!(
                "the entrypoint said nothing within {VERDICT_DEADLINE_MS}ms and was stopped"
            ))
        }
    }
}

/// `GET /operations/:run_id` — lifecycle only, never command output.
///
/// The registry retains exactly the current/most recent confirmed run. That makes status
/// useful to a pocket client without turning the daemon into an unbounded history store.
pub(crate) async fn get_operation(
    State(state): State<SidecarState>,
    AxumPath(run_id): AxumPath<String>,
) -> impl IntoResponse {
    let Some(run) = state.remote_initiations.run(&run_id) else {
        return json_error(
            StatusCode::NOT_FOUND,
            serde_json::json!({
                "wire": REMOTE_INITIATION_WIRE,
                "error": "unknown-run",
                "detail": "This node does not retain a run with that id.",
            }),
        );
    };
    (
        StatusCode::OK,
        Json(serde_json::json!({
            "wire": REMOTE_INITIATION_WIRE,
            "runId": run.run_id,
            "operation": run.operation,
            "state": run.state,
            "exitCode": run.exit_code,
        })),
    )
        .into_response()
}

/// `GET /operations` — what an enrolled device may start here.
///
/// Device-only by the same silence. Rust does not know the catalog and does not learn it: it
/// runs `refarm auth remote --json` and relays the JSON document that command printed, whole,
/// under `catalog`. The declaration stays in exactly one place.
pub(crate) async fn get_operations(State(state): State<SidecarState>) -> impl IntoResponse {
    let Some(_slot) = state.remote_initiations.claim_catalog() else {
        return json_error(
            StatusCode::CONFLICT,
            serde_json::json!({
                "wire": REMOTE_INITIATION_WIRE,
                "error": "already-running",
                "maxCatalogReads": MAX_CATALOG_READS,
                "detail": "A catalog read is already in flight on this node.",
            }),
        );
    };

    let (spawn_env, entrypoint) = match resolve_entrypoint() {
        Ok(resolved) => resolved,
        Err(detail) => return could_not_start(detail),
    };

    let invocation = catalog_invocation(&entrypoint);
    let mut child = match spawn(&invocation, &spawn_env) {
        Ok(child) => child,
        Err(error) => {
            return could_not_start(format!("could not start {}: {error}", entrypoint.display()))
        }
    };
    let Some(mut stdout) = child.stdout.take() else {
        kill_group(&mut child).await;
        return could_not_start("the entrypoint produced no output stream".to_string());
    };

    let printed = tokio::time::timeout(
        Duration::from_millis(CATALOG_DEADLINE_MS),
        read_capped(&mut stdout, MAX_CATALOG_BYTES),
    )
    .await;
    let printed = match printed {
        Ok(printed) => printed,
        Err(_elapsed) => {
            kill_group(&mut child).await;
            return could_not_start(format!(
                "the entrypoint printed no catalog within {CATALOG_DEADLINE_MS}ms and was stopped"
            ));
        }
    };
    let _ = child.wait().await;

    match serde_json::from_str::<Value>(printed.trim()) {
        Ok(catalog) if catalog.is_object() => (
            StatusCode::OK,
            Json(serde_json::json!({
                "wire": REMOTE_INITIATION_WIRE,
                "catalog": catalog,
            })),
        )
            .into_response(),
        // Never echo what the child printed: it is not request input, but it is also not
        // something this module has read, and relaying unparsed bytes as an error string is
        // how output starts travelling.
        _ => could_not_start("the entrypoint did not print a catalog this node could read".to_string()),
    }
}

#[cfg(test)]
#[path = "remote_initiation_tests.rs"]
mod tests;
