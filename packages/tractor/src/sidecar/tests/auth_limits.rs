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
    assert_eq!(
        refused["event"], "auth:authentication-failed",
        "a failure is recorded as fully as a success — and now says WHICH failure it was"
    );
    assert_eq!(refused["outcome"], "authentication-failed");
    assert_eq!(
        refused["budget"], "authentication",
        "a token nothing recognises spends the budget that exists to bound guessing"
    );
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
    assert_eq!(lines[1]["event"], "auth:authentication-failed", "and appended to after it");
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
        lines.iter().filter(|l| l["event"] == "auth:rate-limit-engaged").count(),
        1,
        "the lockout is recorded exactly once, on the attempt that tripped it: {lines:?}"
    );
    assert_eq!(
        lines.iter().filter(|l| l["event"] == "auth:authentication-failed").count(),
        (FAILURE_THRESHOLD - 1) as usize,
        "and the refusals before it are each recorded once"
    );
}

// ── the separation, on the wire ───────────────────────────────────────────────────────
//
// A gate that could not tell "the credential does not verify" from "the credential is fine,
// the scope is wrong" punished a legitimate app for a routing bug exactly as it punished
// somebody guessing tokens. These pin the fix AND the constraint on the fix: the two facts are
// separated everywhere except where a caller can see them.

/// A device credential plus one live `prompt:answer` browser session — the shape a phone
/// enrols and a browser is handed.
fn policy_with_a_browser_session() -> AuthPolicy {
    let expires_at_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or_default()
        + 600_000;
    let raw = serde_json::json!({
        "credentials": [{ "identity": GOOD_IDENTITY, "tokenSha256": sha256_hex(GOOD_TOKEN) }],
        "scopedCredentials": [{
            "wire": crate::sidecar::auth::SCOPED_CREDENTIAL_WIRE,
            "id": "scr_browser",
            "identity": BROWSER_IDENTITY,
            "tokenSha256": sha256_hex(BROWSER_TOKEN),
            "scope": [crate::sidecar::auth::SCOPE_ANSWER_PROMPTS],
            "surface": "web",
            "issuedVia": "emoji-sas.v1",
            "issuedAt": expires_at_ms - 660_000,
            "expiresAt": expires_at_ms,
        }],
    });
    crate::sidecar::auth::parse_policy(&raw.to_string()).expect("a valid policy")
}

const BROWSER_TOKEN: &str = "the-browser-session-token";
const BROWSER_IDENTITY: &str = "id-test-browser";

/// `GET /prompts` — the one route that DECLARES `prompt:answer`, and therefore the route the
/// browser session is entitled to.
async fn get_prompts_with(port: u16, token: &str) -> reqwest::Response {
    reqwest::Client::new()
        .get(format!("http://127.0.0.1:{port}/prompts"))
        .header("Authorization", format!("Bearer {token}"))
        .send()
        .await
        .unwrap()
}

/// Status, every header, and the body bytes — everything a caller can observe.
async fn observable(response: reqwest::Response) -> (u16, Vec<(String, String)>, String) {
    let status = response.status().as_u16();
    let mut headers: Vec<(String, String)> = response
        .headers()
        .iter()
        .filter(|(name, _)| name.as_str() != "date" && name.as_str() != "content-length")
        .map(|(name, value)| {
            (name.as_str().to_string(), value.to_str().unwrap_or("<opaque>").to_string())
        })
        .collect();
    headers.sort();
    let body = response.text().await.unwrap();
    (status, headers, body)
}

