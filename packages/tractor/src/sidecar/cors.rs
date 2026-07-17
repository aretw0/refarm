//! ADR-088: OPT-IN CORS for the runtime sidecar.
//!
//! The DEFAULT path for a browser chat face is the same-origin proxy on `refarm serve`
//! (the browser never talks cross-origin to `:42001`), so the sidecar's network surface
//! stays closed. This module is the OPT-IN alternative for an operator who serves the
//! face from a different origin WITHOUT a proxy: set `REFARM_SIDECAR_CORS_ORIGINS` to a
//! comma-separated allowlist of origins (or `*` for any), and the sidecar answers CORS
//! preflight + adds the allow-origin header on matching requests.
//!
//! Fail-closed by construction: with the env unset (the default), `cors_config_from_env`
//! is `None` and the middleware is never even layered on — behavior is byte-identical to
//! a no-CORS sidecar. The allow decision is a pure function (native-testable) separate
//! from the axum plumbing.

use axum::{
    body::Body,
    http::{header, HeaderValue, Method, Request, Response, StatusCode},
    middleware::Next,
};

/// The env var naming the CORS allowlist. Unset ⇒ CORS disabled (the secure default).
pub(crate) const CORS_ORIGINS_ENV: &str = "REFARM_SIDECAR_CORS_ORIGINS";

/// The resolved CORS policy: either any origin (`*`) or a closed set of exact origins.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum CorsPolicy {
    /// `*` — reflect any origin. Use only in trusted local/dev setups.
    Any,
    /// A closed allowlist of exact origin strings (e.g. `http://localhost:4321`).
    Allowlist(Vec<String>),
}

impl CorsPolicy {
    /// The origin header value to send for `request_origin`, or `None` to send no CORS
    /// header (request not allowed). For `Any` we reflect the request's own origin (so
    /// credentialed requests still work) rather than a literal `*`. PURE.
    pub(crate) fn allow_origin_for(&self, request_origin: &str) -> Option<String> {
        if request_origin.is_empty() {
            return None;
        }
        match self {
            CorsPolicy::Any => Some(request_origin.to_string()),
            CorsPolicy::Allowlist(origins) => origins
                .iter()
                .any(|o| o == request_origin)
                .then(|| request_origin.to_string()),
        }
    }
}

/// Parse the allowlist env value into a policy. `*` anywhere ⇒ `Any`; otherwise the
/// comma/space-separated exact origins. Blank/empty ⇒ `None` (CORS disabled). PURE.
pub(crate) fn parse_cors_policy(raw: &str) -> Option<CorsPolicy> {
    let tokens: Vec<String> = raw
        .split([',', ' ', '\t', '\n'])
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
        .collect();
    if tokens.is_empty() {
        return None;
    }
    if tokens.iter().any(|t| t == "*") {
        return Some(CorsPolicy::Any);
    }
    Some(CorsPolicy::Allowlist(tokens))
}

/// Resolve the CORS policy from env ONCE at daemon start. `None` (unset/blank) means the
/// middleware is not layered at all — the default secure posture.
pub(crate) fn cors_config_from_env() -> Option<CorsPolicy> {
    parse_cors_policy(&std::env::var(CORS_ORIGINS_ENV).unwrap_or_default())
}

const ALLOW_METHODS: &str = "GET, POST, OPTIONS";
const ALLOW_HEADERS: &str = "content-type";

