//! Tests for the node's pending-prompt surface.
//!
//! Body-only child of `sidecar::pending_prompt` (see the `#[path]` decl there).
//!
//! Two halves, deliberately:
//!
//!   - the PURE half drives the hub directly, because the races are the whole contract and a
//!     race proven over a socket is a race proven on one scheduler on one day;
//!   - the LIVE half drives the real `sidecar_routes` + `listener_router` over real sockets,
//!     because attribution (P3) is a property of how a LISTENER was constructed and cannot be
//!     asserted about a function call.
//!
//! Run: `cargo test --lib pending_prompt --quiet`

use super::*;

use std::sync::{Arc, Barrier};
use std::time::Duration;

use crate::sidecar::auth::{sha256_hex, AuthGate, AuthPolicy, Credential};
use crate::sidecar::node_local::ListenRole;
use crate::sidecar::{listener_router, sidecar_routes};

// ── fixtures ───────────────────────────────────────────────────────────────────────────

fn confirm(question: &str) -> OperatorPrompt {
    OperatorPrompt::Confirm {
        question: question.to_string(),
        default: None,
    }
}

fn secret(question: &str) -> OperatorPrompt {
    OperatorPrompt::Secret {
        question: question.to_string(),
        visible_tail: None,
    }
}

fn select(question: &str, values: &[&str]) -> OperatorPrompt {
    OperatorPrompt::Select {
        question: question.to_string(),
        options: values
            .iter()
            .map(|value| SelectOption {
                value: value.to_string(),
                label: value.to_string(),
                description: None,
            })
            .collect(),
        default: None,
    }
}

fn asker() -> PendingPromptAsker {
    PendingPromptAsker {
        command: "refarm auth enrol".to_string(),
        pid: Some(4242),
        host: None,
    }
}

fn publish(hub: &PromptHub, prompt: OperatorPrompt) -> PromptTicket {
    hub.publish(prompt, asker(), 60_000).expect("a fresh hub accepts a prompt")
}

// ── P2: exactly one answer settles a prompt ────────────────────────────────────────────

#[test]
fn two_devices_answering_in_the_same_instant_produce_exactly_one_outcome() {
    // MUTATION GUARD for `HubInner::claim`. The compare-and-set is a single `remove` under
    // the hub's mutex; loosen it to a `get` (or move the removal after the send) and BOTH
    // threads settle the same question — which is the defect P2 exists to forbid, and the one
    // an operator would only ever see as a wizard that acted twice.
    //
    // Run many times: one iteration proves nothing about a race, and a barrier plus a real
    // pair of OS threads is the only honest way to put two callers inside `claim` at once.
    for _ in 0..200 {
        let hub = PromptHub::new();
        let ticket = publish(&hub, confirm("apply?"));
        let id = ticket.pending.id.clone();
        let gate = Arc::new(Barrier::new(2));

        // Both threads must be RUNNING before either is joined: the barrier only releases
        // when two participants have arrived, so a lazily-chained spawn/join would deadlock
        // on the first one — and, worse, would be testing nothing.
        let racing: Vec<_> = ["id-phone", "id-laptop"]
            .into_iter()
            .map(|device| {
                let hub = hub.clone();
                let id = id.clone();
                let gate = Arc::clone(&gate);
                std::thread::spawn(move || {
                    gate.wait();
                    hub.answer(&id, &serde_json::json!(true), device)
                })
            })
            .collect();
        let winners: Vec<_> = racing
            .into_iter()
            .map(|handle| handle.join().expect("no answering thread may panic"))
            .collect();

        let settled = winners
            .iter()
            .filter(|outcome| matches!(outcome, AnswerOutcome::Settled(_)))
            .count();
        let refused = winners
            .iter()
            .filter(|outcome| matches!(outcome, AnswerOutcome::AlreadySettled(_)))
            .count();
        assert_eq!(settled, 1, "exactly one device may settle a prompt: {winners:?}");
        assert_eq!(refused, 1, "the loser must be TOLD, not silently dropped: {winners:?}");

        // …and the ticket carries exactly one outcome, attributed to whoever won.
        let mut ticket = ticket;
        let outcome = ticket.settled_now().expect("a settled prompt delivers its outcome");
        assert_eq!(outcome.settlement.outcome, OUTCOME_ANSWERED);
        assert!(
            ["id-phone", "id-laptop"].contains(&outcome.settlement.device.as_str()),
            "the outcome must name the device that actually won"
        );
        assert_eq!(hub.pending_count(), 0, "a settled prompt leaves the live index");
    }
}

#[test]
fn a_second_answer_is_refused_and_told_which_device_won() {
    let hub = PromptHub::new();
    let ticket = publish(&hub, confirm("apply?"));
    let id = ticket.pending.id.clone();

    let first = hub.answer(&id, &serde_json::json!(true), "id-phone");
    assert!(matches!(first, AnswerOutcome::Settled(_)), "{first:?}");

    match hub.answer(&id, &serde_json::json!(false), "id-laptop") {
        AnswerOutcome::AlreadySettled(won) => {
            assert_eq!(won.device, "id-phone", "the loser is told WHO won");
            assert_eq!(won.outcome, OUTCOME_ANSWERED);
        }
        other => panic!("a settled prompt must refuse a second answer, got {other:?}"),
    }
}

