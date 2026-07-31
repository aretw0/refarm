//! Opt-in per-device authentication gate for the runtime sidecar.
//!
//! The operator's question — "what stops another device from entering my node?" — is
//! answered here: with a policy configured, every sidecar request must carry a valid
//! per-device bearer credential, or it is rejected `401`. This is the identity gate that
//! sits ABOVE the network gate (Tailscale): the tailnet authenticates the device to the
//! network; this authenticates the device to the FARM.
//!
//! **The gate is turned on by a DECLARATION, not by an env var.** `surfaces.<name>` with
//! `"gate": "device-token"` in `.refarm/config.json` IS the opt-in; the policy path is then
//! DERIVED — `<refarm-dir>/auth-policy.json`, the same conventional file
//! `refarm auth enroll` already writes by default. Before this, the writer knew the
//! convention and the reader did not: the reader gated on `REFARM_AUTH_POLICY`'s mere
//! presence, so an operator who declared the gate was still made to plumb the path by hand
//! (`export REFARM_AUTH_POLICY=…`) before the declaration would be believed. That asymmetry
//! was the defect; `resolve_policy_path` is where it is closed.
//!
//! Fail-closed by construction, mirroring the opt-in CORS layer:
//!   - no declared gate and no `REFARM_AUTH_POLICY` ⇒ `resolve_auth_policy` is `None` ⇒ the
//!     layer is never added ⇒ behavior is byte-identical to before the gate existed. Nothing
//!     was declared, so nothing is claimed.
//!   - a declared gate whose policy file does not exist YET ⇒ a **deny-all** policy: bound,
//!     and every request `401` until `refarm auth enroll` mints a credential. Denying all is
//!     the STRICTEST possible enforcement of the declared gate, not a hole — and it is what
//!     keeps a declared-but-not-yet-enrolled node bootable instead of locking the operator
//!     out of a runtime that refuses to start.
//!   - a policy file that exists but is unreadable/invalid ⇒ the same **deny-all** (never
//!     silently ungated): if you asked for auth, a broken policy must lock the door, not
//!     leave it open.
//!
//! Resolved ONCE per daemon start, never once per gate: `main.rs` calls
//! `ResolvedAuthPolicy::resolve` and hands the ANSWER to both the HTTP sidecar and the WS
//! server. `resolve_auth_policy` is private to this module so that "once" is a compile-time
//! property — see `ResolvedAuthPolicy` for the defect that made it necessary.
//!
//! RESOLVED once, but not FROZEN once. "One resolution" is about there being one reader of
//! the file and one answer both gates enforce — it was never meant to make a credential
//! policy immutable for the lifetime of the process. It briefly did, and the operational
//! cost was immediate: enrolling a device (`refarm auth enroll` writes this exact file)
//! required a full runtime restart before the new credential was accepted, and revoking one
//! required a restart before it STOPPED being accepted. A credential policy is precisely the
//! kind of state that must be re-read when it changes. So the one answer both gates hold is
//! a SHARED, updatable handle (`AuthGate`) rather than a snapshot each gate copied: a
//! background watcher re-reads the file and swaps the value behind it, and both gates observe
//! the swap at once because there is only ever one value. See `AuthGate::reload_if_changed`
//! for the fail-closed rule that governs every re-read.
//!
//! Slice 1 (this module) AUTHENTICATES: enrolled device or not. Which workspace/namespace an
//! identity may act in is authorization — Slice 2 (via `@refarm.dev/workspace-access-contract-v1`).
//! The credential is a bearer token; only its SHA-256 is ever stored in the policy (never the
//! raw token), and the lookup is over hashes. `/sync` (the CRDT WS on :42000) is a separate
//! gate, tracked as a follow-up.

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, RwLock};
use std::time::Duration;

use axum::{
    body::Body,
    http::{header, Request, Response, StatusCode},
    middleware::Next,
};
use sha2::{Digest, Sha256};

/// Env naming the auth policy file — an OVERRIDE of the derived path, never the only way in.
/// Set to a non-blank value ⇒ that exact path wins over any derivation (the operator's
/// explicit value always beats a convention). Unset — or set to blank, which is not a value
/// and never was — ⇒ the path is derived from the declaration (`resolve_policy_path`).
pub(crate) const AUTH_POLICY_ENV: &str = "REFARM_AUTH_POLICY";

/// The conventional policy file name inside the refarm dir. Byte-identical to the default
/// `refarm auth enroll` writes (`apps/refarm/src/commands/auth.ts`'s `DEFAULT_POLICY_PATH` =
/// `.refarm/auth-policy.json`) — deliberately ONE convention shared by the writer and the
/// reader, because the whole defect this constant fixes was the writer knowing a convention
/// the reader did not.
pub(crate) const AUTH_POLICY_FILE_NAME: &str = "auth-policy.json";

/// How often the watcher re-reads the policy file. The upper bound on how long an enrolment
/// waits to be honoured — and, more importantly, on how long a REVOCATION waits to bite.
///
/// Deliberately a poll and not an inotify subscription: no watch crate is in this crate's
/// dependency tree (`notify` is not in the lock), and the writer this must follow is an
/// atomic tmp→rename, which replaces the INODE. An inotify watch on the path would follow
/// the old inode and go permanently deaf after the first enrolment unless the parent
/// directory were watched instead — more machinery, and a new dependency, to observe a
/// ~200-byte file. A read of that file every two seconds costs nothing measurable, follows
/// a rename by construction, and re-reads nothing when the bytes are unchanged (see
/// `Reading::fingerprint`).
const RELOAD_POLL_INTERVAL: Duration = Duration::from_secs(2);

/// A device credential: the SHA-256 (lowercase hex) of its bearer token → the identity it
/// authenticates as. The raw token never lives in the policy.
#[derive(Debug, Clone)]
pub(crate) struct Credential {
    pub(crate) token_sha256: String,
    pub(crate) identity: String,
}

/// The resolved auth policy: the enrolled device credentials.
#[derive(Debug, Clone, Default)]
pub(crate) struct AuthPolicy {
    credentials: Vec<Credential>,
}

impl AuthPolicy {
    /// Authenticate a bearer token → the identity it maps to, or `None`. The token is
    /// hashed and matched against stored hashes — the raw token is never compared. PURE.
    pub(crate) fn authenticate(&self, token: &str) -> Option<&str> {
        let digest = sha256_hex(token);
        self.credentials
            .iter()
            .find(|c| c.token_sha256 == digest)
            .map(|c| c.identity.as_str())
    }

    /// A deny-all policy — every request is rejected. The fail-closed fallback.
    fn deny_all() -> Self {
        Self { credentials: Vec::new() }
    }

    /// How many device identities this policy admits. The ONLY quantity about the policy
    /// that is ever logged: a count says "the revocation landed" without naming a token, a
    /// hash, or an identity.
    fn identity_count(&self) -> usize {
        self.credentials.len()
    }

    #[cfg(test)]
    pub(crate) fn from_credentials(credentials: Vec<Credential>) -> Self {
        Self { credentials }
    }
}

/// SHA-256 of `input` as lowercase hex. The same digest the policy file stores per token.
pub(crate) fn sha256_hex(input: &str) -> String {
    use std::fmt::Write as _;
    let digest = Sha256::digest(input.as_bytes());
    let mut out = String::with_capacity(digest.len() * 2);
    for byte in digest {
        let _ = write!(out, "{byte:02x}");
    }
    out
}

/// The policy file shape. Unknown fields (workspaces/memberships for Slice 2) are ignored
/// so the file format is stable across slices.
#[derive(serde::Deserialize)]
struct PolicyFile {
    #[serde(default)]
    credentials: Vec<CredentialEntry>,
}

#[derive(serde::Deserialize)]
struct CredentialEntry {
    identity: String,
    #[serde(rename = "tokenSha256")]
    token_sha256: String,
}

/// Parse a policy JSON string into an `AuthPolicy`. PURE (no I/O) so it is native-testable.
pub(crate) fn parse_policy(raw: &str) -> Result<AuthPolicy, serde_json::Error> {
    let file: PolicyFile = serde_json::from_str(raw)?;
    let credentials = file
        .credentials
        .into_iter()
        .map(|c| Credential {
            token_sha256: c.token_sha256.trim().to_ascii_lowercase(),
            identity: c.identity,
        })
        .collect();
    Ok(AuthPolicy { credentials })
}

/// The two boot-time facts the policy path is resolved FROM. Decided ONCE in `main.rs` and
/// threaded into every surface that needs it — never re-read from global state:
///
///   - **the refarm dir the daemon was GIVEN** (`--refarm-dir`, defaulted by main.rs's
///     `dirs_sovereign_base`). Not `.refarm` hardcoded, not re-derived from cwd: the daemon
///     already received the answer, and a second derivation is how two readers start
///     disagreeing about which farm they are reading.
///   - **whether the `surfaces` declaration names `"gate": "device-token"`** anywhere
///     (`crate::host::any_surface_declares_device_token_gate`). A declared gate is the
///     operator's statement that this node is credential-gated; that intent is what makes
///     the conventional policy path meaningful, so that intent is what derives it.
///
/// `pub` (re-exported as `crate::sidecar::AuthPolicySource`) because `main.rs` is a separate
/// crate from this library and is where both facts are known. Fields stay private: nothing
/// outside this module can construct a source without naming both.
#[derive(Debug, Clone)]
pub struct AuthPolicySource {
    refarm_dir: PathBuf,
    device_token_gate_declared: bool,
}

