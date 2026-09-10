//! The node reaches itself — LIVE, over two real sockets.
//!
//! `sidecar::node_local`'s own unit tests pin the PURE decisions (what the plan is, which
//! role gets a gate). These pin the consequence on the wire: two listeners, built by the
//! production `listener_router`, answering differently because of HOW THEY WERE
//! CONSTRUCTED — not because anything inspects the request.
//!
//! Both sockets bind `127.0.0.1:0` on purpose. What is under test is the pair
//! (role → configuration → behaviour), and that pair is decided at construction from the
//! role alone; the ADDRESS a listener happens to sit on is precisely what must NOT matter.
//! Binding a real tailnet address would test the operating system, need a tailnet in CI,
//! and — worse — would let a future per-request "is the peer local?" bug pass these tests,
//! since every peer here IS local. Labelling a loopback socket `Declared` and demanding it
//! still refuse an uncredentialed request is the STRONGER assertion.
//!
//! Body-only child of `sidecar::tests` (see the `#[path]` decls in tests.rs).

use super::*;

use crate::sidecar::auth::{sha256_hex, AuthGate, AuthPolicy, Credential};
use crate::sidecar::node_local::ListenRole;

/// A gate enrolling exactly one credential — the "valid one" every test below uses.
fn gate_enrolling(token: &str) -> AuthGate {
    AuthGate::for_test(AuthPolicy::from_credentials(vec![Credential {
        token_sha256: sha256_hex(token),
        identity: "id-test-device".to_string(),
    }]))
}

/// A gate that authenticates NOTHING — what `ResolvedAuthPolicy::resolve` installs when the
/// gate is declared but the policy file is not there yet. Bound, and denying everything.
fn deny_all_gate() -> AuthGate {
    AuthGate::for_test(AuthPolicy::from_credentials(vec![]))
}