#[test]
fn an_answer_racing_an_expiry_leaves_exactly_one_outcome() {
    // The two settlement paths that are NOT both answers: a device answering, and the
    // asker's own deadline. Both go through `claim`, so exactly one wins — and the ticket
    // must carry that one, never a second.
    for _ in 0..200 {
        let hub = PromptHub::new();
        let ticket = publish(&hub, confirm("apply?"));
        let id = ticket.pending.id.clone();
        let gate = Arc::new(Barrier::new(2));

        let answering = {
            let hub = hub.clone();
            let id = id.clone();
            let gate = Arc::clone(&gate);
            std::thread::spawn(move || {
                gate.wait();
                matches!(hub.answer(&id, &serde_json::json!(true), "id-phone"), AnswerOutcome::Settled(_))
            })
        };
        let expiring = {
            let hub = hub.clone();
            let id = id.clone();
            let gate = Arc::clone(&gate);
            std::thread::spawn(move || {
                gate.wait();
                hub.withdraw(&id, AbandonReason::Expired, TERMINAL_PROMPT_DEVICE)
            })
        };

        let answered = answering.join().unwrap();
        let expired = expiring.join().unwrap();
        assert_ne!(answered, expired, "exactly one of answer/expiry may settle a prompt");

        let mut ticket = ticket;
        let outcome = ticket.settled_now().expect("one settlement is delivered");
        if answered {
            assert_eq!(outcome.settlement.outcome, OUTCOME_ANSWERED);
            assert!(outcome.value.is_some(), "an answered prompt carries its value to the asker");
        } else {
            assert_eq!(outcome.settlement.outcome, OUTCOME_ABANDONED);
            assert_eq!(outcome.settlement.reason, Some("expired"));
            assert!(outcome.value.is_none(), "an abandoned prompt has no value to carry");
        }
    }
}

#[test]
fn an_answer_arriving_after_the_asker_gave_up_is_refused_with_what_happened() {
    // The asker dying mid-flight. Its ticket drops, the question is withdrawn, and a device
    // that was mid-answer is told it was abandoned — not handed a bare "unknown", which
    // reads as "you got the id wrong" and teaches a client to retry harder.
    let hub = PromptHub::new();
    let ticket = publish(&hub, confirm("apply?"));
    let id = ticket.pending.id.clone();

    drop(ticket);
    assert_eq!(hub.pending_count(), 0, "a dropped ticket takes its question with it (P1)");

    match hub.answer(&id, &serde_json::json!(true), "id-phone") {
        AnswerOutcome::AlreadySettled(settlement) => {
            assert_eq!(settlement.outcome, OUTCOME_ABANDONED);
            assert_eq!(settlement.reason, Some("withdrawn"));
            assert_eq!(settlement.device, TERMINAL_PROMPT_DEVICE);
        }
        other => panic!("expected already-settled/withdrawn, got {other:?}"),
    }
}

#[test]
fn dropping_a_ticket_after_its_answer_landed_changes_nothing() {
    // `Drop` withdraws unconditionally, which is only safe because `claim` is idempotent.
    // If it were not, every successful answer would be immediately overwritten by a
    // withdrawal the instant the handler returned.
    let hub = PromptHub::new();
    let ticket = publish(&hub, confirm("apply?"));
    let id = ticket.pending.id.clone();

    assert!(matches!(hub.answer(&id, &serde_json::json!(true), "id-phone"), AnswerOutcome::Settled(_)));
    drop(ticket);

    let settlement = hub.settlement_of(&id).expect("the settlement is remembered");
    assert_eq!(settlement.outcome, OUTCOME_ANSWERED, "the answer must survive the drop");
    assert_eq!(settlement.device, "id-phone");
}

#[test]
fn an_unknown_prompt_is_unknown_and_not_mistaken_for_a_settled_one() {
    let hub = PromptHub::new();
    assert!(matches!(
        hub.answer("p-never-existed", &serde_json::json!(true), "id-phone"),
        AnswerOutcome::Unknown
    ));
}

// ── P1: nothing persists, and the queue is bounded ─────────────────────────────────────

#[test]
fn the_bounded_queue_refuses_rather_than_growing() {
    // Honest polling and an honest queue: a node asks one question per blocked command, so
    // a full queue means something is wrong, and a wrong thing should say so rather than
    // accumulate questions nobody will ever see.
    let hub = PromptHub::with_limits(3, 8);
    let held: Vec<_> = (0..3).map(|_| publish(&hub, confirm("apply?"))).collect();
    assert!(matches!(
        hub.publish(confirm("one too many"), asker(), 1_000),
        Err(PublishRefusal::TooManyPending(3))
    ));

    // …and the ceiling is on SIMULTANEOUSLY pending prompts, not a lifetime budget: settle
    // one and the next publish is accepted again.
    drop(held);
    assert!(hub.publish(confirm("after the queue drained"), asker(), 1_000).is_ok());
}

#[test]
fn the_list_is_oldest_first_and_never_contains_a_settled_prompt() {
    let hub = PromptHub::new();
    let first = publish(&hub, confirm("first?"));
    let second = publish(&hub, confirm("second?"));
    let third = publish(&hub, confirm("third?"));

    let questions: Vec<String> = hub
        .list()
        .iter()
        .map(|pending| match &pending.prompt {
            OperatorPrompt::Confirm { question, .. } => question.clone(),
            other => panic!("unexpected prompt {other:?}"),
        })
        .collect();
    assert_eq!(questions, vec!["first?", "second?", "third?"]);

    hub.answer(&second.pending.id, &serde_json::json!(true), "id-phone");
    let remaining: Vec<String> = hub.list().iter().map(|pending| pending.id.clone()).collect();
    assert_eq!(
        remaining,
        vec![first.pending.id.clone(), third.pending.id.clone()],
        "a settled prompt must leave the list at once, and order must survive"
    );
}

