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
