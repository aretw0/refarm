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
//! Slice 1 (this module) AUTHENTICATES: enrolled device or not. Which workspace/namespace an
//! identity may act in is authorization — Slice 2 (via `@refarm.dev/workspace-access-contract-v1`).
//! The credential is a bearer token; only its SHA-256 is ever stored in the policy (never the
//! raw token), and the lookup is over hashes. `/sync` (the CRDT WS on :42000) is a separate
//! gate, tracked as a follow-up.

use std::path::PathBuf;

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
/// for callers that only need "is a policy resolvable" (e.g. the WS bind preflight, which runs
/// from `main.rs` BEFORE the runtime boots, before the authoritative read is due) without
/// triggering the enable/deny-all log line that only the one real resolution —
/// `resolve_auth_policy`, called once per surface start — should ever emit. PURE: env
/// inspection and a path join, no file I/O, no logging.
pub(crate) fn auth_policy_configured(source: &AuthPolicySource) -> bool {
    resolve_policy_path(source).is_some()
}

/// Resolve the auth policy ONCE at daemon start — the ONE emitter of the gate's
/// enable/deny-all log line (`auth_policy_configured` above stays silent by design).
///   - no declared gate + no env ⇒ `None` (layer never added — the secure default is off).
///   - resolvable + readable/valid ⇒ the parsed policy (gate on).
///   - DERIVED + the file does not exist yet ⇒ `Some(deny_all)`, with a loud line naming the
///     derived path and `refarm auth enroll`: the gate was declared, so it binds and denies
///     everything until a credential exists. A silent 401 is a ghost hunt.
///   - anything else unreadable/invalid (including an override path that isn't there — the
///     operator's explicit value, so their error to see) ⇒ `Some(deny_all)`, fail-closed.
pub(crate) fn resolve_auth_policy(source: &AuthPolicySource) -> Option<AuthPolicy> {
    let located = resolve_policy_path(source)?;
    let read = std::fs::read_to_string(&located.path);
    if let Ok(raw) = &read {
        if let Ok(policy) = parse_policy(raw) {
            tracing::info!(
                credentials = policy.credentials.len(),
                path = %located.path.display(),
                derived = located.derived,
                "sidecar auth gate enabled (opt-in)"
            );
            return Some(policy);
        }
    }
    let absent = matches!(&read, Err(e) if e.kind() == std::io::ErrorKind::NotFound);
    if absent && located.derived {
        tracing::warn!(
            path = %located.path.display(),
            "auth policy file is ABSENT at the derived path — a surface declares \"gate\": \
             \"device-token\", so the gate is bound and enforced DENY-ALL: every request is \
             rejected 401 until a credential exists. Fix: run `refarm auth enroll`"
        );
    } else {
        tracing::error!(
            path = %located.path.display(),
            "auth policy configured but unreadable/invalid — gating DENY-ALL"
        );
    }
    Some(AuthPolicy::deny_all())
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
/// authenticated request passes through unchanged (Slice 2 will route its workspace).
pub(crate) async fn auth_middleware(
    policy: AuthPolicy,
    request: Request<Body>,
    next: Next,
) -> Response<Body> {
    match bearer_token(&request) {
        None => unauthorized("missing"),
        Some(token) => match policy.authenticate(&token) {
            Some(_identity) => next.run(request).await,
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
        let body = serde_json::json!({
            "credentials": [{ "identity": identity, "tokenSha256": sha256_hex(token) }]
        });
        std::fs::write(path, serde_json::to_vec(&body).unwrap()).unwrap();
    }

    /// Capture everything `tracing` emits while `f` runs. Used both ways: to prove the
    /// derived-but-absent line IS emitted, and to prove the cheap peek emits NOTHING.
    fn captured_logs(f: impl FnOnce()) -> String {
        use std::sync::{Arc, Mutex};
        let buffer = Arc::new(Mutex::new(Vec::<u8>::new()));
        struct Sink(Arc<Mutex<Vec<u8>>>);
        impl std::io::Write for Sink {
            fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
                self.0.lock().unwrap().extend_from_slice(buf);
                Ok(buf.len())
            }
            fn flush(&mut self) -> std::io::Result<()> {
                Ok(())
            }
        }
        let writer = buffer.clone();
        let subscriber = tracing_subscriber::fmt()
            .with_max_level(tracing::Level::TRACE)
            .with_ansi(false)
            .with_writer(move || Sink(writer.clone()))
            .finish();
        tracing::subscriber::with_default(subscriber, f);
        let captured = buffer.lock().unwrap().clone();
        String::from_utf8_lossy(&captured).to_string()
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
        let policy = resolve_auth_policy(&source).expect("declared gate ⇒ Some");
        assert_eq!(policy.authenticate("declared-token"), Some("id-arthur"));
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
        let policy = resolved.expect("an absent derived policy must be Some(deny_all), never None");
        assert_eq!(policy.authenticate("anything-at-all"), None, "deny ALL");

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
        let policy = resolve_auth_policy(&source_for(dir.path(), true)).expect("Some");
        std::env::remove_var(AUTH_POLICY_ENV);

        assert_eq!(policy.authenticate("override-token"), Some("id-override"));
        assert_eq!(policy.authenticate("derived-token"), None, "the derived file must be ignored");
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
        assert_eq!(policy.expect("Some").authenticate("explicit-token"), Some("id-explicit"));
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
                blank_policy.expect("gated ⇒ Some").authenticate("declared-token"),
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

        let policy = resolve_auth_policy(&source_for(dir.path(), true)).expect("Some(deny_all)");
        assert_eq!(policy.authenticate("anything"), None);
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