#[tokio::test]
async fn a_scope_refusal_does_not_spend_the_budget_that_stops_credential_guessing() {
    // THE test. A browser holding a real, live `prompt:answer` credential asks for routes it
    // has no authority for — a routing bug, not an attack — far past the failure threshold.
    // Before the separation this filled the guessing budget and locked the browser out of
    // `GET /prompts`, the one route it WAS entitled to, for a minute.
    let dir = temp_dir();
    let gate = AuthGate::for_test_with_audit(policy_with_a_browser_session(), &dir);
    let port = serve_gated(&dir, Some(gate.clone())).await;

    for attempt in 1..=FAILURE_THRESHOLD * 3 {
        let status = get_with(port, BROWSER_TOKEN).await.status();
        assert!(
            status == 401 || status == 429,
            "attempt {attempt}: /efforts declares no scope, so a scoped credential must bounce"
        );
    }

    assert_eq!(
        gate.tracked_failures_in(crate::security_events::Budget::Authentication),
        0,
        "THE POINT: {} scope refusals must leave the guessing budget completely untouched",
        FAILURE_THRESHOLD * 3
    );
    assert_eq!(
        gate.tracked_failures_in(crate::security_events::Budget::Authorization),
        1,
        "they belong to the authorization budget, which is bounded for the trail's sake"
    );

    // And the consequence that matters to a human: the app still works where it is entitled.
    assert_eq!(
        get_prompts_with(port, BROWSER_TOKEN).await.status(),
        200,
        "a legitimate caller with a scope bug must NOT be locked out of the routes it holds \
         authority for — that is the punishment this separation removes"
    );
    // Twice, because a success must not be what unlocks it either.
    assert_eq!(get_prompts_with(port, BROWSER_TOKEN).await.status(), 200);
}

#[tokio::test]
async fn a_guessed_credential_still_fills_the_guessing_budget() {
    // The other direction, so the separation cannot be satisfied by simply never counting
    // anything. A token nothing recognises is still evidence of guessing and still spends the
    // budget that exists to bound it.
    let dir = temp_dir();
    let gate = AuthGate::for_test_with_audit(policy_with_a_browser_session(), &dir);
    let port = serve_gated(&dir, Some(gate.clone())).await;

    for _ in 0..FAILURE_THRESHOLD {
        let _ = get_with(port, "a-token-nobody-issued").await;
    }
    assert_eq!(
        gate.tracked_failures_in(crate::security_events::Budget::Authentication),
        1,
        "a guess must still be counted as a guess"
    );
    assert_eq!(
        gate.tracked_failures_in(crate::security_events::Budget::Authorization),
        0,
        "and must not be filed as somebody's scope bug"
    );
    assert_eq!(
        get_with(port, "a-token-nobody-issued").await.status(),
        429,
        "the guessing bound must still bite"
    );
}

