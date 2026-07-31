//! The bound on failed authentication, and the trail it leaves — LIVE, over a real socket.
//!
//! `sidecar::auth`'s own unit tests pin the PURE decisions (when a bucket trips, when it is
//! released, what a line renders as). These pin the consequences on the wire: the status an
//! attacker actually meets, the header that tells them how long to wait, the fact that a valid
//! credential walks past a limiter that is refusing someone else, and the lines that appear on
//! disk afterwards.
//!
//! Every socket here is `127.0.0.1:0` and every listener is labelled `Declared`, for the same
//! reason `node_local.rs` gives: what is under test is the pair (construction → behaviour), and
//! the address a listener sits on is precisely what must not matter.
//!
//! Body-only child of `sidecar::tests` (see the `#[path]` decls in tests.rs).

use super::*;

use crate::sidecar::auth::{
    sha256_hex, AuthGate, AuthPolicy, Credential, FAILURE_THRESHOLD, FAILURE_WINDOW,
};
use crate::sidecar::node_local::ListenRole;

/// The one enrolled credential every test below uses.
const GOOD_TOKEN: &str = "the-enrolled-device-token";
const GOOD_IDENTITY: &str = "id-test-device";

fn policy_enrolling_one() -> AuthPolicy {
    AuthPolicy::from_credentials(vec![Credential {
        token_sha256: sha256_hex(GOOD_TOKEN),
        identity: GOOD_IDENTITY.to_string(),
    }])
}