#[test]
fn the_recent_settlement_ring_is_bounded_by_construction() {
    // The ring is what lets a losing peer be told what happened. It is fixed-size on
    // purpose: unbounded, it would be exactly the persisted-prompt store P1 forbids, wearing
    // a different name.
    let hub = PromptHub::with_limits(8, 2);
    let mut ids = Vec::new();
    for _ in 0..4 {
        let ticket = publish(&hub, confirm("apply?"));
        ids.push(ticket.pending.id.clone());
        hub.answer(&ticket.pending.id, &serde_json::json!(true), "id-phone");
    }
    assert!(hub.settlement_of(&ids[0]).is_none(), "the oldest settlement has aged out");
    assert!(hub.settlement_of(&ids[3]).is_some(), "the newest is still recallable");
}

// ── P3: attribution is the gate's, never the caller's ──────────────────────────────────

#[test]
fn the_answering_device_is_the_gate_s_and_an_absent_gate_yields_the_sentinel() {
    // MUTATION GUARD. There is deliberately no parameter here a caller can reach: the only
    // input is what the LISTENER's credential layer resolved. Give it back the identity it
    // verified, or — when this listener does not authenticate at all — the reserved
    // node-local sentinel. Never a name from a request.
    assert_eq!(
        resolve_answering_device(Some(&AuthenticatedDevice("id-phone".to_string()))),
        "id-phone"
    );
    assert_eq!(resolve_answering_device(None), NODE_LOCAL_PROMPT_DEVICE);
    // A gate that somehow resolved a blank identity is not an attribution either.
    assert_eq!(
        resolve_answering_device(Some(&AuthenticatedDevice("   ".to_string()))),
        NODE_LOCAL_PROMPT_DEVICE
    );
}

#[test]
fn a_reserved_sentinel_can_never_be_reached_through_the_gate() {
    // The leading space is the non-collidable convention, and TRIMMING is what enforces it:
    // even a policy that enrolled a device under the literal label " terminal" cannot make
    // this surface record the terminal as the answerer.
    for claimed in [TERMINAL_PROMPT_DEVICE, NODE_LOCAL_PROMPT_DEVICE] {
        let recorded = resolve_answering_device(Some(&AuthenticatedDevice(claimed.to_string())));
        assert_ne!(recorded, claimed, "{claimed:?} must not survive as itself");
        assert_eq!(recorded, claimed.trim(), "it is recorded as the trimmed, ordinary label");
    }
}

// ── P4: a settlement carries who, never what ───────────────────────────────────────────

#[test]
fn an_answer_value_redacts_itself_in_debug() {
    // The structural half of "never log an answer's value": the value cannot be printed by
    // accident, because there is no formatting of it that prints it. A derived `Debug` here
    // would leak a secret through any future `tracing` line, panic message, or `unwrap`.
    let value = AnswerValue(serde_json::json!("hunter2-the-actual-secret"));
    let printed = format!("{value:?}");
    assert!(!printed.contains("hunter2"), "a debug print must never carry the value: {printed}");
    assert_eq!(printed, "AnswerValue(<redacted>)");

    let outcome = PromptOutcome {
        settlement: PendingPromptSettlement {
            prompt_id: "p-1".to_string(),
            outcome: OUTCOME_ANSWERED,
            device: "id-phone".to_string(),
            reason: None,
            at: 0,
        },
        value: Some(value),
    };
    let printed = format!("{outcome:?}");
    assert!(!printed.contains("hunter2"), "nor through a struct that contains one: {printed}");
    assert!(printed.contains("id-phone"), "WHO answered is exactly what is safe to print");
}

#[test]
fn a_settlement_serialized_for_a_peer_carries_no_answer() {
    let hub = PromptHub::new();
    let ticket = publish(&hub, secret("token?"));
    hub.answer(&ticket.pending.id, &serde_json::json!("hunter2-the-actual-secret"), "id-phone");
    let settlement = hub.settlement_of(&ticket.pending.id).expect("remembered");
    let wire = serde_json::to_string(&settlement).unwrap();
    assert!(!wire.contains("hunter2"), "a settlement is the SAFE part: {wire}");
    assert!(wire.contains("id-phone"));
}

#[test]
fn answer_travels_is_computed_from_the_kind_and_not_read_off_the_request() {
    // P4. A publisher cannot strip the warning off a secret, because the publish body has no
    // field for it: the node recomputes it from the prompt's own kind. An attending surface
    // therefore always knows, before the operator types, that this answer will cross the wire.
    let raw = serde_json::json!({
        "prompt": { "type": "secret", "question": "token?" },
        "asker": { "command": "refarm auth enrol" },
        // A caller trying to suppress the warning. Ignored — there is nothing to ignore it
        // INTO, which is the stronger property.
        "answerTravels": false,
    });
    let request: PublishPromptRequest = serde_json::from_value(raw).expect("parses");
    let hub = PromptHub::new();
    let ticket = hub.publish(request.prompt, request.asker, 1_000).unwrap();
    assert!(ticket.pending.answer_travels, "a secret always travels");

    let ticket = publish(&hub, confirm("apply?"));
    assert!(!ticket.pending.answer_travels, "and a confirm never does");
}

// ── the prompt's own constraints, enforced on every surface ────────────────────────────

