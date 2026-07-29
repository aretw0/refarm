//! Opt-in per-device authentication gate for the runtime sidecar.
//!
//! The operator's question — "what stops another device from entering my node?" — is
//! answered here: with a policy configured, every sidecar request must carry a valid
//! per-device bearer credential, or it is rejected `401`. This is the identity gate that
//! sits ABOVE the network gate (Tailscale): the tailnet authenticates the device to the
//! network; this authenticates the device to the FARM.
//!
//! Fail-closed by construction, mirroring the opt-in CORS layer:
//!   - `REFARM_AUTH_POLICY` unset  ⇒ `auth_config_from_env` is `None` ⇒ the layer is never
//!     added ⇒ behavior is byte-identical to today (no gate). The operator turns it on only
//!     once the clients forward a credential.
//!   - `REFARM_AUTH_POLICY` set but unreadable ⇒ a **deny-all** policy (never silently
//!     ungated): if you asked for auth, a broken policy must lock the door, not leave it open.
//!
//! Slice 1 (this module) AUTHENTICATES: enrolled device or not. Which workspace/namespace an
//! identity may act in is authorization — Slice 2 (via `@refarm.dev/workspace-access-contract-v1`).
//! The credential is a bearer token; only its SHA-256 is ever stored in the policy (never the
//! raw token), and the lookup is over hashes. `/sync` (the CRDT WS on :42000) is a separate
//! gate, tracked as a follow-up.

use axum::{
    body::Body,
    http::{header, Request, Response, StatusCode},
    middleware::Next,
};
use sha2::{Digest, Sha256};

/// Env naming the auth policy file. Unset/blank ⇒ gate disabled (the current behavior).
pub(crate) const AUTH_POLICY_ENV: &str = "REFARM_AUTH_POLICY";

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

/// `true` exactly when `REFARM_AUTH_POLICY` is set to a non-blank value — the SAME
/// condition `auth_config_from_env` uses to decide `Some` (gate on, whether or not the
/// file turns out readable — an unreadable policy is still `Some(deny_all)`) vs `None`
/// (gate off). Deliberately does NOT read or parse the file, and emits no log line: this
/// is a cheap presence peek for callers that only need "is a policy configured" (e.g. the
/// WS bind preflight, which runs from `main.rs` BEFORE the runtime boots, before the
/// authoritative read is due) without triggering the enable/deny-all log line that only
/// the one real resolution — `auth_config_from_env`, called once per daemon start — should
/// ever emit. PURE: env inspection only, no file I/O.
pub(crate) fn auth_policy_configured() -> bool {
    std::env::var(AUTH_POLICY_ENV)
        .map(|raw| !raw.trim().is_empty())
        .unwrap_or(false)
}

/// Resolve the auth policy from env ONCE at daemon start.
///   - unset/blank ⇒ `None` (layer never added — the secure default is off, opt-in).
///   - set + readable ⇒ the parsed policy (gate on).
///   - set + unreadable/invalid ⇒ `Some(deny_all)` — fail-closed, never silently ungated.
pub(crate) fn auth_config_from_env() -> Option<AuthPolicy> {
    let path = std::env::var(AUTH_POLICY_ENV).ok()?;
    let path = path.trim();
    if path.is_empty() {
        return None;
    }
    match std::fs::read_to_string(path).ok().and_then(|raw| parse_policy(&raw).ok()) {
        Some(policy) => {
            tracing::info!(credentials = policy.credentials.len(), "sidecar auth gate enabled (opt-in)");
            Some(policy)
        }
        None => {
            tracing::error!(path, "auth policy configured but unreadable/invalid — gating DENY-ALL");
            Some(AuthPolicy::deny_all())
        }
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

    #[test]
    fn auth_policy_configured_matches_env_presence_not_file_readability() {
        let _env = crate::test_support::env_lock();
        std::env::remove_var(AUTH_POLICY_ENV);
        assert!(!auth_policy_configured(), "unset ⇒ not configured");

        std::env::set_var(AUTH_POLICY_ENV, "   ");
        assert!(!auth_policy_configured(), "blank ⇒ not configured");

        // A path that does not exist is still "configured" — presence never depends on
        // readability, exactly like `auth_config_from_env`'s `Some(deny_all)` fallback.
        std::env::set_var(AUTH_POLICY_ENV, "/nonexistent/policy.json");
        assert!(auth_policy_configured(), "set + unreadable ⇒ still configured");

        std::env::remove_var(AUTH_POLICY_ENV);
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