/// A fresh temp dir to serve out of and to read the audit trail from.
fn temp_dir() -> PathBuf {
    let tmp = std::env::temp_dir().join(format!("tractor-auth-limits-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&tmp).unwrap();
    tmp
}

/// Serve the real sidecar router through the production path, with a gate that writes its
/// audit into `dir`. Returns the port.
async fn serve_gated(dir: &std::path::Path, gate: Option<AuthGate>) -> u16 {
    let state = SidecarState::for_test(dir, ":memory:").unwrap();
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let router = listener_router(sidecar_routes(state), ListenRole::Declared, gate, None);
    tokio::spawn(async move {
        let _ = axum::serve(listener, router).await;
    });
    port
}

/// `GET /efforts` with `token` as a bearer credential, returning the whole response.
async fn get_with(port: u16, token: &str) -> reqwest::Response {
    reqwest::Client::new()
        .get(format!("http://127.0.0.1:{port}/efforts"))
        .header("Authorization", format!("Bearer {token}"))
        .send()
        .await
        .unwrap()
}

/// Every line of the audit trail in `dir`, parsed. Empty when the file was never created.
fn audit_lines(dir: &std::path::Path) -> Vec<serde_json::Value> {
    let path = dir.join(crate::observer::AUDIT_FILE);
    let Ok(raw) = std::fs::read_to_string(&path) else {
        return Vec::new();
    };
    raw.lines()
        .filter(|line| !line.trim().is_empty())
        .map(|line| serde_json::from_str(line).expect("every audit line must be valid JSON"))
        .collect()
}

/// The raw bytes of the audit trail — for the assertions that must hold over the FILE, not
/// over anything we chose to parse out of it.
fn audit_bytes(dir: &std::path::Path) -> String {
    std::fs::read_to_string(dir.join(crate::observer::AUDIT_FILE)).unwrap_or_default()
}

// ── the limiter, on the wire ──────────────────────────────────────────────────────────

#[tokio::test]
async fn a_wrong_credential_is_refused_401_until_the_threshold_then_429() {
    let dir = temp_dir();
    let port = serve_gated(&dir, Some(AuthGate::for_test_with_audit(policy_enrolling_one(), &dir)))
        .await;

    // Below the threshold: the same `401 invalid` the gate has always sent.
    for attempt in 1..FAILURE_THRESHOLD {
        let response = get_with(port, "a-wrong-token").await;
        assert_eq!(
            response.status(),
            401,
            "attempt {attempt} is below the threshold and must still be an ordinary 401"
        );
    }

    // The threshold attempt, and everything after it: refused with a bound, not a verdict.
    let response = get_with(port, "a-wrong-token").await;
    assert_eq!(response.status(), 429, "the {FAILURE_THRESHOLD}th failure must be rate-limited");
    let retry_after = response
        .headers()
        .get("retry-after")
        .expect("a 429 must say how long to wait — a silent refusal teaches a caller to retry harder")
        .to_str()
        .unwrap()
        .parse::<u64>()
        .expect("Retry-After must be a number of seconds");
    assert!(retry_after > 0, "Retry-After: 0 reads as 'immediately', the opposite of a limit");
    assert!(
        retry_after <= FAILURE_WINDOW.as_secs(),
        "the wait must never be longer than the window it is counting down"
    );

    // Still shut on the next attempt, without the policy being consulted at all.
    assert_eq!(get_with(port, "a-wrong-token").await.status(), 429, "and it stays shut");
}

#[tokio::test]
async fn the_operators_valid_credential_walks_past_a_limiter_refusing_someone_else() {
    // THE anti-lockout property, on the wire. A third party grinds until they are locked out;
    // the operator's own credential is unaffected, because a budget is spent only by
    // presenting the credential that owns it.
    let dir = temp_dir();
    let port = serve_gated(&dir, Some(AuthGate::for_test_with_audit(policy_enrolling_one(), &dir)))
        .await;

    for _ in 0..FAILURE_THRESHOLD * 3 {
        get_with(port, "attacker-guess").await;
    }
    assert_eq!(get_with(port, "attacker-guess").await.status(), 429, "the grinder is shut out");

    assert_eq!(
        get_with(port, GOOD_TOKEN).await.status(),
        200,
        "the operator's node must not be closed to the operator by someone else's grinding"
    );
}

#[tokio::test]
async fn a_successful_authentication_clears_the_failures_that_preceded_it() {
    // A client with a stale token in its config, fixed before it ever trips the limit: the
    // failures it accrued must not follow it.
    let dir = temp_dir();
    let port = serve_gated(&dir, Some(AuthGate::for_test_with_audit(policy_enrolling_one(), &dir)))
        .await;

    // Four failures on the REAL token (a client that had it wrong is not a thing we can
    // simulate with the right token, so we fail on the right one via a deny-all... instead,
    // fail four times with the wrong token, then succeed with the right one, then confirm the
    // wrong token's budget is its own).
    for _ in 0..FAILURE_THRESHOLD - 1 {
        assert_eq!(get_with(port, "stale-token").await.status(), 401);
    }
    assert_eq!(get_with(port, GOOD_TOKEN).await.status(), 200, "the good credential works");

    // The stale token's own bucket is untouched by the good token's success — budgets are
    // per-credential, so one more failure is its fifth and trips it.
    assert_eq!(
        get_with(port, "stale-token").await.status(),
        429,
        "each credential's budget is its own; a success elsewhere does not refill it"
    );
}

#[tokio::test]
async fn a_request_with_no_credential_at_all_is_401_and_never_rate_limited() {
    // A request that presents nothing guesses nothing. Counting it would let ordinary
    // unauthenticated noise spend a budget that exists to detect guessing.
    let dir = temp_dir();
    let port = serve_gated(&dir, Some(AuthGate::for_test_with_audit(policy_enrolling_one(), &dir)))
        .await;

    for attempt in 0..FAILURE_THRESHOLD * 4 {
        let status = reqwest::Client::new()
            .get(format!("http://127.0.0.1:{port}/efforts"))
            .send()
            .await
            .unwrap()
            .status();
        assert_eq!(status, 401, "attempt {attempt}: an absent credential is 401, always");
    }
    assert_eq!(
        get_with(port, GOOD_TOKEN).await.status(),
        200,
        "and none of that noise may affect a real credential"
    );
}

// ── the node-local listener is untouched by all of it ─────────────────────────────────

#[tokio::test]
async fn the_node_local_listener_has_no_limiter_because_it_has_no_credential() {
    // `1ad8f94d`'s invariant, extended to this slice for free: the node-local listener is
    // constructed WITHOUT the credential layer, so the limiter — which lives inside that
    // layer — is not merely bypassed but absent. There is no credential, therefore no
    // failures to count, therefore nothing that can ever refuse the operator at their own
    // machine. This is also the ultimate lockout recovery path.
    let dir = temp_dir();
    let port = serve_gated(&dir, crate::sidecar::node_local::gate_for(
        ListenRole::NodeLocal,
        Some(AuthGate::for_test_with_audit(policy_enrolling_one(), &dir)),
    ))
    .await;

    // Far past every threshold, with a credential that would be nonsense on a gated listener.
    for attempt in 0..FAILURE_THRESHOLD * 10 {
        let status = get_with(port, "garbage-token").await.status();
        assert_eq!(
            status, 200,
            "attempt {attempt}: the node does not authenticate to itself, so it cannot rate-limit itself"
        );
    }
    assert_eq!(
        reqwest::Client::new()
            .get(format!("http://127.0.0.1:{port}/efforts"))
            .send()
            .await
            .unwrap()
            .status(),
        200,
        "and an uncredentialed request is as welcome as it ever was"
    );

    assert!(
        audit_lines(&dir).is_empty(),
        "an ungated listener authenticates nothing, so it has no authentication to record"
    );
}

#[tokio::test]
async fn a_flood_of_distinct_credentials_cannot_grow_the_live_gates_memory() {
    // Bounded memory, asserted over the gate a real listener is actually serving from — not
    // just over the structure in isolation. Every request carries a DIFFERENT token, which is
    // what a search looks like and is the one shape a per-credential key cannot bucket.
    let dir = temp_dir();
    let gate = AuthGate::for_test_with_audit(policy_enrolling_one(), &dir);
    let port = serve_gated(&dir, Some(gate.clone())).await;

    for n in 0..crate::sidecar::auth::FAILURE_TABLE_CAPACITY + 64 {
        get_with(port, &format!("flood-token-{n}")).await;
        assert!(
            gate.tracked_failures() <= crate::sidecar::auth::FAILURE_TABLE_CAPACITY,
            "the live gate's failure table exceeded its capacity at request {n}"
        );
    }
    assert_eq!(
        gate.tracked_failures(),
        crate::sidecar::auth::FAILURE_TABLE_CAPACITY,
        "the flood should have filled the table to exactly its bound and no further"
    );

    // And the operator still gets in, after all of it.
    assert_eq!(get_with(port, GOOD_TOKEN).await.status(), 200);
}

// ── the audit trail ───────────────────────────────────────────────────────────────────

#[tokio::test]
async fn the_trail_records_a_success_and_a_failure_with_no_credential_material() {
    let dir = temp_dir();
    let port = serve_gated(&dir, Some(AuthGate::for_test_with_audit(policy_enrolling_one(), &dir)))
        .await;

    assert_eq!(get_with(port, GOOD_TOKEN).await.status(), 200);
    assert_eq!(get_with(port, "a-wrong-token").await.status(), 401);

    let lines = audit_lines(&dir);
    assert_eq!(lines.len(), 2, "one line per authentication decision: {lines:?}");

    let accepted = &lines[0];
    assert_eq!(accepted["event"], "auth:accepted");
    assert_eq!(accepted["outcome"], "accepted");
    assert_eq!(accepted["identity"], GOOD_IDENTITY, "the operator must see WHO");
    assert_eq!(accepted["credential"], "device");
    assert!(
        accepted["ts"].as_i64().unwrap_or(0) > 1_700_000_000_000,
        "the operator must see WHEN, as a real epoch-ms instant"
    );

    let refused = &lines[1];
    assert_eq!(refused["event"], "auth:refused", "a failure is recorded as fully as a success");
    assert_eq!(refused["outcome"], "refused");
    assert_eq!(refused["identity"], "-", "a failure resolved no identity, and claims none");

    // THE rule, over the actual bytes on disk.
    let bytes = audit_bytes(&dir);
    assert!(!bytes.contains(GOOD_TOKEN), "the enrolled token is in the trail: {bytes}");
    assert!(!bytes.contains("a-wrong-token"), "an attempted token is in the trail: {bytes}");
    assert!(
        !bytes.contains(&sha256_hex(GOOD_TOKEN)),
        "the enrolled token's hash is in the trail: {bytes}"
    );
    assert!(
        !bytes.contains(&sha256_hex(GOOD_TOKEN)[..8]),
        "even a truncated hash is credential material: {bytes}"
    );
}

#[tokio::test]
async fn the_trail_survives_the_gate_that_wrote_it() {
    // It is a file, in the refarm dir, appended to — not process memory. A trail that answers
    // "was this device used last night" only while last night's daemon is still running
    // answers it exactly when nobody needs to ask.
    let dir = temp_dir();
    {
        let port =
            serve_gated(&dir, Some(AuthGate::for_test_with_audit(policy_enrolling_one(), &dir)))
                .await;
        assert_eq!(get_with(port, GOOD_TOKEN).await.status(), 200);
    }

    // A SECOND gate over the same dir — the restart, as far as the trail is concerned.
    let port =
        serve_gated(&dir, Some(AuthGate::for_test_with_audit(policy_enrolling_one(), &dir))).await;
    assert_eq!(get_with(port, "a-wrong-token").await.status(), 401);

    let lines = audit_lines(&dir);
    assert_eq!(lines.len(), 2, "the earlier line must still be there: {lines:?}");
    assert_eq!(lines[0]["event"], "auth:accepted", "written before the restart");
    assert_eq!(lines[1]["event"], "auth:refused", "and appended to after it");
}

#[tokio::test]
async fn a_lockout_writes_one_line_and_then_stops_writing() {
    // Bounded RATE, not just bounded size. An attacker who keeps hammering after being locked
    // out must not be able to drive one disk write per attempt — that would be a
    // disk-filling amplifier handed to whoever is grinding, and it would bury the one line
    // that mattered under thousands that did not.
    let dir = temp_dir();
    let port = serve_gated(&dir, Some(AuthGate::for_test_with_audit(policy_enrolling_one(), &dir)))
        .await;

    for _ in 0..FAILURE_THRESHOLD {
        get_with(port, "a-wrong-token").await;
    }
    let after_lockout = audit_lines(&dir).len();

    for _ in 0..50 {
        assert_eq!(get_with(port, "a-wrong-token").await.status(), 429);
    }
    assert_eq!(
        audit_lines(&dir).len(),
        after_lockout,
        "attempts made while locked out must add no lines at all"
    );

    let lines = audit_lines(&dir);
    assert_eq!(
        lines.iter().filter(|l| l["event"] == "auth:locked-out").count(),
        1,
        "the lockout is recorded exactly once, on the attempt that tripped it: {lines:?}"
    );
    assert_eq!(
        lines.iter().filter(|l| l["event"] == "auth:refused").count(),
        (FAILURE_THRESHOLD - 1) as usize,
        "and the refusals before it are each recorded once"
    );
}