/// Serve a real sidecar router on a fresh loopback socket with the given ROLE and gate,
/// through the exact production path (`sidecar_routes` + `listener_router`). Returns the
/// port. No CORS (the default: `REFARM_SIDECAR_CORS_ORIGINS` unset).
async fn serve_as(role: ListenRole, gate: Option<AuthGate>) -> (u16, PathBuf) {
    let tmp = std::env::temp_dir().join(format!("tractor-node-local-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&tmp).unwrap();
    let state = SidecarState::for_test(&tmp, ":memory:").unwrap();

    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let router = listener_router(sidecar_routes(state), role, gate, None);
    tokio::spawn(async move {
        let _ = axum::serve(listener, router).await;
    });
    (port, tmp)
}

/// `GET /efforts` with no `Authorization` header at all.
async fn get_uncredentialed(port: u16) -> reqwest::StatusCode {
    reqwest::Client::new()
        .get(format!("{}/efforts", base(port)))
        .send()
        .await
        .unwrap()
        .status()
}

/// `GET /efforts` carrying `token` as a bearer credential.
async fn get_with_token(port: u16, token: &str) -> reqwest::StatusCode {
    reqwest::Client::new()
        .get(format!("{}/efforts", base(port)))
        .header("Authorization", format!("Bearer {token}"))
        .send()
        .await
        .unwrap()
        .status()
}

// ── the node-local listener: no credential, and no way to demand one ──────────────────

#[tokio::test]
async fn sidecar_node_local_listener_accepts_a_request_with_no_credential() {
    // THE regression, inverted into an assertion. With `expose: "tailnet"` the operator's
    // `refarm ask` — which talks to http://127.0.0.1:42001 and carries no credential — got
    // "connection refused", then, once reachable, would have got 401. The node does not
    // authenticate to itself.
    let (port, _tmp) = serve_as(ListenRole::NodeLocal, Some(gate_enrolling("valid-token"))).await;
    assert_eq!(
        get_uncredentialed(port).await,
        200,
        "the node-local listener is constructed WITHOUT the credential layer, so a request \
         with no credential is served"
    );
}

#[tokio::test]
async fn sidecar_node_local_listener_ignores_a_wrong_credential_too() {
    // Not "accepts valid tokens and skips the check for locals" — there is NO check on this
    // listener. A garbage `Authorization` header is as irrelevant as a missing one, which is
    // what having no auth layer at all actually means.
    let (port, _tmp) = serve_as(ListenRole::NodeLocal, Some(gate_enrolling("valid-token"))).await;
    assert_eq!(get_with_token(port, "totally-wrong").await, 200);
    assert_eq!(get_with_token(port, "valid-token").await, 200);
}

#[tokio::test]
async fn sidecar_node_local_listener_works_even_when_the_policy_denies_everything() {
    // An operator must never be locked out of their own node by a missing policy file. A
    // declared gate with no `auth-policy.json` yet resolves to deny-all — correct, and
    // strictest, on the DECLARED address; irrelevant on this one, which has no gate.
    let (port, _tmp) = serve_as(ListenRole::NodeLocal, Some(deny_all_gate())).await;
    assert_eq!(get_uncredentialed(port).await, 200);
}

// ── the declared listener: unchanged, in every case ───────────────────────────────────

#[tokio::test]
async fn sidecar_declared_listener_still_refuses_an_uncredentialed_request() {
    let (port, _tmp) = serve_as(ListenRole::Declared, Some(gate_enrolling("valid-token"))).await;
    assert_eq!(get_uncredentialed(port).await, 401, "no credential ⇒ 401, unchanged");
}

#[tokio::test]
async fn sidecar_declared_listener_still_refuses_a_wrong_credential() {
    let (port, _tmp) = serve_as(ListenRole::Declared, Some(gate_enrolling("valid-token"))).await;
    assert_eq!(get_with_token(port, "wrong-token").await, 401, "wrong credential ⇒ 401");
}

#[tokio::test]
async fn sidecar_declared_listener_still_accepts_a_valid_credential() {
    let (port, _tmp) = serve_as(ListenRole::Declared, Some(gate_enrolling("valid-token"))).await;
    assert_eq!(get_with_token(port, "valid-token").await, 200, "valid credential ⇒ served");
}

#[tokio::test]
async fn sidecar_declared_listener_denies_all_when_the_gate_is_declared_but_the_policy_is_absent() {
    // The deny-all case, on the OUTWARD address: bound, and refusing every request until
    // `refarm auth enroll` mints a credential. Adding node-local reach must not soften it.
    let (port, _tmp) = serve_as(ListenRole::Declared, Some(deny_all_gate())).await;
    assert_eq!(get_uncredentialed(port).await, 401);
    assert_eq!(get_with_token(port, "any-token").await, 401);
}

#[tokio::test]
async fn sidecar_declared_listener_with_no_gate_is_unchanged_by_this_rule() {
    // An UNGATED surface (nothing declared, no REFARM_AUTH_POLICY) had no layer before this
    // rule and has none now — the node-local listener never INTRODUCES a gate, it only
    // declines to inherit one.
    let (port, _tmp) = serve_as(ListenRole::Declared, None).await;
    assert_eq!(get_uncredentialed(port).await, 200);
}

// ── the pair, side by side: same routes, same gate value, opposite answers ─────────────

#[tokio::test]
async fn sidecar_the_same_gate_produces_two_listeners_that_differ_only_by_construction() {
    // Both listeners are on 127.0.0.1 and both are handed the SAME gate; they answer the
    // same uncredentialed request differently. That difference can therefore only come from
    // the ROLE each was constructed with — there is no request property that distinguishes
    // these two calls, which is exactly the property this design is for.
    let gate = gate_enrolling("shared-token");
    let (declared_port, _a) = serve_as(ListenRole::Declared, Some(gate.clone())).await;
    let (node_local_port, _b) = serve_as(ListenRole::NodeLocal, Some(gate)).await;

    assert_eq!(get_uncredentialed(declared_port).await, 401);
    assert_eq!(get_uncredentialed(node_local_port).await, 200);
    // …and the declared one still serves a valid credential, so nothing outward weakened.
    assert_eq!(get_with_token(declared_port, "shared-token").await, 200);
}

// ── scoped credentials, on the wire ────────────────────────────────────────────────────
//
// `sidecar::auth`'s own tests pin the PURE decisions (the route table, the three scoped
// conditions, the clock). These pin the consequence over a real socket, through the
// production `listener_router`: a browser session's credential reaching the sidecar for the
// routes it was issued for, and bouncing off everything else.

use crate::sidecar::auth::{Scope, ScopedCredential};

fn epoch_ms_now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .expect("a host clock after 1970")
        .as_millis() as i64
}

/// A gate holding one enrolled DEVICE and one `prompt:answer` browser session, with the
/// session's deadline named by the caller.
fn gate_with_scoped(device_token: &str, scoped_token: &str, expires_at_ms: i64) -> AuthGate {
    AuthGate::for_test(AuthPolicy::from_parts(
        vec![Credential {
            token_sha256: sha256_hex(device_token),
            identity: "id-test-device".to_string(),
        }],
        vec![ScopedCredential {
            token_sha256: sha256_hex(scoped_token),
            identity: "web-session-test".to_string(),
            scope: vec![Scope::AnswerPrompts],
            expires_at_ms,
        }],
    ))
}

/// Any request, with an optional bearer credential. Returns the status only — what is under
/// test is the GATE, never a handler's body.
async fn request_status(
    port: u16,
    method: reqwest::Method,
    path: &str,
    token: Option<&str>,
) -> reqwest::StatusCode {
    let mut builder = reqwest::Client::new()
        .request(method, format!("{}{path}", base(port)))
        .json(&serde_json::json!({}));
    if let Some(token) = token {
        builder = builder.header("Authorization", format!("Bearer {token}"));
    }
    builder.send().await.unwrap().status()
}

#[tokio::test]
async fn sidecar_declared_listener_serves_a_scoped_credential_on_the_route_it_declares() {
    // THE thing this slice closes: a browser holding a scoped, expiring credential — not the
    // device token — reaches the pending-prompt hub. Before, `scopedCredentials` was a key
    // the Rust gate did not read, so this request was a 401 with no way to make it anything
    // else short of handing the browser a full device credential.
    let gate = gate_with_scoped("device-token", "browser-token", epoch_ms_now() + 600_000);
    let (port, _tmp) = serve_as(ListenRole::Declared, Some(gate)).await;

    assert_eq!(
        request_status(port, reqwest::Method::GET, "/prompts", Some("browser-token")).await,
        200,
        "GET /prompts declares `prompt:answer`, and the session holds it"
    );
}

#[tokio::test]
async fn sidecar_declared_listener_refuses_a_scoped_credential_on_every_undeclared_route() {
    // The other half, and the one that must never rot: authority is what the ROUTE declared,
    // not what the credential managed to get past. Note `POST /prompts` — the SAME path the
    // test above succeeds on, refused because publishing a question is an asking process's
    // act and the route declares no scope for it.
    let gate = gate_with_scoped("device-token", "browser-token", epoch_ms_now() + 600_000);
    let (port, _tmp) = serve_as(ListenRole::Declared, Some(gate)).await;

    // Every one of these must BOUNCE — that is the invariant, and it is unchanged. The status
    // of the last one is not: this is the same credential failing five times in a row, which
    // is exactly what the failure limiter (`sidecar::auth`) exists to notice, so the fifth
    // refusal is a `429` rather than a `401`. Both are refusals and neither admits anything;
    // what this test pins is that authority follows the ROUTE's declaration, so it asserts
    // "refused, never admitted" and lets the limiter own the difference between the two ways
    // of saying no.
    for (n, (method, path)) in [
        (reqwest::Method::POST, "/prompts"),
        (reqwest::Method::GET, "/efforts"),
        (reqwest::Method::POST, "/efforts"),
        (reqwest::Method::GET, "/plugins"),
        (reqwest::Method::GET, "/connections"),
    ]
    .into_iter()
    .enumerate()
    {
        let status = request_status(port, method.clone(), path, Some("browser-token")).await;
        // An out-of-scope refusal is a `401` — stated exactly, so an over-eager limiter that
        // started refusing on the FIRST attempt would fail here rather than hide behind "some
        // kind of refusal".
        let expected =
            if (n as u32) < crate::sidecar::auth::FAILURE_THRESHOLD - 1 { 401 } else { 429 };
        assert_eq!(
            status, expected,
            "{method} {path} declares no scope ⇒ a scoped credential must bounce"
        );
    }
}

#[tokio::test]
async fn sidecar_declared_listener_refuses_an_expired_scoped_credential() {
    // Expiry, at the door. The credential is otherwise perfect — right hash, right scope —
    // and its deadline passed one second ago.
    let gate = gate_with_scoped("device-token", "browser-token", epoch_ms_now() - 1_000);
    let (port, _tmp) = serve_as(ListenRole::Declared, Some(gate)).await;

    assert_eq!(
        request_status(port, reqwest::Method::GET, "/prompts", Some("browser-token")).await,
        401,
        "an expired session is refused on the very route it was issued for"
    );
}

#[tokio::test]
async fn sidecar_declared_listener_still_serves_a_device_credential_on_a_scoped_route() {
    // A device credential is UNSCOPED by design, so declaring a scope on a route must not
    // have narrowed the operator's own phone out of it.
    let gate = gate_with_scoped("device-token", "browser-token", epoch_ms_now() + 600_000);
    let (port, _tmp) = serve_as(ListenRole::Declared, Some(gate)).await;

    for (method, path) in [
        (reqwest::Method::GET, "/prompts"),
        (reqwest::Method::POST, "/prompts"),
        (reqwest::Method::GET, "/efforts"),
    ] {
        assert_ne!(
            request_status(port, method.clone(), path, Some("device-token")).await,
            401,
            "{method} {path} must still admit an enrolled device"
        );
    }
}

#[tokio::test]
async fn sidecar_node_local_listener_is_not_scope_checked_and_has_no_scope_to_check() {
    // `node-local` is UNCHANGED by scoped credentials, in both directions. It has no
    // credential layer at all, so it is not "granted every scope" (there is nothing to grant
    // — no credential is ever resolved there) and it is not scope-checked either. An
    // uncredentialed local request to a route that DECLARES a scope is served exactly as it
    // was before this table existed.
    let gate = gate_with_scoped("device-token", "browser-token", epoch_ms_now() - 1_000);
    let (port, _tmp) = serve_as(ListenRole::NodeLocal, Some(gate)).await;

    assert_eq!(
        request_status(port, reqwest::Method::GET, "/prompts", None).await,
        200,
        "the node does not authenticate to itself, on a scoped route as on any other"
    );
    assert_eq!(
        request_status(port, reqwest::Method::GET, "/prompts", Some("browser-token")).await,
        200,
        "and an EXPIRED scoped token is as irrelevant here as a garbage one — no check exists"
    );
}