impl AuthPolicySource {
    pub fn new(refarm_dir: PathBuf, device_token_gate_declared: bool) -> Self {
        Self { refarm_dir, device_token_gate_declared }
    }
}

/// A resolved policy path plus WHO decided it — the only thing that distinguishes "the
/// operator pointed us at a file that isn't there" (their explicit path, their error) from
/// "the gate is declared and enrollment simply hasn't happened yet" (expected, and the one
/// case that gets its own guidance line).
#[derive(Debug, Clone, PartialEq, Eq)]
struct PolicyPath {
    path: PathBuf,
    /// `true` ⇒ derived from the declaration; `false` ⇒ the `REFARM_AUTH_POLICY` override.
    derived: bool,
}

/// WHERE the policy lives, or `None` when no policy is resolvable at all.
///
/// PRECEDENCE, one line: a non-blank `REFARM_AUTH_POLICY` always wins; otherwise a declared
/// `device-token` gate derives `<refarm-dir>/auth-policy.json`; otherwise there is no policy.
///
/// A set-but-BLANK env is not a value and never was — it behaves EXACTLY as unset, which is
/// what it has always done (both meant "gate off" when the env was the only input; both now
/// mean "the env decides nothing, so the declaration decides"). Blank is not a way to switch
/// a declared gate back off; a declaration is turned off by editing the declaration.
///
/// PURE: one env read and one path join. No file I/O, no logging, no side effects.
fn resolve_policy_path(source: &AuthPolicySource) -> Option<PolicyPath> {
    if let Some(explicit) = policy_path_override() {
        return Some(PolicyPath { path: PathBuf::from(explicit), derived: false });
    }
    if !source.device_token_gate_declared {
        return None;
    }
    Some(PolicyPath {
        path: source.refarm_dir.join(AUTH_POLICY_FILE_NAME),
        derived: true,
    })
}

/// The operator's explicit `REFARM_AUTH_POLICY`, trimmed, if it is a real value. PURE.
fn policy_path_override() -> Option<String> {
    let raw = std::env::var(AUTH_POLICY_ENV).ok()?;
    let trimmed = raw.trim();
    (!trimmed.is_empty()).then(|| trimmed.to_string())
}

/// `true` exactly when a policy is RESOLVABLE — declaration-derived or named by
/// `REFARM_AUTH_POLICY` — which is the SAME condition `resolve_auth_policy` uses to decide
/// `Some` (gate on, whether or not the file turns out to exist: an absent or unreadable
/// policy is still `Some(deny_all)`) vs `None` (gate off, nothing declared).
///
/// This is no longer an env-presence peek: a declared gate makes a policy resolvable with no
/// env at all, which is the whole point — the declaration is what the operator states, so the
/// declaration is what the reader must believe.
///
/// Deliberately does NOT read or parse the file, and emits no log line: it is the cheap peek
/// for callers that only need "is a policy resolvable" (the WS bind preflight, which runs from
/// `main.rs` BEFORE the runtime boots and BEFORE the authoritative read is due) without
/// triggering the enable/deny-all log line that only the one real resolution —
/// `ResolvedAuthPolicy::resolve`, called once per daemon start — should ever emit. PURE: env
/// inspection and a path join, no file I/O, no logging.
///
/// The peek is kept, and kept ahead of the resolution, because the preflight's whole purpose
/// is to refuse a bad `--ws-host` as the daemon's FIRST act — before any file is read and
/// before anything boots. It cannot disagree with `ResolvedAuthPolicy::is_gated()`: both are
/// literally "`resolve_policy_path` is `Some`", pinned by
/// `the_cheap_peek_agrees_with_the_one_resolution_in_every_case`.
pub(crate) fn auth_policy_configured(source: &AuthPolicySource) -> bool {
    resolve_policy_path(source).is_some()
}

/// Resolve the auth policy — the ONE emitter of the gate's enable/deny-all log line
/// (`auth_policy_configured` above stays silent by design).
///   - no declared gate + no env ⇒ `None` (layer never added — the secure default is off).
///   - resolvable + readable/valid ⇒ the parsed policy (gate on).
///   - DERIVED + the file does not exist yet ⇒ `Some(deny_all)`, with a loud line naming the
///     derived path and `refarm auth enroll`: the gate was declared, so it binds and denies
///     everything until a credential exists. A silent 401 is a ghost hunt.
///   - anything else unreadable/invalid (including an override path that isn't there — the
///     operator's explicit value, so their error to see) ⇒ `Some(deny_all)`, fail-closed.
///
/// PRIVATE to this module, and that privacy is the fix: `ResolvedAuthPolicy::resolve` is the
/// only caller, so "resolve once per daemon start" is enforced by the compiler rather than by
/// a comment every future call site has to read. A second resolution elsewhere in the crate
/// is now a name-resolution error, not a second file read and a second log line.
fn resolve_auth_policy(source: &AuthPolicySource) -> Option<AuthGate> {
    let located = resolve_policy_path(source)?;
    let reading = read_policy_file(&located.path);
    let policy = match &reading.observed {
        Observed::Policy(policy) => {
            tracing::info!(
                credentials = policy.identity_count(),
                path = %located.path.display(),
                derived = located.derived,
                "sidecar auth gate enabled (opt-in)"
            );
            policy.clone()
        }
        Observed::Absent if located.derived => {
            tracing::warn!(
                path = %located.path.display(),
                "auth policy file is ABSENT at the derived path — a surface declares \"gate\": \
                 \"device-token\", so the gate is bound and enforced DENY-ALL: every request is \
                 rejected 401 until a credential exists. Fix: run `refarm auth enroll`"
            );
            AuthPolicy::deny_all()
        }
        _ => {
            tracing::error!(
                path = %located.path.display(),
                "auth policy configured but unreadable/invalid — gating DENY-ALL"
            );
            AuthPolicy::deny_all()
        }
    };
    Some(AuthGate::new(located, policy, reading.fingerprint))
}

/// WHAT one read of the policy file said. Three outcomes, because they warrant three
/// different log lines — but only ONE of them is ever a policy: everything else is
/// `deny_all`, at boot and at every reload alike.
enum Observed {
    /// Read and parsed cleanly. The only case that installs credentials.
    Policy(AuthPolicy),
    /// The file is not there. At boot on a DERIVED path this is the expected
    /// "declared but not enrolled yet"; after a reload it is a disappearance.
    Absent,
    /// There is a file and it cannot be believed — unreadable (permissions), unparseable,
    /// or HALF-WRITTEN. Never a policy, and never mistaken for an empty one: a truncated
    /// `{"credentials": [{"iden` is a `serde_json` error, not zero credentials, so it can
    /// only ever land here.
    Broken,
}

/// One read of the policy file: what it said, plus a fingerprint that identifies this exact
/// observation so a reload can tell "changed" from "unchanged" without re-applying (and
/// re-LOGGING) an answer already in force.
///
/// The fingerprint is the SHA-256 of the bytes when there were bytes, and a bracketed
/// sentinel otherwise. The two spaces cannot collide: a digest is 64 lowercase hex chars and
/// a sentinel starts with `<`. Fingerprinting the CONTENT rather than the mtime is what makes
/// the watcher correct across an atomic tmp→rename (new inode, possibly older mtime) and
/// across a rewrite that lands inside the same filesystem timestamp granularity.
struct Reading {
    observed: Observed,
    fingerprint: String,
}

/// Read the policy file once. NO logging and no state change — the caller decides what this
/// observation means (a boot line, a reload line, or nothing at all) and is the single
/// emitter for it. One `read_to_string`, so a concurrent writer can only ever hand us bytes,
/// never a partially-applied policy.
fn read_policy_file(path: &Path) -> Reading {
    match std::fs::read_to_string(path) {
        Ok(raw) => {
            let fingerprint = sha256_hex(&raw);
            match parse_policy(&raw) {
                Ok(policy) => Reading { observed: Observed::Policy(policy), fingerprint },
                Err(_) => Reading { observed: Observed::Broken, fingerprint },
            }
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            Reading { observed: Observed::Absent, fingerprint: "<absent>".to_string() }
        }
        Err(e) => Reading {
            observed: Observed::Broken,
            fingerprint: format!("<unreadable:{:?}>", e.kind()),
        },
    }
}

/// THE live policy — one value, shared by every gate, re-read when the file changes.
///
/// Cloning an `AuthGate` clones an `Arc`, never the policy: the HTTP middleware layer and the
/// WS handshake callback each hold a clone, and both therefore observe a reload the instant it
/// is applied. That is the same guarantee `ResolvedAuthPolicy` already made — "both gates
/// enforce the same credentials" — extended from "the same value at boot" to "the same value,
/// always". Re-introducing a per-gate SNAPSHOT held for the process lifetime would silently
/// undo it: one gate would keep honouring a credential the other has revoked.
#[derive(Clone)]
pub(crate) struct AuthGate {
    state: Arc<GateState>,
}