#[test]
fn a_select_cannot_settle_on_a_value_that_was_never_offered() {
    let hub = PromptHub::new();
    let ticket = publish(&hub, select("which farm?", &["home", "coop"]));
    match hub.answer(&ticket.pending.id, &serde_json::json!("elsewhere"), "id-phone") {
        AnswerOutcome::Invalid(detail) => {
            assert!(detail.contains("offered option values"), "{detail}");
            assert!(!detail.contains("elsewhere"), "a rejection never quotes the value: {detail}");
        }
        other => panic!("expected invalid, got {other:?}"),
    }
    assert_eq!(hub.pending_count(), 1, "an invalid answer must not settle the prompt");
    assert!(matches!(
        hub.answer(&ticket.pending.id, &serde_json::json!("coop"), "id-phone"),
        AnswerOutcome::Settled(_)
    ));
}

#[test]
fn a_confirm_takes_a_boolean_or_the_words_an_operator_would_type() {
    let hub = PromptHub::new();
    for (typed, expected) in [
        (serde_json::json!(true), true),
        (serde_json::json!("yes"), true),
        (serde_json::json!(" Y "), true),
        (serde_json::json!("0"), false),
        (serde_json::json!("no"), false),
    ] {
        let ticket = publish(&hub, confirm("apply?"));
        assert!(matches!(
            hub.answer(&ticket.pending.id, &typed, "id-phone"),
            AnswerOutcome::Settled(_)
        ));
        let mut ticket = ticket;
        let outcome = ticket.settled_now().unwrap();
        assert_eq!(outcome.value, Some(AnswerValue(serde_json::json!(expected))), "{typed:?}");
    }

    let ticket = publish(&hub, confirm("apply?"));
    assert!(matches!(
        hub.answer(&ticket.pending.id, &serde_json::json!("perhaps"), "id-phone"),
        AnswerOutcome::Invalid(_)
    ));
}

#[test]
fn a_rejection_of_a_secret_never_quotes_what_was_submitted() {
    let hub = PromptHub::new();
    let ticket = publish(&hub, secret("token?"));
    // A number where a string was wanted — the shape of a client bug, and the moment an
    // error string is most tempting to make "helpful" by echoing the input.
    match hub.answer(&ticket.pending.id, &serde_json::json!(1234567890), "id-phone") {
        AnswerOutcome::Invalid(detail) => {
            assert_eq!(detail, "secret expects a string");
            assert!(!detail.contains("1234567890"), "{detail}");
        }
        other => panic!("expected invalid, got {other:?}"),
    }
}

// ── the wire is the one the device kit already parses ──────────────────────────────────

#[test]
fn the_wire_vocabulary_is_the_one_the_vendored_block_parses() {
    // One convention, both sides — the same rule that binds `refarm auth enroll`'s policy
    // file name to the daemon's reader. `packages/prompt-contract-v1` is vendored verbatim
    // into the device kit, so a phone parses THESE strings; if either half renames one
    // alone, the node and the kit silently stop meeting and the only symptom is a prompt
    // that never appears.
    const CONTRACT: &str = include_str!("../../../prompt-contract-v1/src/index.ts");

    for pinned in [
        PENDING_PROMPT_WIRE,
        TERMINAL_PROMPT_DEVICE,
        NODE_LOCAL_PROMPT_DEVICE,
        OUTCOME_ANSWERED,
        OUTCOME_ABANDONED,
        "already-settled",
        "unknown-prompt",
        "invalid-answer",
    ] {
        assert!(
            CONTRACT.contains(&format!("\"{pinned}\"")),
            "the TypeScript block no longer names {pinned:?} — the node and the kit have drifted"
        );
    }
    for reason in [AbandonReason::Expired, AbandonReason::Withdrawn] {
        assert!(
            CONTRACT.contains(&format!("\"{}\"", reason.as_str())),
            "the TypeScript block no longer names the {:?} reason",
            reason
        );
    }
    assert!(
        CONTRACT.contains("PENDING_PROMPT_POLL_INTERVAL_MS = 2_000"),
        "the STATED poll interval must be the same number on both sides"
    );
    assert_eq!(PENDING_PROMPT_POLL_INTERVAL_MS, 2_000);
}

#[test]
fn a_published_prompt_serializes_to_the_shape_the_kit_expects() {
    let hub = PromptHub::new();
    let ticket = hub
        .publish(select("which farm?", &["home", "coop"]), asker(), 5_000)
        .unwrap();
    let wire: serde_json::Value = serde_json::to_value(&ticket.pending).unwrap();

    assert_eq!(wire["wire"], PENDING_PROMPT_WIRE);
    assert_eq!(wire["prompt"]["type"], "select");
    assert_eq!(wire["prompt"]["options"][1]["value"], "coop");
    assert_eq!(wire["answerTravels"], false);
    assert_eq!(wire["asker"]["command"], "refarm auth enrol");
    assert_eq!(wire["asker"]["pid"], 4242);
    // P5 — the deadline is on the wire, always. An attending device can say how long is left.
    assert_eq!(
        wire["expiresAt"].as_u64().unwrap(),
        wire["askedAt"].as_u64().unwrap() + 5_000
    );
}

// ── LIVE: the routes, over real sockets, through the production router ─────────────────

/// A gate enrolling exactly one credential — the same helper shape `tests/node_local.rs` uses.
fn gate_enrolling(token: &str, identity: &str) -> AuthGate {
    AuthGate::for_test(AuthPolicy::from_credentials(vec![Credential {
        token_sha256: sha256_hex(token),
        identity: identity.to_string(),
    }]))
}