/// Axum middleware applying `policy` to each request: answers `OPTIONS` preflight and
/// adds the allow-origin/methods/headers to allowed requests. A request whose `Origin`
/// is not allowed passes through UNCHANGED (no CORS headers) — same as a no-CORS sidecar,
/// so the browser rejects it, which is the intended deny.
pub(crate) async fn cors_middleware(
    policy: CorsPolicy,
    request: Request<Body>,
    next: Next,
) -> Response<Body> {
    let origin = request
        .headers()
        .get(header::ORIGIN)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();
    let allow = policy.allow_origin_for(&origin);
    let is_preflight = request.method() == Method::OPTIONS;

    let mut response = if is_preflight {
        // Short-circuit preflight with 204 No Content — never touches a route handler.
        Response::builder()
            .status(StatusCode::NO_CONTENT)
            .body(Body::empty())
            .unwrap_or_else(|_| Response::new(Body::empty()))
    } else {
        next.run(request).await
    };

    if let Some(allow_origin) = allow {
        let headers = response.headers_mut();
        if let Ok(v) = HeaderValue::from_str(&allow_origin) {
            headers.insert(header::ACCESS_CONTROL_ALLOW_ORIGIN, v);
        }
        headers.insert(
            header::ACCESS_CONTROL_ALLOW_METHODS,
            HeaderValue::from_static(ALLOW_METHODS),
        );
        headers.insert(
            header::ACCESS_CONTROL_ALLOW_HEADERS,
            HeaderValue::from_static(ALLOW_HEADERS),
        );
        headers.insert(header::VARY, HeaderValue::from_static("Origin"));
    }
    response
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unset_or_blank_disables_cors() {
        assert_eq!(parse_cors_policy(""), None);
        assert_eq!(parse_cors_policy("   "), None);
        assert_eq!(parse_cors_policy(" , ,\t"), None);
    }

    #[test]
    fn star_anywhere_means_any() {
        assert_eq!(parse_cors_policy("*"), Some(CorsPolicy::Any));
        assert_eq!(
            parse_cors_policy("http://a, *"),
            Some(CorsPolicy::Any),
            "a wildcard token wins even beside explicit origins"
        );
    }

    #[test]
    fn explicit_origins_become_a_closed_allowlist() {
        assert_eq!(
            parse_cors_policy("http://localhost:4321, http://127.0.0.1:4321"),
            Some(CorsPolicy::Allowlist(vec![
                "http://localhost:4321".to_string(),
                "http://127.0.0.1:4321".to_string(),
            ]))
        );
    }

    #[test]
    fn allowlist_reflects_only_matching_origins() {
        let policy = CorsPolicy::Allowlist(vec!["http://localhost:4321".to_string()]);
        assert_eq!(
            policy.allow_origin_for("http://localhost:4321"),
            Some("http://localhost:4321".to_string())
        );
        assert_eq!(policy.allow_origin_for("http://evil.example"), None);
        assert_eq!(policy.allow_origin_for(""), None, "no Origin ⇒ no CORS header");
    }

    #[test]
    fn any_reflects_the_request_origin_not_a_literal_star() {
        let policy = CorsPolicy::Any;
        // Reflecting the origin (not "*") keeps credentialed requests working.
        assert_eq!(
            policy.allow_origin_for("http://localhost:4321"),
            Some("http://localhost:4321".to_string())
        );
        assert_eq!(policy.allow_origin_for(""), None);
    }

    #[test]
    fn cors_config_from_env_unset_or_blank_is_none() {
        let _guard = crate::test_support::env_lock();
        std::env::remove_var(CORS_ORIGINS_ENV);
        assert_eq!(cors_config_from_env(), None, "unset env ⇒ CORS disabled");

        std::env::set_var(CORS_ORIGINS_ENV, "   ,\t ");
        assert_eq!(
            cors_config_from_env(),
            None,
            "blank/separator-only env ⇒ CORS disabled"
        );
        std::env::remove_var(CORS_ORIGINS_ENV);
    }

    #[test]
    fn cors_config_from_env_star_is_any() {
        let _guard = crate::test_support::env_lock();
        std::env::set_var(CORS_ORIGINS_ENV, "*");
        assert_eq!(cors_config_from_env(), Some(CorsPolicy::Any));
        std::env::remove_var(CORS_ORIGINS_ENV);
    }

    #[test]
    fn cors_config_from_env_explicit_origins_become_allowlist() {
        let _guard = crate::test_support::env_lock();
        std::env::set_var(
            CORS_ORIGINS_ENV,
            "http://localhost:4321, http://127.0.0.1:4321",
        );
        assert_eq!(
            cors_config_from_env(),
            Some(CorsPolicy::Allowlist(vec![
                "http://localhost:4321".to_string(),
                "http://127.0.0.1:4321".to_string(),
            ]))
        );
        std::env::remove_var(CORS_ORIGINS_ENV);
    }
}