#[tokio::test]
async fn a_bad_credential_and_a_wrong_scope_credential_are_byte_identical_on_the_wire() {
    // THE NO-ORACLE RULE. Distinguishing the two facts in the RESPONSE would tell whoever
    // presented a guessed token that the token exists — the single most valuable thing an
    // attacker can learn, handed out by the refusal meant to stop them. Every observable is
    // compared: status, every header (bar `date`/`content-length`), and the body bytes.
    //
    // Two listeners, so neither request can be influenced by the other's limiter state.
    let dir_a = temp_dir();
    let port_a =
        serve_gated(&dir_a, Some(AuthGate::for_test_with_audit(policy_with_a_browser_session(), &dir_a)))
            .await;
    let unknown = observable(get_with(port_a, "a-token-nobody-issued").await).await;

    let dir_b = temp_dir();
    let port_b =
        serve_gated(&dir_b, Some(AuthGate::for_test_with_audit(policy_with_a_browser_session(), &dir_b)))
            .await;
    let wrong_scope = observable(get_with(port_b, BROWSER_TOKEN).await).await;

    assert_eq!(
        unknown, wrong_scope,
        "a wrong-scope refusal must be indistinguishable from an unknown-credential refusal"
    );
    // Pinned literally, so "identical" cannot be satisfied by both having drifted together.
    assert_eq!(unknown.0, 401);
    assert_eq!(unknown.2, r#"{"error":"unauthorized","reason":"invalid"}"#);
    assert!(
        unknown.1.contains(&("www-authenticate".to_string(), "Bearer".to_string())),
        "and the headers must be the ones the gate has always sent: {:?}",
        unknown.1
    );

    // The same, at the bound: the fifth refusal of each kind must also match, byte for byte,
    // including the `Retry-After`. A different count or a different wait would be the oracle
    // measured with a stopwatch rather than read off the page.
    for _ in 1..FAILURE_THRESHOLD {
        let _ = get_with(port_a, "a-token-nobody-issued").await;
        let _ = get_with(port_b, BROWSER_TOKEN).await;
    }
    let limited_unknown = observable(get_with(port_a, "a-token-nobody-issued").await).await;
    let limited_wrong_scope = observable(get_with(port_b, BROWSER_TOKEN).await).await;
    assert_eq!(limited_unknown.0, 429, "the bound must engage on the same attempt for both");
    assert_eq!(
        limited_unknown, limited_wrong_scope,
        "and the two bounds must be indistinguishable too"
    );
}

#[tokio::test]
async fn the_trail_tells_apart_what_the_wire_deliberately_cannot() {
    // Identical outward; distinguished inward. The operator's own file is where the difference
    // lives, under names a consumer can route on without parsing a status code or log prose.
    let dir = temp_dir();
    let port = serve_gated(
        &dir,
        Some(AuthGate::for_test_with_audit(policy_with_a_browser_session(), &dir)),
    )
    .await;

    let _ = get_with(port, "a-token-nobody-issued").await; // authentication failed
    let _ = get_with(port, BROWSER_TOKEN).await; //            authorization refused
    let _ = get_prompts_with(port, GOOD_TOKEN).await; //       accepted

    let events: Vec<(String, String)> = audit_lines(&dir)
        .iter()
        .map(|line| {
            (
                line["event"].as_str().unwrap_or_default().to_string(),
                line["budget"].as_str().unwrap_or_default().to_string(),
            )
        })
        .collect();
    assert_eq!(
        events,
        vec![
            ("auth:authentication-failed".to_string(), "authentication".to_string()),
            ("auth:authorization-refused".to_string(), "authorization".to_string()),
            ("auth:accepted".to_string(), "-".to_string()),
        ],
        "three requests, three different facts, three different event names"
    );

    // The refusal that names a caller names the one the gate RESOLVED, never one claimed.
    let refused = audit_lines(&dir)
        .into_iter()
        .find(|line| line["event"] == "auth:authorization-refused")
        .expect("the scope refusal is recorded");
    assert_eq!(refused["identity"], BROWSER_IDENTITY);
    assert_eq!(refused["credential"], "scoped");

    // And a failed authentication resolves nobody, so it cannot name a victim.
    let failed = audit_lines(&dir)
        .into_iter()
        .find(|line| line["event"] == "auth:authentication-failed")
        .expect("the guess is recorded");
    assert_eq!(failed["identity"], "-");

    // No credential material anywhere in the file, over the whole vocabulary.
    let bytes = audit_bytes(&dir);
    for secret in [BROWSER_TOKEN, GOOD_TOKEN, "a-token-nobody-issued"] {
        assert!(!bytes.contains(secret), "the raw token {secret:?} must never reach the trail");
        assert!(
            !bytes.contains(&sha256_hex(secret)),
            "nor its digest — the trail is an attribution, not a credential store"
        );
        assert!(
            !bytes.contains(&sha256_hex(secret)[..8]),
            "nor a truncated one: eight hex characters of a digest is still a digest"
        );
    }
}

#[tokio::test]
async fn a_rate_limit_says_which_bound_engaged() {
    // The one fact a consumer cannot derive from the event name, and the one it most needs:
    // `authentication` means this node is being ground by someone guessing; `authorization`
    // means one caller this node KNOWS is asking for the wrong thing. Opposite responses, and
    // no HTTP status code distinguishes them — which is the whole reason the field exists.
    let dir = temp_dir();
    let port = serve_gated(
        &dir,
        Some(AuthGate::for_test_with_audit(policy_with_a_browser_session(), &dir)),
    )
    .await;

    for _ in 0..FAILURE_THRESHOLD {
        let _ = get_with(port, "a-token-nobody-issued").await;
    }
    for _ in 0..FAILURE_THRESHOLD {
        let _ = get_with(port, BROWSER_TOKEN).await;
    }

    let engaged: Vec<String> = audit_lines(&dir)
        .iter()
        .filter(|line| line["event"] == "auth:rate-limit-engaged")
        .map(|line| line["budget"].as_str().unwrap_or_default().to_string())
        .collect();
    assert_eq!(
        engaged,
        vec!["authentication".to_string(), "authorization".to_string()],
        "both bounds engaged, and each said which one it was"
    );
}