struct GateState {
    /// The path resolved ONCE at boot (env override or derivation). The watcher re-reads
    /// this exact path forever; it never re-resolves, because re-resolving is how two
    /// readers start disagreeing about which file is the policy.
    located: PolicyPath,
    /// What the gates enforce RIGHT NOW.
    current: RwLock<AuthPolicy>,
    /// The fingerprint of the observation currently in force. Guards both the re-apply and
    /// the log line: no change, no swap, no line.
    applied: Mutex<String>,
}

/// Never prints credentials — not the tokens, not their hashes, not the identities. A
/// derived `Debug` would have printed every stored hash the moment anyone wrote `?gate`.
impl std::fmt::Debug for AuthGate {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("AuthGate")
            .field("path", &self.state.located.path)
            .field("derived", &self.state.located.derived)
            .field("identities", &self.identity_count())
            .finish()
    }
}

impl AuthGate {
    fn new(located: PolicyPath, policy: AuthPolicy, fingerprint: String) -> Self {
        Self {
            state: Arc::new(GateState {
                located,
                current: RwLock::new(policy),
                applied: Mutex::new(fingerprint),
            }),
        }
    }

    /// Authenticate a bearer token against the policy IN FORCE right now → its identity.
    /// The HTTP gate's entry point. Returns an owned identity because the value is read out
    /// from behind a lock — a borrow would pin the policy and block the next reload.
    pub(crate) fn authenticate(&self, token: &str) -> Option<String> {
        self.snapshot().authenticate(token).map(str::to_string)
    }

    /// A copy of the policy in force, for the one caller that needs the whole value: the WS
    /// handshake, whose decision function (`decide_ws_handshake`) is PURE over an
    /// `&AuthPolicy` and stays that way. Taken per connection at handshake time — so a
    /// connection attempted after a revocation is judged by the post-revocation policy —
    /// and cheap: a small `Vec` of hashes.
    pub(crate) fn snapshot(&self) -> AuthPolicy {
        self.state.current.read().expect("auth policy lock poisoned").clone()
    }

    fn identity_count(&self) -> usize {
        self.state.current.read().expect("auth policy lock poisoned").identity_count()
    }

    /// Re-read the policy file and, if the observation CHANGED, swap in the new answer for
    /// every gate at once. Returns `true` exactly when a swap happened — which is also
    /// exactly when one log line is emitted.
    ///
    /// FAIL-CLOSED, by the SAME rule the boot resolution uses, deliberately: anything that
    /// is not a cleanly parsed policy installs `deny_all`. There is no "keep the
    /// last-known-good" path.
    ///
    /// That choice is the doctrine of this module, not a preference. `resolve_auth_policy`
    /// has always answered "configured but unreadable/invalid ⇒ deny_all" — if you asked for
    /// auth, a policy that cannot be believed locks the door. A reload that instead kept the
    /// last-known-good policy would make the module answer the same question two different
    /// ways depending on WHEN it was asked, and the divergence lands exactly on the case
    /// that matters most: an operator revokes a device, the write leaves the file corrupt,
    /// and last-known-good keeps admitting the credential they just revoked — indefinitely,
    /// and silently, because nothing further changes to trigger another read. Deny-all
    /// cannot fail that way. Its cost is bounded and visible: the door is shut, loudly, until
    /// the file is readable again — and the next good write reopens it within one poll.
    ///
    /// A half-written file cannot masquerade as an empty policy: truncated JSON does not
    /// parse, so it is `Observed::Broken` (an ERROR line), never `Observed::Policy` with zero
    /// credentials (an INFO "reloaded, 0 identities"). Both deny, but only one of them is a
    /// deliberate revocation, and an operator must be able to tell which they are looking at.
    pub(crate) fn reload_if_changed(&self) -> bool {
        let reading = read_policy_file(&self.state.located.path);
        let mut applied = self.state.applied.lock().expect("auth policy lock poisoned");
        if *applied == reading.fingerprint {
            return false;
        }
        *applied = reading.fingerprint;

        let path = self.state.located.path.display().to_string();
        let previously = self.identity_count();
        let next = match reading.observed {
            Observed::Policy(policy) => {
                // The ONE reload line. `identities` is what an operator watches after
                // running `refarm auth enroll` (it goes up) or revoking (it goes DOWN) —
                // the moment a revocation takes effect is the moment they most need
                // confirmation, so it is stated, counted, and never guessed at. Counts
                // only: no token, no hash, no identity name.
                tracing::info!(
                    identities = policy.identity_count(),
                    previously,
                    path = %path,
                    "auth policy reloaded — the change is in force for every gate, no restart"
                );
                policy
            }
            Observed::Absent => {
                tracing::warn!(
                    previously,
                    path = %path,
                    "auth policy file DISAPPEARED — gating DENY-ALL: every request is rejected \
                     401 until the file is back. Fix: run `refarm auth enroll`"
                );
                AuthPolicy::deny_all()
            }
            Observed::Broken => {
                tracing::error!(
                    previously,
                    path = %path,
                    "auth policy became unreadable/invalid (a truncated write, or a corrupt \
                     file) — gating DENY-ALL. The previous policy is NOT kept: a policy that \
                     cannot be read cannot be enforced"
                );
                AuthPolicy::deny_all()
            }
        };
        *self.state.current.write().expect("auth policy lock poisoned") = next;
        true
    }

    /// Test-only: a gate over an injected policy, pointed at a path that does not exist.
    /// For the handshake/middleware tests, which are about ENFORCEMENT, not about reloading
    /// — they never call `reload_if_changed`, so the path is never read.
    #[cfg(test)]
    pub(crate) fn for_test(policy: AuthPolicy) -> Self {
        Self::new(
            PolicyPath { path: PathBuf::from("/nonexistent/injected-policy.json"), derived: false },
            policy,
            "<injected>".to_string(),
        )
    }
}

/// THE auth policy of this daemon: resolved ONCE at start, then handed to every gate that
/// enforces it, instead of each gate resolving for itself.
///
/// The defect this closes was audible. With a `"gate": "device-token"` declaration and no
/// policy file yet, a boot printed the derived-but-ABSENT warning TWICE, ~10µs apart, because
/// the HTTP sidecar (`sidecar::start`) and the WS server (`daemon::WsServer::start`) each
/// called `resolve_auth_policy` for themselves. Both call sites long pre-date that warning —
/// they resolved twice from the env before it existed too; the warning only made an inherited
/// duplication audible. And the doubled line is the SYMPTOM: two independent reads of the same
/// file are two answers that can in principle disagree, leaving one gate honouring a
/// credential the other has never heard of. One read, one line, one value both gates enforce.
///
/// The SOURCE is what `main.rs` knows (the refarm dir + the declaration); the RESULT is what
/// travels. `main.rs` builds the `AuthPolicySource`, calls `resolve` exactly once, and clones
/// this value into both gates — which no longer receive a source at all, so they *cannot*
/// resolve a second time.
///
/// Opaque outside the crate on purpose: the field is private and `AuthPolicy` stays
/// `pub(crate)`, so `main.rs` (a separate crate) can carry this value from the resolution to
/// the gates without ever being able to read a credential out of it. Same doctrine as
/// `AuthPolicySource` — what crosses the crate boundary is a handle, never the credentials.
#[derive(Debug, Clone)]
pub struct ResolvedAuthPolicy {
    /// `None` ⇒ no policy was resolvable at all (nothing declared, no env) ⇒ no gate is
    /// bound anywhere, and there is nothing to watch. `Some` ⇒ the gate is bound and this
    /// handle is what it enforces — including a `deny_all` behind it, which is the STRICTEST
    /// enforcement of a declared gate, not an absence of one.
    ///
    /// A HANDLE, not a snapshot: whether the gate is bound is fixed at boot (it follows the
    /// declaration and the env, which do not change under a running daemon), but WHAT it
    /// enforces follows the file.
    gate: Option<AuthGate>,
}

impl ResolvedAuthPolicy {
    /// The one resolution. Call EXACTLY ONCE per daemon start: this is the only file read of
    /// the policy and the only emitter of the enable/deny-all log line.
    ///
    /// `pub` because `main.rs` is a separate crate and is where the boot happens — it is the
    /// single place that holds an `AuthPolicySource`, which is what keeps "once" true.
    pub fn resolve(source: &AuthPolicySource) -> Self {
        Self { gate: resolve_auth_policy(source) }
    }

    /// `true` when a gate is BOUND — the bool both bind guards take. Equal by construction to
    /// `auth_policy_configured(source)` for the same source (both are exactly
    /// "`resolve_policy_path` is `Some`"), which is why the WS preflight's cheap peek and this
    /// authoritative answer can never disagree.
    ///
    /// Unaffected by reloads on purpose: a policy file that becomes unreadable does not
    /// UNBIND the gate (that would widen access to "no gate at all"); it makes the bound gate
    /// deny everything.
    pub(crate) fn is_gated(&self) -> bool {
        self.gate.is_some()
    }