/// Serve the REAL sidecar router on a fresh loopback socket with the given listener role and
/// gate, through the exact production path. Returns the port and a handle on the same hub the
/// routes are serving, so a test can assert what the node actually holds.
///
/// Both roles bind loopback on purpose (see `tests/node_local.rs`): what is under test is the
/// pair role → configuration → behaviour, and the address a listener happens to sit on is
/// precisely what must NOT matter.
async fn serve_prompts(role: ListenRole, gate: Option<AuthGate>) -> (u16, PromptHub) {
    let tmp = std::env::temp_dir().join(format!("tractor-prompts-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&tmp).unwrap();
    let state = SidecarState::for_test(&tmp, ":memory:").unwrap();
    let hub = state.prompts.clone();

    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let router = listener_router(sidecar_routes(state), role, gate, None);
    tokio::spawn(async move {
        let _ = axum::serve(listener, router).await;
    });
    (port, hub)
}

fn url(port: u16, path: &str) -> String {
    format!("http://127.0.0.1:{port}{path}")
}

/// Publish a prompt into the hub the way an ASKER would, from a background task that holds
/// its request open — the shape the routes are actually used in. Returns the prompt id once
/// the node is holding it.
fn published(hub: &PromptHub, prompt: OperatorPrompt) -> (String, PromptTicket) {
    let ticket = hub.publish(prompt, asker(), 30_000).expect("published");
    (ticket.pending.id.clone(), ticket)
}

async fn wait_until(mut done: impl FnMut() -> bool) -> bool {
    for _ in 0..300 {
        if done() {
            return true;
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    false
}

#[tokio::test]
async fn the_gated_listener_records_the_identity_its_own_credential_resolved() {
    // P3, live. The settlement must name the device the GATE authenticated — and the body's
    // own claim, sent in the very same request, must change nothing.
    let (port, hub) = serve_prompts(
        ListenRole::Declared,
        Some(gate_enrolling("phone-token", "id-arthur-phone")),
    )
    .await;
    let (id, ticket) = published(&hub, confirm("apply?"));

    let response = reqwest::Client::new()
        .post(url(port, &format!("/prompts/{id}/answer")))
        .bearer_auth("phone-token")
        .json(&serde_json::json!({ "value": true, "device": "id-someone-else" }))
        .send()
        .await
        .unwrap();

    assert_eq!(response.status(), 200);
    let body: serde_json::Value = response.json().await.unwrap();
    assert_eq!(body["device"], "id-arthur-phone", "the GATE decides who answered");
    assert_eq!(body["outcome"], OUTCOME_ANSWERED);

    let mut ticket = ticket;
    let outcome = ticket.settled_await().await.expect("the asker is woken");
    assert_eq!(
        outcome.settlement.device, "id-arthur-phone",
        "a caller may not name itself, not even as a suggestion"
    );
}

#[tokio::test]
async fn the_ungated_node_local_listener_records_node_local_and_never_a_claimed_device() {
    // The loopback listener is ungated BY DESIGN: a token the node presents to itself defends
    // nothing against someone who already has local shell, and a local caller could equally
    // walk to the terminal that asked and type the answer. What must still hold is that the
    // RECORD of who answered is not forgeable — otherwise P3 is decoration.
    let (port, hub) = serve_prompts(ListenRole::NodeLocal, Some(gate_enrolling("t", "id-x"))).await;
    let (id, ticket) = published(&hub, confirm("apply?"));

    let response = reqwest::Client::new()
        .post(url(port, &format!("/prompts/{id}/answer")))
        .json(&serde_json::json!({ "value": true, "device": "id-arthur-phone" }))
        .send()
        .await
        .unwrap();

    assert_eq!(response.status(), 200, "an ungated listener still accepts the answer");
    let body: serde_json::Value = response.json().await.unwrap();
    assert_eq!(
        body["device"], NODE_LOCAL_PROMPT_DEVICE,
        "an unauthenticated caller is node-local, and cannot claim to be an enrolled device"
    );
    let mut ticket = ticket;
    let outcome = ticket.settled_await().await.expect("the asker is woken");
    assert_eq!(outcome.settlement.device, NODE_LOCAL_PROMPT_DEVICE);
}

#[tokio::test]
async fn the_gated_listener_refuses_an_uncredentialed_answer_before_the_handler_sees_it() {
    // The gate is not weakened by these routes: they sit on the SAME router, inside the same
    // per-listener credential layer as every other route.
    let (port, hub) = serve_prompts(
        ListenRole::Declared,
        Some(gate_enrolling("phone-token", "id-arthur-phone")),
    )
    .await;
    let (id, _ticket) = published(&hub, confirm("apply?"));

    for request in [
        reqwest::Client::new().post(url(port, &format!("/prompts/{id}/answer"))),
        reqwest::Client::new().get(url(port, "/prompts")),
    ] {
        let status = request
            .json(&serde_json::json!({ "value": true }))
            .send()
            .await
            .unwrap()
            .status();
        assert_eq!(status, 401, "a declared listener gates the prompt surface too");
    }
    assert_eq!(hub.pending_count(), 1, "a refused request must not settle anything");
}

#[tokio::test]
async fn a_second_settlement_attempt_is_refused_409_naming_who_won() {
    let (port, hub) = serve_prompts(
        ListenRole::Declared,
        Some(gate_enrolling("phone-token", "id-arthur-phone")),
    )
    .await;
    let (id, _ticket) = published(&hub, confirm("apply?"));
    let client = reqwest::Client::new();

    let first = client
        .post(url(port, &format!("/prompts/{id}/answer")))
        .bearer_auth("phone-token")
        .json(&serde_json::json!({ "value": true }))
        .send()
        .await
        .unwrap();
    assert_eq!(first.status(), 200);

    let second = client
        .post(url(port, &format!("/prompts/{id}/answer")))
        .bearer_auth("phone-token")
        .json(&serde_json::json!({ "value": false }))
        .send()
        .await
        .unwrap();
    assert_eq!(second.status(), 409, "exactly one answer settles a prompt");
    let body: serde_json::Value = second.json().await.unwrap();
    assert_eq!(body["error"], "already-settled");
    assert_eq!(body["outcome"], OUTCOME_ANSWERED);
    assert_eq!(body["device"], "id-arthur-phone", "the loser is told who won");
}

#[tokio::test]
async fn an_unknown_prompt_id_is_404_and_an_illegal_answer_is_400() {
    let (port, hub) = serve_prompts(ListenRole::NodeLocal, None).await;
    let client = reqwest::Client::new();

    let unknown = client
        .post(url(port, "/prompts/p-never-existed/answer"))
        .json(&serde_json::json!({ "value": true }))
        .send()
        .await
        .unwrap();
    assert_eq!(unknown.status(), 404);
    assert_eq!(
        unknown.json::<serde_json::Value>().await.unwrap()["error"],
        "unknown-prompt"
    );

    let (id, _ticket) = published(&hub, select("which farm?", &["home", "coop"]));
    let illegal = client
        .post(url(port, &format!("/prompts/{id}/answer")))
        .json(&serde_json::json!({ "value": "elsewhere" }))
        .send()
        .await
        .unwrap();
    assert_eq!(illegal.status(), 400);
    assert_eq!(
        illegal.json::<serde_json::Value>().await.unwrap()["error"],
        "invalid-answer"
    );
}

#[tokio::test]
async fn the_list_route_states_its_poll_interval_and_shows_the_travel_warning() {
    let (port, hub) = serve_prompts(ListenRole::NodeLocal, None).await;
    let (id, _ticket) = published(&hub, secret("VPN passphrase?"));

    let body: serde_json::Value = reqwest::get(url(port, "/prompts"))
        .await
        .unwrap()
        .json()
        .await
        .unwrap();

    assert_eq!(body["wire"], PENDING_PROMPT_WIRE);
    assert_eq!(
        body["pollIntervalMs"], PENDING_PROMPT_POLL_INTERVAL_MS,
        "an attending device must not have to guess how often it is welcome to ask"
    );
    let prompts = body["prompts"].as_array().unwrap();
    assert_eq!(prompts.len(), 1);
    assert_eq!(prompts[0]["id"], id);
    assert_eq!(prompts[0]["prompt"]["type"], "secret");
    assert_eq!(
        prompts[0]["answerTravels"], true,
        "P4 — the attending surface is TOLD the answer will cross the wire, before typing"
    );
}

#[tokio::test]
async fn an_asker_that_publishes_over_http_is_woken_by_the_answer_and_gets_the_value() {
    // The whole round trip, both routes, on one node: an asker long-polls, an attending
    // device lists and answers, and the asker's own open request is where — and the only
    // place — the value comes back.
    let (port, hub) = serve_prompts(ListenRole::NodeLocal, None).await;
    let client = reqwest::Client::new();

    let asking = tokio::spawn({
        let client = client.clone();
        let publish_url = url(port, "/prompts");
        async move {
            client
                .post(publish_url)
                .json(&serde_json::json!({
                    "prompt": { "type": "text", "question": "which branch?" },
                    "asker": { "command": "refarm workspace run", "pid": 4242 },
                    "timeoutMs": 20_000,
                }))
                .send()
                .await
                .unwrap()
                .json::<serde_json::Value>()
                .await
                .unwrap()
        }
    });

    assert!(wait_until(|| hub.pending_count() == 1).await, "the question must appear");
    let listed: serde_json::Value = reqwest::get(url(port, "/prompts")).await.unwrap().json().await.unwrap();
    let id = listed["prompts"][0]["id"].as_str().unwrap().to_string();

    let answered = client
        .post(url(port, &format!("/prompts/{id}/answer")))
        .json(&serde_json::json!({ "value": "develop" }))
        .send()
        .await
        .unwrap();
    assert_eq!(answered.status(), 200);
    // The answering surface is told WHO, and nothing else: it can give an answer, never read one.
    let receipt: serde_json::Value = answered.json().await.unwrap();
    assert_eq!(receipt.as_object().unwrap().len(), 2, "receipt is outcome + device: {receipt}");
    assert!(receipt.get("value").is_none(), "a receipt must not echo the answer: {receipt}");

    let settled = asking.await.unwrap();
    assert_eq!(settled["outcome"], OUTCOME_ANSWERED);
    assert_eq!(settled["value"], "develop", "the asker gets the answer it was waiting for");
    assert_eq!(settled["device"], NODE_LOCAL_PROMPT_DEVICE);
    assert_eq!(hub.pending_count(), 0);
}

#[tokio::test]
async fn a_deadline_that_passes_is_an_abandoned_outcome_and_not_an_error() {
    // P5. A blocked CLI must be able to tell "nobody answered in time" from "the node is
    // unreachable". A timeout status or a dropped connection collapses those two into one,
    // so expiry is a 200 with a NAMED outcome.
    let (port, hub) = serve_prompts(ListenRole::NodeLocal, None).await;

    let response = reqwest::Client::new()
        .post(url(port, "/prompts"))
        .json(&serde_json::json!({
            "prompt": { "type": "confirm", "question": "apply?" },
            "asker": { "command": "refarm apply" },
            "timeoutMs": 120,
        }))
        .send()
        .await
        .unwrap();

    assert_eq!(response.status(), 200, "expiry is an outcome, not a transport failure");
    let body: serde_json::Value = response.json().await.unwrap();
    assert_eq!(body["outcome"], OUTCOME_ABANDONED);
    assert_eq!(body["reason"], "expired");
    assert_eq!(body["device"], TERMINAL_PROMPT_DEVICE);
    assert!(body.get("value").is_none(), "an abandoned prompt has no value: {body}");
    assert_eq!(hub.pending_count(), 0, "and the question is gone from every attending device");
}

#[tokio::test]
async fn a_publish_past_the_ceiling_is_refused_rather_than_queued() {
    // Honest polling has an honest queue behind it. Hold exactly the ceiling open, then ask
    // for one more: the refusal must be immediate and must NAME the ceiling, so a client
    // learns to back off instead of hammering.
    let (port, hub) = serve_prompts(ListenRole::NodeLocal, None).await;
    let client = reqwest::Client::new();
    let held_body = serde_json::json!({
        "prompt": { "type": "confirm", "question": "apply?" },
        "asker": { "command": "refarm apply" },
        "timeoutMs": 30_000,
    });

    let mut held = Vec::new();
    for _ in 0..DEFAULT_MAX_PENDING_PROMPTS {
        let client = client.clone();
        let publish_url = url(port, "/prompts");
        let body = held_body.clone();
        held.push(tokio::spawn(async move {
            let _ = client.post(publish_url).json(&body).send().await;
        }));
    }
    assert!(
        wait_until(|| hub.pending_count() == DEFAULT_MAX_PENDING_PROMPTS).await,
        "the ceiling must actually be reached before the refusal is meaningful"
    );

    let refused = client
        .post(url(port, "/prompts"))
        .json(&held_body)
        .send()
        .await
        .unwrap();
    assert_eq!(refused.status(), 429, "the bounded queue refuses, it does not grow");
    let body: serde_json::Value = refused.json().await.unwrap();
    assert_eq!(body["error"], "too-many-pending");
    assert_eq!(
        body["maxPending"].as_u64().unwrap() as usize,
        DEFAULT_MAX_PENDING_PROMPTS
    );

    for task in held {
        task.abort();
    }
}

#[tokio::test]
async fn an_asker_whose_connection_dies_takes_its_question_with_it() {
    // **P1, live.** The prompt's lifetime IS the asker's open request — which is exactly what
    // makes "nothing persists" free rather than a reaper someone has to maintain. Kill the
    // connection under the node and the question must disappear from the next poll, with no
    // liveness probe anywhere in the code.
    use tokio::io::AsyncWriteExt;

    let (port, hub) = serve_prompts(ListenRole::NodeLocal, None).await;
    let payload = serde_json::json!({
        "prompt": { "type": "confirm", "question": "apply?" },
        "asker": { "command": "refarm apply", "pid": 4242 },
        "timeoutMs": 300_000,
    })
    .to_string();

    let mut socket = tokio::net::TcpStream::connect(("127.0.0.1", port)).await.unwrap();
    // Linger 0 ⇒ dropping the socket sends RST rather than a graceful FIN: the honest
    // simulation of a process that was KILLED, not one that closed politely. Tokio deprecates
    // this because a NON-zero linger blocks the thread on drop; a zero linger is precisely the
    // case that does not — it makes close immediate.
    #[allow(deprecated)]
    socket.set_linger(Some(Duration::ZERO)).unwrap();
    socket
        .write_all(
            format!(
                "POST /prompts HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\n\
                 Content-Length: {}\r\n\r\n{payload}",
                payload.len()
            )
            .as_bytes(),
        )
        .await
        .unwrap();
    socket.flush().await.unwrap();

    assert!(wait_until(|| hub.pending_count() == 1).await, "the node must be holding the question");
    drop(socket);
    assert!(
        wait_until(|| hub.pending_count() == 0).await,
        "a question whose asker is gone is answerable and answers nothing — it must not survive"
    );
}

// ── never log an answer's value ────────────────────────────────────────────────────────

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

#[tokio::test]
async fn no_log_line_anywhere_on_this_path_carries_the_answer_value() {
    // P4 is load-bearing on BOTH sides. This drives a real secret prompt through the real
    // routes with `tracing` captured at TRACE, and asserts the secret never reaches a line —
    // while WHO answered does, because that is the part a settlement is allowed to carry.
    const SECRET: &str = "correct-horse-battery-staple-42";

    // CAPTURING is best-effort by construction, and that is a property of `tracing`, not of
    // this path. `set_default` installs a THREAD-LOCAL subscriber, while each callsite's
    // `Interest` is cached in a PROCESS-GLOBAL: any other test in this binary emitting a
    // first-time callsite on another thread re-evaluates that cache with no scoped
    // subscriber in view, and a callsite this test has not reached yet can come back
    // "never" — costing the buffer a line that WAS emitted. (Reproducible: run this
    // alongside any test that logs from a callsite the binary has never hit.)
    //
    // So drive the whole scenario until a capture actually lands, bounded. Nothing is
    // weakened: the SECRET assertion is made on EVERY attempt — a secret leaking on the
    // first attempt is a leak — and only the "the settlement is observable" half needs a
    // capture that arrived to judge. The next attempt's `set_default` rebuilds the interest
    // cache with this subscriber live, which is what makes retrying work at all.
    let mut captured = None;
    for _ in 0..5 {
        let logs = drive_a_secret_prompt(SECRET).await;
        assert!(
            !logs.contains(SECRET),
            "a secret prompt must be handleable without its value ever reaching a log line: {logs}"
        );
        if logs.contains("pending prompt settled") {
            captured = Some(logs);
            break;
        }
    }
    let logs = captured.expect("the settlement line must reach the buffer on some attempt");
    assert!(
        logs.contains("id-arthur-phone"),
        "and WHO answered is exactly what a settlement is allowed to say: {logs}"
    );
    assert!(logs.contains("pending prompt settled"), "the settlement is observable: {logs}");
}

/// One full publish → answer → settle cycle over the real routes, with `tracing`
/// captured at TRACE for its whole duration. Returns everything that reached the
/// buffer. Split out of the test above only so that test can run it more than once.
async fn drive_a_secret_prompt(secret: &str) -> String {
    let buffer: LogBuffer = Default::default();
    let subscriber = tracing_subscriber::fmt()
        .with_max_level(tracing::Level::TRACE)
        .with_ansi(false)
        .with_writer({
            let buffer = buffer.clone();
            move || Sink(buffer.clone())
        })
        .finish();
    let guard = tracing::subscriber::set_default(subscriber);

    let (port, hub) = serve_prompts(
        ListenRole::Declared,
        Some(gate_enrolling("phone-token", "id-arthur-phone")),
    )
    .await;
    let client = reqwest::Client::new();

    let asking = tokio::spawn({
        let client = client.clone();
        let publish_url = url(port, "/prompts");
        async move {
            client
                .post(publish_url)
                .bearer_auth("phone-token")
                .json(&serde_json::json!({
                    "prompt": { "type": "secret", "question": "VPN passphrase?" },
                    "asker": { "command": "refarm connection up serpro-vpn" },
                    "timeoutMs": 20_000,
                }))
                .send()
                .await
                .unwrap()
                .json::<serde_json::Value>()
                .await
                .unwrap()
        }
    });

    assert!(wait_until(|| hub.pending_count() == 1).await);
    let id = hub.list()[0].id.clone();
    let answered = client
        .post(url(port, &format!("/prompts/{id}/answer")))
        .bearer_auth("phone-token")
        .json(&serde_json::json!({ "value": secret }))
        .send()
        .await
        .unwrap();
    assert_eq!(answered.status(), 200);
    let settled = asking.await.unwrap();
    assert_eq!(settled["value"], secret, "the asker still receives it — that is the point");

    drop(guard);
    let logs = buffer.lock().unwrap().clone();
    String::from_utf8_lossy(&logs).to_string()
}

// ── The node's half of the announcement contract (N1-N3) ─────────────────────
//
// The framing a wizard states has to reach the surfaces that PULL — the PWA and
// `farm-attend` read this node's `GET /prompts`, not the TypeScript reference
// handler. Without these, a question arrives on a phone stripped of the sentences
// that explain it.

#[tokio::test]
async fn announce_stamps_a_monotonic_ordinal_across_askers() {
    let hub = PromptHub::new();
    let wizard = PendingPromptAsker { command: "refarm delivery add".into(), pid: Some(7), host: None };
    let other = PendingPromptAsker { command: "refarm auth enrol".into(), pid: Some(8), host: None };

    let a = hub.announce(&wizard, "precisa de um bot SEU", NoticeKind::Context);
    let b = hub.announce(&other, "de outro asker", NoticeKind::Context);
    let c = hub.announce(&wizard, "e do chatId", NoticeKind::Context);

    assert_eq!([a.ordinal, b.ordinal, c.ordinal], [1, 2, 3]);
    assert_eq!(a.wire, OPERATOR_NOTICE_WIRE);
    // N2 — the NODE stamps it. Several CLI processes announce into one node, so a
    // CLI-assigned ordinal would collide across processes and mean nothing to a poller.
    assert_eq!(hub.notices().len(), 3);
}

#[tokio::test]
async fn the_notice_ring_is_bounded() {
    let hub = PromptHub::with_notice_capacity(3);
    let asker = PendingPromptAsker { command: "refarm delivery add".into(), pid: None, host: None };
    for i in 0..10 {
        hub.announce(&asker, &format!("n{i}"), NoticeKind::Context);
    }
    let kept = hub.notices();
    assert_eq!(kept.len(), 3);
    assert_eq!(
        kept.iter().map(|n| n.message.as_str()).collect::<Vec<_>>(),
        ["n7", "n8", "n9"],
        "the ring keeps the LAST n, so the framing nearest the question survives"
    );
}

#[tokio::test]
async fn a_notice_outlives_the_prompt_it_framed() {
    let hub = PromptHub::new();
    let asker = PendingPromptAsker { command: "refarm delivery add".into(), pid: None, host: None };
    hub.announce(&asker, "o enquadramento", NoticeKind::Context);

    let ticket = hub
        .publish(
            OperatorPrompt::Text { question: "Qual o chatId?".into(), default: None, placeholder: None },
            asker.clone(),
            60_000,
        )
        .expect("publish");
    let id = hub.list()[0].id.clone();
    hub.answer(&id, &serde_json::json!("123"), "my-phone");
    drop(ticket);

    // D5: a notice has nobody waiting on it BY DEFINITION, so the P1 lifetime rule
    // does not transfer. A device that opens /attend after the question was settled
    // still reads what framed it.
    assert_eq!(hub.notices().len(), 1);
    assert_eq!(hub.notices()[0].message, "o enquadramento");
}

#[test]
fn an_unknown_kind_degrades_to_context_instead_of_dropping_the_message() {
    // A NEWER node (or a newer CLI) may name a kind this build does not have. The
    // MESSAGE is the part the operator needs, so it must survive — the same judgement
    // `checkPendingPromptWire` makes when it admits `unknown` rather than refusing.
    let parsed: NoticeKind = serde_json::from_value(serde_json::json!("urgent")).unwrap();
    assert_eq!(parsed, NoticeKind::Context);

    let known: NoticeKind = serde_json::from_value(serde_json::json!("decision")).unwrap();
    assert_eq!(known, NoticeKind::Decision);
}