    /// The live gate to ENFORCE, or `None` when no gate is bound. Both gates take a clone
    /// from here — the sidecar's `auth_middleware` layer and the WS
    /// `Sec-WebSocket-Protocol` handshake — and a clone is an `Arc` bump, so both keep
    /// observing the same value across every reload.
    pub(crate) fn gate(&self) -> Option<AuthGate> {
        self.gate.clone()
    }

    /// Start the ONE watcher that keeps the policy current. Call once per daemon start,
    /// from `main.rs`, right after `resolve` — inside the tokio runtime.
    ///
    /// This is what makes enrolment and revocation operational without a restart. Before it,
    /// admitting a device the operator had just enrolled meant restarting the whole runtime:
    /// the wrong granularity by a wide margin, and a `401` with no explanation for anyone who
    /// enrolled after the boot.
    ///
    /// A no-op when no gate is bound — there is no path to watch, and nothing declared means
    /// nothing to claim. `pub` for the same reason `resolve` is: `main.rs` is a separate
    /// crate, and keeping the spawn there keeps "once per daemon start" true of the watcher
    /// exactly as it is of the resolution.
    pub fn spawn_reload_watcher(&self) {
        self.spawn_reload_watcher_every(RELOAD_POLL_INTERVAL);
    }

    /// The watcher, with its period named. Split out so the test suite can drive the REAL
    /// loop — same task, same `reload_if_changed`, same fail-closed rule — at a period that
    /// costs no wall-clock seconds, rather than either sleeping through two-second polls or
    /// pulling in tokio's `test-util` feature to fake the clock. The period is a constant,
    /// not a decision: nothing in the loop's behaviour depends on its value.
    fn spawn_reload_watcher_every(&self, period: Duration) {
        let Some(gate) = self.gate.clone() else {
            return;
        };
        tracing::info!(
            path = %gate.state.located.path.display(),
            poll_ms = period.as_millis() as u64,
            "watching the auth policy for changes — enrolment and revocation take effect \
             without restarting the runtime"
        );
        tokio::spawn(async move {
            let mut ticker = tokio::time::interval(period);
            // A tick missed because the host was busy must not become a burst of catch-up
            // reads of a file that changes a few times a year.
            ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
            loop {
                ticker.tick().await;
                gate.reload_if_changed();
            }
        });
    }

    /// Test-only: a resolved value built WITHOUT resolving, for tests that inject a policy
    /// directly (hermetic — no env mutation, no file on disk).
    #[cfg(test)]
    pub(crate) fn from_policy(policy: Option<AuthPolicy>) -> Self {
        Self { gate: policy.map(AuthGate::for_test) }
    }
}

/// The bearer token from `Authorization: Bearer <token>`, if present and non-empty. PURE.
fn bearer_token(request: &Request<Body>) -> Option<String> {
    let raw = request.headers().get(header::AUTHORIZATION)?.to_str().ok()?;
    let token = raw
        .strip_prefix("Bearer ")
        .or_else(|| raw.strip_prefix("bearer "))?
        .trim();
    (!token.is_empty()).then(|| token.to_string())
}

/// The identity THIS LISTENER's gate resolved for the request in hand — attached by
/// [`auth_middleware`] itself, from the credential it has just verified.
///
/// It exists so a handler can ATTRIBUTE an action to a device without ever asking the caller
/// who they are (P3 of the pending-prompt design). The guarantee is structural: this value is
/// only ever constructed here, out of a `gate.authenticate` result, and axum populates request
/// extensions server-side only — nothing a caller sends can produce one. A listener
/// constructed WITHOUT the credential layer (the node-local socket) therefore has no
/// extension at all, and a handler that finds none knows it was not authenticated rather than
/// being told so by the request.
///
/// Not a credential and not a secret: it is the identity label the policy already stores in
/// plaintext, and naming it is the whole point of an attribution.
#[derive(Debug, Clone)]
pub(crate) struct AuthenticatedDevice(pub(crate) String);

fn unauthorized(reason: &str) -> Response<Body> {
    let body = serde_json::json!({ "error": "unauthorized", "reason": reason }).to_string();
    Response::builder()
        .status(StatusCode::UNAUTHORIZED)
        .header(header::CONTENT_TYPE, "application/json")
        .header(header::WWW_AUTHENTICATE, "Bearer")
        .body(Body::from(body))
        .unwrap_or_else(|_| Response::new(Body::empty()))
}

/// Axum middleware: reject any request without a valid enrolled credential. An
/// authenticated request passes through carrying the identity the gate resolved for it
/// ([`AuthenticatedDevice`]) and nothing else changed.
///
/// Takes the live `AuthGate`, not a copy of the policy: the layer is built once when the
/// router is, and a copy taken there would be the policy as it stood at boot forever — which
/// is precisely the restart-to-enroll defect, and worse, restart-to-REVOKE.
///
/// The identity is attached HERE, at the one place it is known, rather than re-derived by a
/// handler: a handler that re-read the `Authorization` header would be a second
/// authentication path, and a handler that read the identity out of a request BODY would let
/// a caller name itself. Neither is possible when the only producer is the verification
/// itself.
pub(crate) async fn auth_middleware(
    gate: AuthGate,
    mut request: Request<Body>,
    next: Next,
) -> Response<Body> {
    match bearer_token(&request) {
        None => unauthorized("missing"),
        Some(token) => match gate.authenticate(&token) {
            Some(identity) => {
                request.extensions_mut().insert(AuthenticatedDevice(identity));
                next.run(request).await
            }
            None => unauthorized("invalid"),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sha256_hex_is_deterministic_and_lowercase_hex() {
        let a = sha256_hex("secret-token");
        assert_eq!(a, sha256_hex("secret-token"));
        assert_ne!(a, sha256_hex("other"));
        assert_eq!(a.len(), 64);
        assert!(a.chars().all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase()));
    }

    #[test]
    fn authenticate_maps_a_known_token_to_its_identity() {
        let policy = AuthPolicy::from_credentials(vec![Credential {
            token_sha256: sha256_hex("arthur-device-1"),
            identity: "id-arthur".to_string(),
        }]);
        assert_eq!(policy.authenticate("arthur-device-1"), Some("id-arthur"));
        assert_eq!(policy.authenticate("wrong"), None);
    }

    #[test]
    fn deny_all_authenticates_nothing() {
        let policy = AuthPolicy::deny_all();
        assert_eq!(policy.authenticate("anything"), None);
    }

    // ── the derived policy path: declaring the gate IS the plumbing ────────────────

    /// A refarm dir under a fresh temp root, plus the source for it. `gate` is what the
    /// `surfaces` declaration says; the dir is what `--refarm-dir` gave the daemon.
    fn source_for(dir: &std::path::Path, gate: bool) -> AuthPolicySource {
        AuthPolicySource::new(dir.to_path_buf(), gate)
    }

    /// Write a policy enrolling exactly one `token` at `path`. Returns nothing — the
    /// assertion is always "does resolving find THIS credential", never the file's bytes.
    fn write_policy(path: &std::path::Path, token: &str, identity: &str) {
        write_policy_many(path, &[(token, identity)]);
    }

    /// The same, for an enrolment set — the shape `refarm auth enroll` writes when more than
    /// one device is enrolled, and what the reload tests add to and remove from.
    fn write_policy_many(path: &std::path::Path, enrolled: &[(&str, &str)]) {
        std::fs::write(path, policy_bytes(enrolled)).unwrap();
    }

    /// The bytes of a policy file, so a test can write a PREFIX of them (a truncated write).
    fn policy_bytes(enrolled: &[(&str, &str)]) -> Vec<u8> {
        let credentials: Vec<_> = enrolled
            .iter()
            .map(|(token, identity)| {
                serde_json::json!({ "identity": identity, "tokenSha256": sha256_hex(token) })
            })
            .collect();
        serde_json::to_vec_pretty(&serde_json::json!({ "credentials": credentials })).unwrap()
    }

    type LogBuffer = std::sync::Arc<std::sync::Mutex<Vec<u8>>>;

    struct Sink(LogBuffer);
    impl std::io::Write for Sink {
        fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
            self.0.lock().unwrap().extend_from_slice(buf);
            Ok(buf.len())
        }
        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }

    fn log_subscriber(buffer: LogBuffer) -> impl tracing::Subscriber + Send + Sync {
        tracing_subscriber::fmt()
            .with_max_level(tracing::Level::TRACE)
            .with_ansi(false)
            .with_writer(move || Sink(buffer.clone()))
            .finish()
    }

    fn drain(buffer: &LogBuffer) -> String {
        String::from_utf8_lossy(&buffer.lock().unwrap().clone()).to_string()
    }

    /// Capture everything `tracing` emits while `f` runs. Used both ways: to prove the
    /// derived-but-absent line IS emitted, and to prove the cheap peek emits NOTHING.
    fn captured_logs(f: impl FnOnce()) -> String {
        let buffer: LogBuffer = Default::default();
        tracing::subscriber::with_default(log_subscriber(buffer.clone()), f);
        drain(&buffer)
    }

    /// The same capture as a GUARD, for async tests: a daemon boot spans `.await` points, so
    /// it cannot be wrapped in one closure. Hold the guard across the boot, drop it, read the
    /// buffer. Sound under `#[tokio::test]`'s single-threaded runtime — the guard is
    /// thread-local and the whole test body stays on one thread.
    fn capture_logs_until_dropped() -> (LogBuffer, tracing::subscriber::DefaultGuard) {
        let buffer: LogBuffer = Default::default();
        let guard = tracing::subscriber::set_default(log_subscriber(buffer.clone()));
        (buffer, guard)
    }

    #[test]
    fn declared_gate_derives_the_conventional_path_and_parses_the_policy_there() {
        // The defect this closes: `refarm auth enroll` writes `<refarm-dir>/auth-policy.json`
        // by default, and the reader used to demand `REFARM_AUTH_POLICY` before it would
        // look there. Declaring the gate must be enough — no env at all.
        let _env = crate::test_support::env_lock();
        std::env::remove_var(AUTH_POLICY_ENV);
        let dir = tempfile::tempdir().unwrap();
        write_policy(&dir.path().join(AUTH_POLICY_FILE_NAME), "declared-token", "id-arthur");

        let source = source_for(dir.path(), true);
        assert!(auth_policy_configured(&source), "a declared gate makes a policy resolvable");
        let gate = resolve_auth_policy(&source).expect("declared gate ⇒ Some");
        assert_eq!(gate.authenticate("declared-token").as_deref(), Some("id-arthur"));
    }

    #[test]
    fn declared_gate_with_no_policy_file_yet_is_deny_all_and_says_so_once() {
        // MUTATION GUARD. Two ways this rots: (a) an absent derived policy going back to
        // `None`, which would REFUSE the bind and lock the operator out of a runtime that
        // will not boot; (b) an absent derived policy resolving to an EMPTY-but-permissive
        // policy. Neither: bind, and deny everything, loudly — the strictest possible
        // enforcement of the gate the operator declared but has not yet enrolled into.
        let _env = crate::test_support::env_lock();
        std::env::remove_var(AUTH_POLICY_ENV);
        let dir = tempfile::tempdir().unwrap();
        let derived = dir.path().join(AUTH_POLICY_FILE_NAME);
        assert!(!derived.exists(), "the whole point is that it is NOT there yet");

        let source = source_for(dir.path(), true);
        assert!(auth_policy_configured(&source), "declared ⇒ resolvable ⇒ the bind is permitted");

        let mut resolved = None;
        let logs = captured_logs(|| resolved = resolve_auth_policy(&source));
        let gate = resolved.expect("an absent derived policy must be Some(deny_all), never None");
        assert_eq!(gate.authenticate("anything-at-all"), None, "deny ALL");

        // The line must be findable by an operator staring at an unexplained 401.
        assert!(logs.contains(&derived.display().to_string()), "must name the derived path: {logs}");
        assert!(logs.contains("ABSENT"), "must say the file is absent: {logs}");
        assert!(logs.contains("refarm auth enroll"), "must name the fix: {logs}");
    }

    #[test]
    fn env_overrides_the_derivation_even_when_the_derived_path_also_exists() {
        // MUTATION GUARD for precedence. Both files exist and enroll DIFFERENT tokens, so
        // an implementation that quietly prefers the derived path (or merges the two) fails
        // here rather than in production. The operator's explicit value always wins.
        let _env = crate::test_support::env_lock();
        let dir = tempfile::tempdir().unwrap();
        write_policy(&dir.path().join(AUTH_POLICY_FILE_NAME), "derived-token", "id-derived");
        let override_path = dir.path().join("elsewhere.json");
        write_policy(&override_path, "override-token", "id-override");

        std::env::set_var(AUTH_POLICY_ENV, &override_path);
        let gate = resolve_auth_policy(&source_for(dir.path(), true)).expect("Some");
        std::env::remove_var(AUTH_POLICY_ENV);

        assert_eq!(gate.authenticate("override-token").as_deref(), Some("id-override"));
        assert_eq!(gate.authenticate("derived-token"), None, "the derived file must be ignored");
    }

    #[test]
    fn env_override_wins_even_with_no_gate_declared() {
        // The override is not conditional on a declaration — it is how a policy is used
        // for a surface that never declared one (and how the pre-declaration world worked).
        let _env = crate::test_support::env_lock();
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("explicit.json");
        write_policy(&path, "explicit-token", "id-explicit");

        std::env::set_var(AUTH_POLICY_ENV, &path);
        let source = source_for(dir.path(), false);
        let configured = auth_policy_configured(&source);
        let policy = resolve_auth_policy(&source);
        std::env::remove_var(AUTH_POLICY_ENV);

        assert!(configured);
        assert_eq!(
            policy.expect("Some").authenticate("explicit-token").as_deref(),
            Some("id-explicit")
        );
    }

    #[test]
    fn env_set_but_blank_behaves_exactly_as_unset() {
        // PIN. Blank is not a value and never was: today it means "the env decides
        // nothing", identically to unset — in BOTH directions. It is not a way to switch a
        // declared gate off (that is done by editing the declaration), and it is not a way
        // to turn one on. Easy to regress into "set ⇒ Some(deny_all)" or "blank ⇒ hard off".
        let _env = crate::test_support::env_lock();
        let dir = tempfile::tempdir().unwrap();
        write_policy(&dir.path().join(AUTH_POLICY_FILE_NAME), "declared-token", "id-arthur");

        for blank in ["", "   ", "\t\n"] {
            std::env::remove_var(AUTH_POLICY_ENV);
            let unset_no_gate = auth_policy_configured(&source_for(dir.path(), false));
            let unset_gated = auth_policy_configured(&source_for(dir.path(), true));

            std::env::set_var(AUTH_POLICY_ENV, blank);
            let blank_no_gate = auth_policy_configured(&source_for(dir.path(), false));
            let blank_gated = auth_policy_configured(&source_for(dir.path(), true));
            let blank_policy = resolve_auth_policy(&source_for(dir.path(), true));
            std::env::remove_var(AUTH_POLICY_ENV);

            assert_eq!(blank_no_gate, unset_no_gate, "blank {blank:?} must equal unset (no gate)");
            assert!(!blank_no_gate, "blank + nothing declared ⇒ no policy, exactly as today");
            assert_eq!(blank_gated, unset_gated, "blank {blank:?} must equal unset (gated)");
            assert!(blank_gated, "blank is not a value — the declaration still decides");
            assert_eq!(
                blank_policy.expect("gated ⇒ Some").authenticate("declared-token").as_deref(),
                Some("id-arthur"),
                "blank must fall through to the DERIVED path, not to a deny-all"
            );
        }
    }

    #[test]
    fn nothing_declared_and_no_env_resolves_to_no_policy_at_all() {
        // The secure default stays OFF-by-absence: no declaration, no env ⇒ no layer, byte
        // -identical to before the gate existed. A policy file sitting at the conventional
        // path does NOT switch the gate on by itself — the DECLARATION is the opt-in.
        let _env = crate::test_support::env_lock();
        std::env::remove_var(AUTH_POLICY_ENV);
        let dir = tempfile::tempdir().unwrap();
        write_policy(&dir.path().join(AUTH_POLICY_FILE_NAME), "stray-token", "id-stray");

        let source = source_for(dir.path(), false);
        assert!(!auth_policy_configured(&source));
        assert!(resolve_auth_policy(&source).is_none(), "no declaration ⇒ no gate");
    }

    #[test]
    fn a_derived_policy_that_exists_but_is_invalid_is_deny_all() {
        // Preserved from the env-only world, now for the derived path too: a broken policy
        // locks the door. Distinct from ABSENT — the file is there and unparseable, which
        // is an error, not "not enrolled yet".
        let _env = crate::test_support::env_lock();
        std::env::remove_var(AUTH_POLICY_ENV);
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join(AUTH_POLICY_FILE_NAME), "{ not json").unwrap();

        let gate = resolve_auth_policy(&source_for(dir.path(), true)).expect("Some(deny_all)");
        assert_eq!(gate.authenticate("anything"), None);
    }

    #[test]
    fn env_set_to_a_missing_file_is_still_deny_all_exactly_as_before() {
        // Today's behaviour, pinned: the operator named a path; a path that isn't there is
        // their error, and it fails closed rather than silently ungated.
        let _env = crate::test_support::env_lock();
        let dir = tempfile::tempdir().unwrap();
        std::env::set_var(AUTH_POLICY_ENV, dir.path().join("not-there.json"));
        let configured = auth_policy_configured(&source_for(dir.path(), false));
        let policy = resolve_auth_policy(&source_for(dir.path(), false));
        std::env::remove_var(AUTH_POLICY_ENV);

        assert!(configured, "set + unreadable ⇒ still resolvable (unchanged)");
        assert_eq!(policy.expect("Some(deny_all)").authenticate("anything"), None);
    }

    #[test]
    fn auth_policy_configured_answers_resolvable_and_stays_silent() {
        // Its contract: "is a policy RESOLVABLE" (declaration-derived or env), cheaply and
        // WITHOUT logging. The silence is load-bearing — it runs in the WS bind preflight
        // before the runtime boots, and the enable/deny-all line must come from exactly one
        // resolution path (`resolve_auth_policy`), once, or the operator reads it twice and
        // stops trusting it.
        let _env = crate::test_support::env_lock();
        std::env::remove_var(AUTH_POLICY_ENV);
        let dir = tempfile::tempdir().unwrap();

        let logs = captured_logs(|| {
            assert!(!auth_policy_configured(&source_for(dir.path(), false)), "nothing ⇒ false");
            // Derived, with NO file on disk — the exact case `resolve_auth_policy` DOES log
            // about. The peek must not read the file, and must not say a word.
            assert!(auth_policy_configured(&source_for(dir.path(), true)), "declared ⇒ true");
            std::env::set_var(AUTH_POLICY_ENV, "/nonexistent/policy.json");
            assert!(auth_policy_configured(&source_for(dir.path(), false)), "env ⇒ true");
            std::env::remove_var(AUTH_POLICY_ENV);
        });
        assert!(logs.is_empty(), "the cheap peek must emit no log line, got: {logs}");
    }

    #[test]
    fn the_derived_file_name_is_the_one_refarm_auth_enroll_writes() {
        // One convention, both sides. `apps/refarm/src/commands/auth.ts`'s
        // DEFAULT_POLICY_PATH is `.refarm/auth-policy.json`; the daemon joins this name
        // onto the refarm dir it was given. If either side renames the file alone, the
        // writer and the reader silently stop meeting — which was the original defect.
        assert_eq!(AUTH_POLICY_FILE_NAME, "auth-policy.json");
        let source = AuthPolicySource::new(std::path::PathBuf::from("/farm/.refarm"), true);
        let located = resolve_policy_path(&source).expect("declared ⇒ a path");
        assert_eq!(located.path, std::path::PathBuf::from("/farm/.refarm/auth-policy.json"));
        assert!(located.derived, "no env ⇒ derived, not an override");
    }

    #[test]
    fn the_derived_path_comes_from_the_given_refarm_dir_not_a_hardcoded_dot_refarm() {
        // The daemon is GIVEN `--refarm-dir`; re-deriving `.refarm` from cwd (or hardcoding
        // it) is how two readers start disagreeing about which farm they are reading.
        let _env = crate::test_support::env_lock();
        std::env::remove_var(AUTH_POLICY_ENV);
        let source = AuthPolicySource::new(std::path::PathBuf::from("/srv/other-farm"), true);
        let located = resolve_policy_path(&source).expect("declared ⇒ a path");
        assert_eq!(located.path, std::path::PathBuf::from("/srv/other-farm/auth-policy.json"));
    }

    // ── ONE resolution per daemon start: the answer travels, not the source ───────

    /// A `WsServer` holding `resolved`, on a host its own bind guard REFUSES (non-loopback
    /// with no declaration — S1). The refusal happens inside the real `start`, after all of
    /// its policy handling and before `TcpListener::bind`, so these tests drive the true
    /// production entry point without ever opening a socket.
    fn ws_gate(resolved: ResolvedAuthPolicy) -> crate::daemon::WsServer {
        let storage = crate::NativeStorage::open(":memory:").unwrap();
        crate::daemon::WsServer::new(
            std::sync::Arc::new(crate::NativeSync::new(storage, ":memory:").unwrap()),
            "0.0.0.0".to_string(),
            0,
            crate::TelemetryBus::new(4),
            std::sync::Arc::new(std::sync::RwLock::new(std::collections::HashMap::new())),
            crate::EventRouter::default(),
            None,
            resolved,
        )
    }

    /// The HTTP sidecar's real entry point, refused by its own bind guard for the same
    /// reason and at the same point — after the policy is handled, before the reaper spawns
    /// or anything binds.
    async fn http_gate(dir: &std::path::Path, resolved: ResolvedAuthPolicy) -> anyhow::Result<()> {
        let state = crate::sidecar::SidecarState::for_test(dir, ":memory:").unwrap();
        crate::sidecar::start(state, Some("0.0.0.0".to_string()), 0, None, resolved).await
    }

    #[tokio::test]
    async fn a_daemon_start_logs_the_deny_all_line_exactly_once_across_both_gates() {
        // THE BUG, pinned. `sidecar::start` and `daemon::WsServer::start` each used to call
        // `resolve_auth_policy` for themselves, so a real boot with a declared-but-unenrolled
        // gate printed the derived-but-ABSENT warning TWICE, ~10µs apart — and the noise was
        // the mild half: two independent reads of one file are two answers that can disagree.
        //
        // This reproduces a boot against the REAL entry points — resolve once, hand the same
        // value to both gates — and counts the line. Two is the defect; one is the contract.
        let _env = crate::test_support::env_lock();
        std::env::remove_var(AUTH_POLICY_ENV);
        let dir = tempfile::tempdir().unwrap();
        let source = source_for(dir.path(), true);
        assert!(
            !dir.path().join(AUTH_POLICY_FILE_NAME).exists(),
            "the gate is declared and enrollment has not happened — the case that warns"
        );

        let (logs, guard) = capture_logs_until_dropped();

        // Exactly what main.rs does: ONE resolution per daemon start …
        let resolved = ResolvedAuthPolicy::resolve(&source);
        // … then the SAME value into both gates, neither of which holds a source to
        // re-resolve from. Both refuse the bind, which is how they return without a socket.
        assert!(
            http_gate(dir.path(), resolved.clone()).await.is_err(),
            "the sidecar's bind guard must refuse 0.0.0.0 with no declaration (S1)"
        );
        assert!(
            ws_gate(resolved).start().await.is_err(),
            "the WS bind guard must refuse 0.0.0.0 with no declaration (S1)"
        );

        drop(guard);
        let logs = drain(&logs);
        assert_eq!(
            logs.matches("ABSENT").count(),
            1,
            "the deny-all line must be emitted EXACTLY ONCE per daemon start — not once per \
             gate. A second count here means a gate resolved the policy for itself again: \
             {logs}"
        );
    }

    #[tokio::test]
    async fn a_policy_readable_at_resolution_time_reaches_both_gates_as_one_value() {
        // The other half of "resolve once": the value that travels must be the RESOLVED one,
        // not an empty placeholder each gate is expected to fill in later. With a real policy
        // file on disk, one resolution must produce one policy that BOTH gates carry — the
        // sidecar into its middleware layer, the WS server into its handshake gate — and it
        // must authenticate the enrolled credential in both. (That both ENFORCE it over a
        // real socket is proven end-to-end in `daemon::ws_server`'s
        // `one_resolution_is_the_policy_both_gates_really_enforce`.)
        let _env = crate::test_support::env_lock();
        std::env::remove_var(AUTH_POLICY_ENV);
        let dir = tempfile::tempdir().unwrap();
        write_policy(&dir.path().join(AUTH_POLICY_FILE_NAME), "shared-token", "id-shared");

        let resolved = ResolvedAuthPolicy::resolve(&source_for(dir.path(), true));
        assert!(resolved.is_gated(), "a readable declared policy ⇒ the gate is bound");
        assert_eq!(
            resolved.gate().expect("gated ⇒ Some").authenticate("shared-token").as_deref(),
            Some("id-shared"),
            "the value handed to both gates must be the policy that was actually READ"
        );

        // Deleting the file changes nothing until the daemon LOOKS again: the gates hold the
        // resolved value, not a promise to re-read on every request. (What happens when it
        // does look is `a_disappeared_policy_file_reloads_to_deny_all`, below.)
        std::fs::remove_file(dir.path().join(AUTH_POLICY_FILE_NAME)).unwrap();
        let for_http = resolved.gate().expect("gated ⇒ Some");
        let for_ws = resolved.gate().expect("gated ⇒ Some");
        assert_eq!(
            for_http.authenticate("shared-token"),
            for_ws.authenticate("shared-token"),
            "both gates must hold the same answer, from the same single read"
        );
        assert_eq!(for_ws.authenticate("some-other-token"), None);
    }

    #[test]
    fn resolving_through_the_shared_value_keeps_all_four_cases_intact() {
        // The wrapper is PLUMBING — who calls the resolution, not what it decides. All four
        // cases must answer exactly as they did when each gate resolved for itself.
        let _env = crate::test_support::env_lock();
        let dir = tempfile::tempdir().unwrap();
        let derived = dir.path().join(AUTH_POLICY_FILE_NAME);
        let override_path = dir.path().join("elsewhere.json");
        write_policy(&derived, "derived-token", "id-derived");
        write_policy(&override_path, "override-token", "id-override");

        // 1. env override wins over the derivation.
        std::env::set_var(AUTH_POLICY_ENV, &override_path);
        let overridden = ResolvedAuthPolicy::resolve(&source_for(dir.path(), true));
        std::env::remove_var(AUTH_POLICY_ENV);
        let gate = overridden.gate().expect("override ⇒ Some");
        assert_eq!(gate.authenticate("override-token").as_deref(), Some("id-override"));
        assert_eq!(gate.authenticate("derived-token"), None, "the derived file is ignored");

        // 2. declared gate, env unset ⇒ the derived path.
        let derived_only = ResolvedAuthPolicy::resolve(&source_for(dir.path(), true));
        assert_eq!(
            derived_only.gate().expect("declared ⇒ Some").authenticate("derived-token").as_deref(),
            Some("id-derived")
        );

        // 3. declared gate, file absent ⇒ bound and deny-all, never None.
        let empty = tempfile::tempdir().unwrap();
        let absent = ResolvedAuthPolicy::resolve(&source_for(empty.path(), true));
        assert!(absent.is_gated(), "absent must still BIND the gate");
        assert_eq!(absent.gate().unwrap().authenticate("anything"), None, "deny ALL");

        // 4. nothing declared, no env ⇒ no gate at all, even with a file sitting there.
        let undeclared = ResolvedAuthPolicy::resolve(&source_for(dir.path(), false));
        assert!(!undeclared.is_gated());
        assert!(undeclared.gate().is_none(), "no declaration ⇒ no gate");
    }

    #[test]
    fn the_cheap_peek_agrees_with_the_one_resolution_in_every_case() {
        // The WS bind preflight still runs BEFORE the single resolution and still answers
        // from `auth_policy_configured` — no file read, no log line, so it can refuse a bad
        // `--ws-host` as the daemon's first act. That ordering is only honest while the peek
        // and the resolution cannot disagree: both are exactly "`resolve_policy_path` is
        // `Some`". If they ever diverge, the preflight would permit a bind the gate does not
        // actually guard (or refuse one it does).
        let _env = crate::test_support::env_lock();
        let dir = tempfile::tempdir().unwrap();
        write_policy(&dir.path().join(AUTH_POLICY_FILE_NAME), "tok", "id");
        let missing = dir.path().join("not-there.json");

        for (label, env, gate) in [
            ("nothing declared, no env", None, false),
            ("declared, no env (derived)", None, true),
            ("env override, no declaration", Some(missing.clone()), false),
            ("env override + declaration", Some(missing.clone()), true),
            ("blank env, declared", Some(std::path::PathBuf::from("  ")), true),
            ("blank env, undeclared", Some(std::path::PathBuf::from("  ")), false),
        ] {
            match &env {
                Some(v) => std::env::set_var(AUTH_POLICY_ENV, v),
                None => std::env::remove_var(AUTH_POLICY_ENV),
            }
            let source = source_for(dir.path(), gate);
            let peeked = auth_policy_configured(&source);
            let resolved = ResolvedAuthPolicy::resolve(&source).is_gated();
            std::env::remove_var(AUTH_POLICY_ENV);
            assert_eq!(peeked, resolved, "peek and resolution disagree for: {label}");
        }
    }

    // ── hot reload: the policy follows the FILE, and no gate restarts ─────────────
    //
    // The operational fact these pin: `refarm auth enroll` writes this file while the daemon
    // is running. Reading it only at boot made enrolling a device require a full runtime
    // restart before its credential was accepted — and, in the direction that actually
    // matters, made REVOKING one require a restart before it stopped being accepted.

    /// The one resolution, on a declared gate over a real temp refarm dir, with `enrolled`
    /// already written. Returns the dir (kept alive), the policy path, and the live gate —
    /// exactly the handle `sidecar::start` and `WsServer::start` each clone.
    fn resolved_gate(enrolled: &[(&str, &str)]) -> (tempfile::TempDir, PathBuf, AuthGate) {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(AUTH_POLICY_FILE_NAME);
        write_policy_many(&path, enrolled);
        let gate = ResolvedAuthPolicy::resolve(&source_for(dir.path(), true))
            .gate()
            .expect("a declared gate ⇒ a bound gate");
        (dir, path, gate)
    }

    #[test]
    fn a_credential_added_to_the_file_is_accepted_without_a_restart() {
        // The operator's Tuesday: the daemon is up, the phone is enrolled, and the phone
        // works. Before this, the enrolment landed in the file and the running daemon never
        // looked again — a 401 with no explanation for anyone who enrolled after the boot.
        let _env = crate::test_support::env_lock();
        std::env::remove_var(AUTH_POLICY_ENV);
        let (_dir, path, gate) = resolved_gate(&[("laptop-token", "id-laptop")]);
        assert_eq!(gate.authenticate("phone-token"), None, "not enrolled yet ⇒ rejected");

        write_policy_many(&path, &[("laptop-token", "id-laptop"), ("phone-token", "id-phone")]);
        assert!(gate.reload_if_changed(), "the file changed ⇒ the policy is re-read");

        assert_eq!(
            gate.authenticate("phone-token").as_deref(),
            Some("id-phone"),
            "the newly enrolled device must be admitted by the RUNNING daemon"
        );
        assert_eq!(
            gate.authenticate("laptop-token").as_deref(),
            Some("id-laptop"),
            "and the device that was already enrolled must not be disturbed"
        );
    }

    #[test]
    fn a_credential_removed_from_the_file_stops_being_accepted_without_a_restart() {
        // MUTATION GUARD, and the more important direction. Revocation is the one that is
        // dangerous to get wrong: a stolen phone whose credential the operator has deleted
        // must stop working NOW, not at the next restart — and a reload that only ever ADDS
        // (merging into the policy in force instead of REPLACING it) would pass the
        // enrolment test above and silently fail here forever.
        let _env = crate::test_support::env_lock();
        std::env::remove_var(AUTH_POLICY_ENV);
        let (_dir, path, gate) =
            resolved_gate(&[("laptop-token", "id-laptop"), ("phone-token", "id-phone")]);
        assert_eq!(gate.authenticate("phone-token").as_deref(), Some("id-phone"));

        // The revocation: the file is rewritten WITHOUT the phone.
        write_policy_many(&path, &[("laptop-token", "id-laptop")]);
        assert!(gate.reload_if_changed(), "the file changed ⇒ the policy is re-read");

        assert_eq!(
            gate.authenticate("phone-token"),
            None,
            "a REVOKED credential must stop authenticating in the running daemon"
        );
        assert_eq!(
            gate.authenticate("laptop-token").as_deref(),
            Some("id-laptop"),
            "revoking one device must not evict the others"
        );
    }

    #[test]
    fn a_policy_that_becomes_invalid_never_widens_access() {
        // MUTATION GUARD. Fail-closed on re-read, by the SAME rule as boot
        // (`a_derived_policy_that_exists_but_is_invalid_is_deny_all`): a policy that cannot
        // be believed locks the door. The dangerous mutations are silent — parse failure
        // leaving the previous policy in force (a revoked credential surviving a corrupt
        // write, indefinitely), or worse, a failed parse being treated as "no constraints".
        let _env = crate::test_support::env_lock();
        std::env::remove_var(AUTH_POLICY_ENV);
        let (_dir, path, gate) = resolved_gate(&[("laptop-token", "id-laptop")]);
        assert_eq!(gate.authenticate("laptop-token").as_deref(), Some("id-laptop"));

        std::fs::write(&path, "{ not json").unwrap();
        let logs = captured_logs(|| {
            assert!(gate.reload_if_changed(), "a broken file is a CHANGE, and must be acted on");
        });

        assert_eq!(gate.authenticate("laptop-token"), None, "deny-all, not last-known-good");
        assert_eq!(gate.authenticate("anything-else"), None, "and certainly not ungated");
        assert!(logs.contains("DENY-ALL"), "the operator must be told the door shut: {logs}");
        assert!(
            !logs.contains("auth policy reloaded"),
            "a broken file must never be reported as a successful reload: {logs}"
        );
    }

    #[test]
    fn an_unreadable_policy_file_never_widens_access() {
        // The other half of "cannot be believed": the bytes are there but the process may
        // not have them (a permission change, a mount going away). Same answer as invalid —
        // deny-all — because "I could not read the policy" is not "there is no policy".
        let _env = crate::test_support::env_lock();
        std::env::remove_var(AUTH_POLICY_ENV);
        let (_dir, path, gate) = resolved_gate(&[("laptop-token", "id-laptop")]);
        assert_eq!(gate.authenticate("laptop-token").as_deref(), Some("id-laptop"));

        // A DIRECTORY where the file was: `read_to_string` fails with something that is
        // neither NotFound nor a parse error — the third branch, reached without needing to
        // run as a non-root user (in a container, chmod 000 does not stop root).
        std::fs::remove_file(&path).unwrap();
        std::fs::create_dir(&path).unwrap();

        assert!(gate.reload_if_changed(), "unreadable is a change");
        assert_eq!(gate.authenticate("laptop-token"), None, "deny-all, not last-known-good");
    }

    #[test]
    fn a_truncated_write_is_never_observed_as_a_valid_empty_policy() {
        // Enrolment WRITES this file, so a partial read is a real race, not a theory. The
        // failure to design against is a half-written file being taken for a policy: parsed
        // as "no credentials" and reported as a clean reload, which reads in the log exactly
        // like a deliberate revocation of every device. It cannot be — truncated JSON does
        // not parse — and the log must say so.
        let _env = crate::test_support::env_lock();
        std::env::remove_var(AUTH_POLICY_ENV);
        let (_dir, path, gate) = resolved_gate(&[("laptop-token", "id-laptop")]);

        let complete = policy_bytes(&[("laptop-token", "id-laptop"), ("phone-token", "id-phone")]);
        for cut in [1, complete.len() / 3, complete.len() / 2, complete.len() - 1] {
            std::fs::write(&path, &complete[..cut]).unwrap();
            let logs = captured_logs(|| {
                gate.reload_if_changed();
            });
            assert!(
                !logs.contains("auth policy reloaded"),
                "a {cut}-byte prefix must not be reported as a successful reload: {logs}"
            );
            assert_eq!(gate.authenticate("phone-token"), None, "a prefix enrols nobody");
            assert_eq!(gate.authenticate("laptop-token"), None, "and admits nobody: deny-all");
        }

        // …and the write COMPLETING is itself a change, so the gate is not wedged shut by
        // having observed the prefix: the enrolment lands on the very next read.
        std::fs::write(&path, &complete).unwrap();
        assert!(gate.reload_if_changed(), "the completed write is a change");
        assert_eq!(gate.authenticate("phone-token").as_deref(), Some("id-phone"));
        assert_eq!(gate.authenticate("laptop-token").as_deref(), Some("id-laptop"));
    }

    #[test]
    fn a_disappeared_policy_file_reloads_to_deny_all() {
        // Deleting the policy is not "the gate is off" — the gate is DECLARED, and a
        // declaration is turned off by editing the declaration, never by removing a file.
        let _env = crate::test_support::env_lock();
        std::env::remove_var(AUTH_POLICY_ENV);
        let (_dir, path, gate) = resolved_gate(&[("laptop-token", "id-laptop")]);
        std::fs::remove_file(&path).unwrap();

        let logs = captured_logs(|| assert!(gate.reload_if_changed()));
        assert_eq!(gate.authenticate("laptop-token"), None, "deny ALL");
        assert!(logs.contains("DENY-ALL"), "and say so: {logs}");
    }

    #[test]
    fn both_gates_observe_the_same_value_after_a_reload() {
        // The single-resolution contract, extended through time. Each gate takes its own
        // clone at boot — the HTTP sidecar into its middleware layer
        // (`AuthGate::authenticate`), the WS server into its handshake callback
        // (`AuthGate::snapshot`) — and a clone is an `Arc` bump, not a copy of the
        // credentials. If either gate ever held a SNAPSHOT for the process lifetime, one
        // would keep honouring a credential the other had revoked, with nothing in the log
        // to explain it: the exact drift resolving once was meant to make impossible.
        let _env = crate::test_support::env_lock();
        std::env::remove_var(AUTH_POLICY_ENV);
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(AUTH_POLICY_FILE_NAME);
        write_policy_many(&path, &[("laptop-token", "id-laptop")]);
        let resolved = ResolvedAuthPolicy::resolve(&source_for(dir.path(), true));

        let for_http = resolved.gate().expect("gated");
        let for_ws = resolved.gate().expect("gated");

        // Enrolment, observed by ONE of them …
        write_policy_many(&path, &[("laptop-token", "id-laptop"), ("phone-token", "id-phone")]);
        assert!(for_http.reload_if_changed());
        // … is in force for the OTHER, at the exact call its gate makes.
        assert_eq!(
            for_ws.snapshot().authenticate("phone-token"),
            Some("id-phone"),
            "the WS handshake must see an enrolment applied by the HTTP side"
        );

        // And the reverse, for the direction that matters: a revocation applied by the WS
        // side is in force for the HTTP middleware.
        write_policy_many(&path, &[("laptop-token", "id-laptop")]);
        assert!(for_ws.reload_if_changed());
        assert_eq!(
            for_http.authenticate("phone-token"),
            None,
            "the HTTP gate must see a revocation applied by the WS side"
        );
        assert_eq!(for_http.authenticate("laptop-token").as_deref(), Some("id-laptop"));
        assert_eq!(
            for_http.authenticate("laptop-token").as_deref(),
            for_ws.snapshot().authenticate("laptop-token"),
            "one value, two gates — always"
        );
    }

    #[test]
    fn a_reload_emits_exactly_one_line_and_an_unchanged_file_emits_none() {
        // The one-emitter discipline the boot line already keeps, applied to reloads. Two
        // lines per reload and the operator stops reading them; a line per POLL (every two
        // seconds, forever) and the log is unusable. And the count is what makes a
        // revocation legible — `identities` going down is the confirmation the operator is
        // looking for at the moment they most need it.
        let _env = crate::test_support::env_lock();
        std::env::remove_var(AUTH_POLICY_ENV);
        let (_dir, path, gate) =
            resolved_gate(&[("laptop-token", "id-laptop"), ("phone-token", "id-phone")]);

        let quiet = captured_logs(|| {
            assert!(!gate.reload_if_changed(), "nothing changed ⇒ no reload");
            assert!(!gate.reload_if_changed(), "still nothing changed");
        });
        assert!(quiet.is_empty(), "an unchanged file must say nothing at all: {quiet}");

        write_policy_many(&path, &[("laptop-token", "id-laptop")]);
        let logs = captured_logs(|| {
            assert!(gate.reload_if_changed(), "the revocation is a change");
            assert!(!gate.reload_if_changed(), "and re-reading it is not a second one");
        });
        assert_eq!(
            logs.matches("auth policy reloaded").count(),
            1,
            "exactly ONE line per reload: {logs}"
        );
        assert!(logs.contains("identities=1"), "the new count, so a revocation is visible: {logs}");
        assert!(logs.contains("previously=2"), "and what it was, so the DELTA is visible: {logs}");
        assert!(!logs.contains("id-phone"), "never an identity name: {logs}");
        assert!(!logs.contains(&sha256_hex("phone-token")), "and never a hash: {logs}");
    }

    #[test]
    fn no_declared_gate_means_no_watcher_and_nothing_to_reload() {
        // The secure default stays off-by-absence, watcher included: nothing declared ⇒ no
        // path is watched and no task is spawned. Called OUTSIDE a tokio runtime on purpose
        // — a `tokio::spawn` here would panic, which is the assertion.
        let _env = crate::test_support::env_lock();
        std::env::remove_var(AUTH_POLICY_ENV);
        let dir = tempfile::tempdir().unwrap();
        write_policy(&dir.path().join(AUTH_POLICY_FILE_NAME), "stray-token", "id-stray");

        let resolved = ResolvedAuthPolicy::resolve(&source_for(dir.path(), false));
        assert!(!resolved.is_gated());
        resolved.spawn_reload_watcher();
        assert!(resolved.gate().is_none(), "no declaration ⇒ no gate, and nothing to watch");
    }

    #[tokio::test]
    async fn the_watcher_applies_an_enrolment_and_then_a_revocation_on_its_own() {
        // `reload_if_changed` is what the tests above drive directly; this is the thing that
        // CALLS it in a running daemon. Without this, every assertion above holds and an
        // operator still has to restart, because nothing ever looks at the file.
        //
        // The real loop, at a 5ms period instead of the production two seconds — see
        // `spawn_reload_watcher_every`.
        let _env = crate::test_support::env_lock();
        std::env::remove_var(AUTH_POLICY_ENV);
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(AUTH_POLICY_FILE_NAME);
        write_policy_many(&path, &[("laptop-token", "id-laptop")]);

        let resolved = ResolvedAuthPolicy::resolve(&source_for(dir.path(), true));
        let gate = resolved.gate().expect("gated");
        resolved.spawn_reload_watcher_every(Duration::from_millis(5));

        /// Wait for the watcher to reach `expected`, or give up. Never a bare sleep: the
        /// assertion is what the watcher DID, not how long the test was willing to wait.
        async fn until(gate: &AuthGate, token: &str, expected: Option<&str>) -> bool {
            for _ in 0..200 {
                if gate.authenticate(token).as_deref() == expected {
                    return true;
                }
                tokio::time::sleep(Duration::from_millis(5)).await;
            }
            false
        }

        write_policy_many(&path, &[("laptop-token", "id-laptop"), ("phone-token", "id-phone")]);
        assert!(
            until(&gate, "phone-token", Some("id-phone")).await,
            "the watcher must apply the enrolment with no restart and no prompting"
        );

        write_policy_many(&path, &[("laptop-token", "id-laptop")]);
        assert!(
            until(&gate, "phone-token", None).await,
            "and the revocation, which is the one that must not wait for a restart"
        );
        assert_eq!(
            gate.authenticate("laptop-token").as_deref(),
            Some("id-laptop"),
            "without evicting the device that was never revoked"
        );
    }

    #[test]
    fn parse_policy_reads_credentials_and_ignores_slice2_fields() {
        let raw = r#"{
            "credentials": [{ "identity": "id-arthur", "tokenSha256": "ABC123" }],
            "workspaces": [{ "id": "personal-arthur", "kind": "personal", "namespace": "personal-arthur" }],
            "memberships": [{ "identity": "id-arthur", "workspaces": ["personal-arthur"] }]
        }"#;
        let policy = parse_policy(raw).expect("valid policy");
        // hash is normalized to lowercase; the extra Slice-2 fields are ignored, not an error
        assert_eq!(policy.authenticate_by_hash("abc123"), Some("id-arthur"));
    }

    impl AuthPolicy {
        /// Test helper: look up by an already-hashed value (bypasses sha256 of a raw token).
        fn authenticate_by_hash(&self, hash: &str) -> Option<&str> {
            self.credentials
                .iter()
                .find(|c| c.token_sha256 == hash)
                .map(|c| c.identity.as_str())
        }
    }
}
