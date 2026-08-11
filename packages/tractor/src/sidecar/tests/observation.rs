//! `build_observation_node` — the PURE `BudgetObservation` node-shape builder.
//! No storage in the loop: these tests exercise `ObservationInput` →
//! `serde_json::Value` directly, mirroring the field names and behaviours D1,
//! D2 and D6 name in the Task 10 brief. Body-only child of `sidecar::tests`
//! (see the `#[path]` decl in tests.rs).

use super::super::budget::{resolve_budget, BudgetDeclaration, BudgetTriple, NodeBudget};
use super::super::observation::{build_observation_node, write_budget_observation, ObservationInput};
use super::super::verification::{verify, DeclaredVerification, Verification};
use super::super::{dispatch_effort, Effort, EffortTask, SidecarState, TaskResult};

/// The run that started this whole design: a declared 300s cut to the node's 45s,
/// which then timed out at step 4 of a 25-step plan.
fn base_input() -> ObservationInput<'static> {
    let node = NodeBudget {
        ceiling: BudgetTriple { deadline_ms: 45_000, max_tokens: 500_000, max_usd_millis: 10_000 },
        default: BudgetTriple { deadline_ms: 45_000, max_tokens: 100_000, max_usd_millis: 1_000 },
    };
    let declared = BudgetDeclaration { deadline_ms: Some(300_000), ..Default::default() };
    ObservationInput {
        effort_id: "eff-1",
        prompt_ref: Some("urn:sovereign:prompt-1"),
        workspace_id: Some("rcdc5"),
        workspace_source: None,
        spawner: Some("termux"),
        outcome: "timed-out",
        elapsed_ms: Some(45_000),
        steps_completed: Some(4),
        steps_planned: Some(25),
        // One dispatch that ran four of its twenty-five steps — the shape of the
        // measurement that started all of this, and a standing reminder that the
        // turn count is not the numerator.
        turns_completed: Some(1),
        resolved: Some(resolve_budget(Some(&declared), None, &node)),
        usage: None,
        // The identity fields default absent here — every existing test below spreads
        // `..base_input()` and asserts on unrelated fields, so this keeps them
        // untouched. The dedicated identity tests further down override these.
        node_name: None,
        node_id: None,
        // Same for the scenario pair: undeclared and underived by default, which
        // is also what most of field use looks like.
        scenario_id: None,
        scenario_hash: None,
        // And for the verdict: nobody declared an expectation, which is what
        // nearly every run looks like and must stay the zero-key default.
        verification: None,
    }
}

#[test]
fn the_observation_records_all_three_axes_asked_and_ruling() {
    let node = build_observation_node(base_input());
    assert_eq!(node["@type"], "BudgetObservation");
    assert_eq!(node["refarm.budget.deadline_ms.declared"], 300_000);
    assert_eq!(node["refarm.budget.deadline_ms.effective"], 45_000);
    assert_eq!(node["refarm.budget.bound_by"], "node");
    // The axes nobody declared are still recorded: an aggregate that only sees
    // the axis someone happened to set cannot say what the others cost.
    assert_eq!(node["refarm.budget.max_tokens.effective"], 100_000);
    assert_eq!(node["refarm.budget.max_usd.effective"], 1.0);
    assert_eq!(node["refarm.budget.max_tokens.declared"], serde_json::Value::Null);
    assert_eq!(node["refarm.outcome"], "timed-out");
    assert_eq!(node["refarm.outcome.steps_completed"], 4);
    assert_eq!(node["refarm.outcome.steps_planned"], 25);
    assert_eq!(node["refarm.workspace.id"], "rcdc5");
}

/// ISS-058. A record that names a workspace without saying whether the run CLAIMED it or was
/// GUESSED into it cannot be aggregated: "spend on rcdc5" would silently mix money the operator
/// attributed there with money attributed by a directory that looked like it.
#[test]
fn the_record_says_whether_the_workspace_was_claimed_or_guessed() {
    let node = build_observation_node(ObservationInput {
        workspace_id: Some("rcdc5"),
        workspace_source: Some("declared"),
        ..base_input()
    });
    assert_eq!(node["refarm.workspace.id"], "rcdc5");
    assert_eq!(node["refarm.workspace.source"], "declared");

    let seeded = build_observation_node(ObservationInput {
        workspace_id: Some("rcdc5"),
        workspace_source: Some("seeded-from-cwd"),
        ..base_input()
    });
    assert_eq!(seeded["refarm.workspace.source"], "seeded-from-cwd");

    // OMITTED, never defaulted (D6). Every observation written before this field existed says
    // nothing about provenance, and a `"declared"` invented here would read to every future
    // analysis as an operator's claim about money that nobody claimed.
    let unknown = build_observation_node(ObservationInput {
        workspace_id: Some("rcdc5"),
        workspace_source: None,
        ..base_input()
    });
    assert!(unknown.get("refarm.workspace.source").is_none());
}

#[test]
fn an_undeclared_scenario_is_absent_from_the_record_not_null() {
    // This field used to be written as an explicit `null` on every observation,
    // on the premise that only a bench declares a scenario. D6 governs it like
    // every other undeterminable field now: nobody declared one, so there is no
    // key — a null here would be indistinguishable from the "we could not tell"
    // a restart mid-run leaves behind.
    let node = build_observation_node(base_input());
    assert!(
        node.get("refarm.scenario.id").is_none(),
        "an undeclared scenario is absent, not null: {node}"
    );
    assert!(
        node.get("refarm.scenario.hash").is_none(),
        "an unresolvable request shape is absent, not null: {node}"
    );
}

#[test]
fn a_declared_scenario_and_a_derived_hash_land_as_flat_top_level_keys() {
    let node = build_observation_node(ObservationInput {
        scenario_id: Some("summarise-v1"),
        scenario_hash: Some("sha256:deadbeef"),
        ..base_input()
    });
    assert_eq!(node["refarm.scenario.id"], "summarise-v1");
    assert_eq!(node["refarm.scenario.hash"], "sha256:deadbeef");
}

#[test]
fn a_hash_without_a_declared_id_still_makes_undeclared_field_use_comparable() {
    // The ordinary case: the operator labels nothing, but two runs of literally
    // the same request still join on the hash. The id staying absent is the
    // point, not a gap.
    let node = build_observation_node(ObservationInput {
        scenario_hash: Some("sha256:deadbeef"),
        ..base_input()
    });
    assert!(node.get("refarm.scenario.id").is_none());
    assert_eq!(node["refarm.scenario.hash"], "sha256:deadbeef");
}

// ── whether the run was RIGHT (`refarm.verification.*`) ───────────────────────
//
// The verdicts below are produced by the REAL matcher (`verification::verify`)
// over REAL `TaskResult`s rather than hand-written enum variants, so these tests
// pin the whole judgement — read the answer, compare it, shape the node — and
// not merely the last third of it.

/// One `TaskResult` shaped exactly as the respond path finalises a completed
/// agent turn: `{"content": …}` plus whatever usage joined.
fn answered(content: &str) -> Vec<TaskResult> {
    vec![TaskResult {
        status: "ok".to_string(),
        result: Some(serde_json::json!({ "content": content })),
        error: None,
    }]
}

fn verdict_for(expected: &str, results: &[TaskResult]) -> Verification {
    verify(expected, results)
}

#[test]
fn a_run_nobody_checked_carries_no_verification_key_at_all() {
    // The ordinary case, and the one that must stay free: no expectation was
    // declared, so there is no verdict — not `null`, not `true`, no key. Every
    // observation ever written before this change is still a valid one.
    let node = build_observation_node(base_input());
    for key in [
        "refarm.verification.expected",
        "refarm.verification.passed",
        "refarm.verification.method",
        "refarm.verification.unknown",
    ] {
        assert!(node.get(key).is_none(), "{key} must be absent when nobody checked: {node}");
    }
}

#[test]
fn a_matching_answer_is_true_and_leaves_the_outcome_exactly_as_it_was() {
    let results = answered("There are 59 .md files.");
    let node = build_observation_node(ObservationInput {
        outcome: super::super::EFFORT_DONE,
        verification: Some(DeclaredVerification { expected: "59", verdict: verdict_for("59", &results) }),
        ..base_input()
    });
    assert_eq!(node["refarm.verification.expected"], "59");
    assert_eq!(node["refarm.verification.passed"], true);
    assert_eq!(node["refarm.verification.method"], "substring");
    assert!(node.get("refarm.verification.unknown").is_none());
    // The point of the whole slice: `refarm.outcome` is untouched either way.
    assert_eq!(node["refarm.outcome"], "done");
}

#[test]
fn the_2026_08_05_run_records_false_while_the_outcome_still_says_done() {
    // The regression this exists for. The operator asked for a count of `.md`
    // files; the agent answered 58 and the answer is 59. The effort COMPLETED,
    // so `refarm.outcome` was — and remains — "done". What was missing is the
    // separate fact beside it, and conflating the two would destroy exactly the
    // distinction this record now draws.
    let results = answered("58");
    let node = build_observation_node(ObservationInput {
        outcome: super::super::EFFORT_DONE,
        verification: Some(DeclaredVerification { expected: "59", verdict: verdict_for("59", &results) }),
        ..base_input()
    });
    assert_eq!(node["refarm.verification.passed"], false, "the run was wrong: {node}");
    assert_eq!(node["refarm.verification.expected"], "59");
    assert_eq!(node["refarm.verification.method"], "substring");
    assert_eq!(
        node["refarm.outcome"], "done",
        "a wrong answer is not a failed effort — `done` was never the wrong word: {node}"
    );
}

#[test]
fn an_expectation_with_nothing_comparable_leaves_the_verdict_absent_and_records_why() {
    // NOT `false`. A `failed` effort carries an error, not an answer, and
    // recording a failed verification here would accuse a model of being wrong
    // when nobody looked at anything.
    let results = vec![TaskResult {
        status: "error".to_string(),
        result: None,
        error: Some("@refarm/agent not loaded".to_string()),
    }];
    let node = build_observation_node(ObservationInput {
        outcome: "failed",
        verification: Some(DeclaredVerification { expected: "59", verdict: verdict_for("59", &results) }),
        ..base_input()
    });
    assert_eq!(node["refarm.verification.expected"], "59");
    assert!(
        node.get("refarm.verification.passed").is_none(),
        "declared-but-uncomparable is a third state, never false: {node}"
    );
    assert!(
        node.get("refarm.verification.method").is_none(),
        "no comparison ran, so no method may be claimed: {node}"
    );
    assert_eq!(node["refarm.verification.unknown"], "no-result");
    assert_eq!(node["refarm.outcome"], "failed");
}

#[test]
fn an_unreadable_result_is_reported_as_a_gap_in_the_checking_not_as_a_wrong_answer() {
    // The other reason, kept separate the way `contextWindowUnknown` keeps
    // `not-published` apart from `source-not-found`: a delivery receipt IS a
    // result, it just is not an answer this matcher can read — a fact about this
    // file, not about the run.
    let results = vec![TaskResult {
        status: "ok".to_string(),
        result: Some(serde_json::json!({ "dispatched": "user:prompt", "sent": 1 })),
        error: None,
    }];
    let node = build_observation_node(ObservationInput {
        outcome: super::super::EFFORT_DELIVERED,
        verification: Some(DeclaredVerification {
            expected: "user:prompt",
            verdict: verdict_for("user:prompt", &results),
        }),
        ..base_input()
    });
    assert!(node.get("refarm.verification.passed").is_none());
    assert_eq!(node["refarm.verification.unknown"], "result-not-readable");
}

#[test]
fn an_undeterminable_field_is_omitted_rather_than_zeroed() {
    // D6: absent is not zero. A run with no workspace must not read as
    // workspace "" or 0 once someone aggregates a thousand of these. Same for a
    // run with no plan, where a planned step count does not exist at all.
    let node = build_observation_node(ObservationInput {
        workspace_id: None,
        workspace_source: None,
        steps_planned: None,
        ..base_input()
    });
    assert!(
        node.get("refarm.workspace.id").is_none(),
        "an unknown workspace is absent, not empty"
    );
    assert!(
        node.get("refarm.outcome.steps_planned").is_none(),
        "a run with no plan has no planned total, which is not the same as zero"
    );
}

#[test]
fn the_observation_carries_the_declared_name_and_opaque_id_when_both_are_known() {
    let node = build_observation_node(ObservationInput {
        node_name: Some("galaxy-a55-5g-desktop"),
        node_id: Some("b6e9c9c0-1e2f-4a3b-9c1d-0e5f6a7b8c9d"),
        ..base_input()
    });
    assert_eq!(node["host.name"], "galaxy-a55-5g-desktop");
    assert_eq!(node["host.id"], "b6e9c9c0-1e2f-4a3b-9c1d-0e5f6a7b8c9d");
}

#[test]
fn an_unnamed_or_unidentified_node_omits_the_keys_rather_than_an_empty_string() {
    // D6 applied to WHO ran this, not just what it spent: a node with no declared
    // name records no `host.name` key at all — never `""`, which an aggregate could
    // mistake for a legitimately-named (if oddly blank) node.
    let node = build_observation_node(ObservationInput { node_name: None, node_id: None, ..base_input() });
    assert!(node.get("host.name").is_none(), "an undeclared node name is absent, not empty");
    assert!(node.get("host.id").is_none(), "an unestablished node id is absent, not empty");
}

#[test]
fn the_joined_usage_lands_flat_under_otel_names() {
    // D2: a dataset consumer reads gen_ai.usage.input_tokens at THAT key. A
    // nested blob would make the vocabulary decorative.
    let node = build_observation_node(ObservationInput {
        usage: Some(serde_json::json!({
            "provider": "anthropic",
            "model": "claude-sonnet-4-6",
            "usage": {
                "tokens_in": 50,
                "tokens_out": 10,
                "cache_read_input_tokens": 100_000,
                "cache_creation_input_tokens": 2_048,
                "pricing_mode": "api",
                "estimated_usd": 0.0301,
            }
        })),
        ..base_input()
    });
    assert_eq!(node["gen_ai.usage.input_tokens"], 50);
    assert_eq!(node["gen_ai.usage.cache_read.input_tokens"], 100_000);
    assert_eq!(node["gen_ai.usage.cache_creation.input_tokens"], 2_048);
    assert_eq!(node["gen_ai.provider.name"], "anthropic");
    assert_eq!(node["refarm.cost.estimated_usd"], 0.0301);
    assert!(
        node.get("refarm.usage").is_none(),
        "usage must be flattened, never nested under an opaque key"
    );
}

#[test]
fn a_currency_ceiling_records_that_it_could_not_bind() {
    // D1: under a subscription the estimate is a structural zero, so a USD
    // ceiling can never bind. Recording it without saying so would let an
    // aggregate read an unenforced ceiling as a satisfied one.
    let subscription = build_observation_node(ObservationInput {
        usage: Some(serde_json::json!({ "usage": { "pricing_mode": "subscription" } })),
        ..base_input()
    });
    assert_eq!(subscription["refarm.budget.max_usd.enforced"], false);

    // F1, round-2 Critical: `api` pricing mode ALONE is not enough. `base_input()`
    // declares only `deadline_ms` — nothing on the max_usd axis was ever
    // forwarded to the guest (`dispatch.rs`'s `ceilings_for_payload` gates on
    // `declared.is_some()`, and an undeclared axis still resolves to a concrete
    // `.effective` default that nothing enforces). Recording `enforced: true`
    // here — pricing mode alone, nothing declared — is exactly the failure D1
    // invented this field to prevent, inverted into the field itself.
    let api_undeclared = build_observation_node(ObservationInput {
        usage: Some(serde_json::json!({ "usage": { "pricing_mode": "api" } })),
        ..base_input()
    });
    assert_eq!(
        api_undeclared["refarm.budget.max_usd.enforced"], false,
        "api pricing mode with an UNDECLARED max_usd axis enforces nothing — nothing was ever sent to the guest"
    );

    // Only api pricing mode AND a DECLARED max_usd together enforce.
    let node = NodeBudget {
        ceiling: BudgetTriple { deadline_ms: 45_000, max_tokens: 500_000, max_usd_millis: 10_000 },
        default: BudgetTriple { deadline_ms: 45_000, max_tokens: 100_000, max_usd_millis: 1_000 },
    };
    let declared = BudgetDeclaration { max_usd_millis: Some(500), ..Default::default() };
    let api_declared = build_observation_node(ObservationInput {
        usage: Some(serde_json::json!({ "usage": { "pricing_mode": "api" } })),
        resolved: Some(resolve_budget(Some(&declared), None, &node)),
        ..base_input()
    });
    assert_eq!(api_declared["refarm.budget.max_usd.enforced"], true);

    // Unknown pricing mode is absent, never a default true (D6).
    let unknown = build_observation_node(base_input());
    assert!(unknown.get("refarm.budget.max_usd.enforced").is_none());
}

// ── round-1 fix: stored-not-recomputed budget, and elapsed_ms no longer takes the
// whole record down with it ─────────────────────────────────────────────────────

#[test]
fn a_missing_resolution_omits_the_whole_budget_family_rather_than_recomputing() {
    // D6, and the round-1 Critical finding: when no dispatch-time resolution was
    // found (a restart mid-run), `record_budget_observation` must NOT fall back
    // to re-resolving the fold — that is the bug the fix closes, wearing a
    // fallback's clothes. The node-shape contract for that decision is: the
    // ENTIRE `refarm.budget.*` family is absent, not partially reconstructed.
    let node = build_observation_node(ObservationInput { resolved: None, ..base_input() });
    for key in [
        "refarm.budget.deadline_ms.effective",
        "refarm.budget.deadline_ms.declared",
        "refarm.budget.max_tokens.effective",
        "refarm.budget.max_tokens.declared",
        "refarm.budget.max_usd.effective",
        "refarm.budget.max_usd.declared",
        "refarm.budget.bound_by",
        "refarm.budget.bound_by.max_tokens",
        "refarm.budget.bound_by.max_usd",
    ] {
        assert!(
            node.get(key).is_none(),
            "{key} must be absent when no budget resolution was found, not a guessed or zeroed value"
        );
    }
    // The rest of the record is unaffected — a missing budget resolution costs
    // only the budget fields, per D5's "lose the least possible".
    assert_eq!(node["refarm.outcome"], "timed-out");
    assert_eq!(node["refarm.workspace.id"], "rcdc5");
}

#[test]
fn an_unparseable_elapsed_time_does_not_drop_the_rest_of_the_evidence() {
    // Round-1 Minor finding: a timestamp-parse failure used to `return` out of
    // `record_budget_observation` before anything was built, dropping outcome,
    // budget axes and workspace along with `elapsed_ms`. `put_opt` now costs it
    // only the one field it could not determine.
    let node = build_observation_node(ObservationInput { elapsed_ms: None, ..base_input() });
    assert!(
        node.get("refarm.elapsed_ms").is_none(),
        "an undeterminable elapsed time is absent, not a fabricated duration"
    );
    assert_eq!(node["refarm.outcome"], "timed-out");
    assert_eq!(node["refarm.workspace.id"], "rcdc5");
    assert_eq!(
        node["refarm.budget.deadline_ms.effective"], 45_000,
        "the budget family survives an elapsed_ms parse failure intact"
    );
}

// ── the regression proof: dispatch resolves against config A, config becomes B
// before finalisation, the observation must still report A ─────────────────────
//
// Local env guard + config writer, matching `tests/budget.rs`'s own
// `SovereignDirGuard`/`tempdir_with_config` — that file's doc explains why these
// live per-file rather than shared (different families need different values).
// This is the first sidecar-level test to touch `SOVEREIGN_BASE` rather than
// passing a `node_base` straight to a pure budget function, because it exercises
// `dispatch_effort` itself (which reads `crate::host::declared_base()`), not the
// budget fold in isolation.

struct EnvGuard {
    key: &'static str,
    previous: Option<String>,
}

impl EnvGuard {
    fn set(key: &'static str, value: &str) -> Self {
        let previous = std::env::var(key).ok();
        std::env::set_var(key, value);
        Self { key, previous }
    }
}

impl Drop for EnvGuard {
    fn drop(&mut self) {
        match &self.previous {
            Some(v) => std::env::set_var(self.key, v),
            None => std::env::remove_var(self.key),
        }
    }
}

fn write_sovereign_config(node_base: &std::path::Path, json: &str) {
    let sovereign_dir = node_base.join(".refarm");
    std::fs::create_dir_all(&sovereign_dir).expect("create .refarm dir");
    std::fs::write(sovereign_dir.join("config.json"), json).expect("write config.json");
}

#[tokio::test]
async fn a_config_change_after_dispatch_does_not_leak_into_the_observation() {
    // The round-1 Critical fix, proved end to end: `dispatch_effort` resolves
    // the budget against config A and stashes it (`dispatch::dispatched_budgets`);
    // the config is then rewritten to B; finalisation must read back A, not
    // re-resolve against B. `#[tokio::test]` defaults to the current-thread
    // flavour (only `observer.rs` opts into `multi_thread` in this crate), so
    // the ordering below is deterministic, not racy: nothing spawned by
    // `dispatch_effort` gets polled until this test function itself yields at
    // an `.await`, which happens only after the config has already been
    // rewritten to B.
    let _env = crate::test_support::env_lock();
    let _sovereign_dir = EnvGuard::set("SOVEREIGN_DIR", ".refarm");

    let node_base = tempfile::tempdir().expect("tempdir");
    let _sovereign_base = EnvGuard::set("SOVEREIGN_BASE", node_base.path().to_str().expect("utf8 path"));
    write_sovereign_config(
        node_base.path(),
        r#"{ "budget": { "node": { "default": { "maxTokens": 111111 } } } }"#,
    );

    let tmp = std::env::temp_dir().join(format!("tractor-observation-test-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&tmp).expect("create tmp");
    let namespace = std::env::temp_dir()
        .join(format!("tractor-observation-ns-{}.db", uuid::Uuid::new_v4()))
        .to_str()
        .expect("utf8 path")
        .to_owned();
    let state = SidecarState::for_test(&tmp, &namespace).expect("state");

    let effort_id = format!("obs-cfg-{}", uuid::Uuid::new_v4());
    let effort = Effort {
        id: effort_id.clone(),
        direction: Some("ask".to_string()),
        tasks: vec![EffortTask {
            id: uuid::Uuid::new_v4().to_string(),
            plugin_id: "@refarm/agent".to_string(),
            fn_name: Some("respond".to_string()),
            args: serde_json::json!({ "prompt": "ping" }),
        }],
        source: Some("test".to_string()),
        // Millisecond shape ON PURPOSE. Every real client stamps `submittedAt` with
        // `new Date().toISOString()`, which always carries `.sss`; the seconds shape this
        // fixture used to carry is one NOTHING in production emits, and using it here is
        // what let a seconds-only parser drop `refarm.elapsed_ms` from every real
        // observation while these tests reported a clean path.
        submitted_at: "2026-01-01T00:00:00.123Z".to_string(),
        // Undeclared on purpose: an undeclared axis falls back to the CONFIG's
        // node default, which is exactly the value this test moves out from
        // under the effort between dispatch and finalisation.
        budget: None,
        workspace_id: None,
        workspace_source: None,
        scenario_id: None,
        expectation: None,
    };

    // Dispatch: this SYNCHRONOUSLY resolves the budget against config A (the
    // 111111 written above) and stashes it, before the spawned task (which
    // fails fast — no `@refarm/agent` channel is registered) ever runs.
    dispatch_effort(state.clone(), effort);

    // Now change what the fold would resolve to. If finalisation re-reads
    // config, the observation reports 222222; if it reads back what dispatch
    // saw, it reports 111111.
    write_sovereign_config(
        node_base.path(),
        r#"{ "budget": { "node": { "default": { "maxTokens": 222222 } } } }"#,
    );

    tokio::time::sleep(tokio::time::Duration::from_millis(200)).await;

    let storage = crate::storage::NativeStorage::open(&namespace).expect("open storage");
    let rows = storage.query_nodes("BudgetObservation").expect("query nodes");
    let node = rows
        .iter()
        .find_map(|row| {
            let value: serde_json::Value = serde_json::from_str(&row.payload).ok()?;
            (value.get("effort_id").and_then(|v| v.as_str()) == Some(effort_id.as_str())).then_some(value)
        })
        .expect("a BudgetObservation node for this effort");

    assert_eq!(
        node["refarm.budget.max_tokens.effective"], 111_111,
        "the observation must report the budget dispatch actually resolved, not what the config resolves to NOW"
    );

    // The elapsed regression, caught end to end: with a client-shaped `submittedAt`, the
    // derivation must produce a number. It was absent from EVERY real observation until
    // `timefmt` learned the millisecond shape, and no test noticed because no fixture
    // used it.
    assert!(
        node.get("refarm.elapsed_ms").and_then(|v| v.as_u64()).is_some(),
        "elapsed_ms must be derivable from the timestamp shape real clients send: {node}"
    );
}

// ── F2, round-2 Critical: the event-dispatch path never stashes a resolution,
// so its observation omits the whole budget family rather than fabricating one ──

#[tokio::test]
async fn an_event_dispatch_efforts_observation_carries_no_budget_family() {
    // `fn != "respond"` routes to `dispatch_event_effort` (`dispatch.rs`), which
    // never spawns the deadline watcher and never forwards a ceiling to any
    // guest — no budget governs this path at all. Before the fix,
    // `dispatch_effort` still resolved and stashed a budget for EVERY effort
    // up front regardless of its verb, so `record_budget_observation` read it
    // back at finalisation and wrote a full three-axis `refarm.budget.*`
    // family onto an effort nothing ever enforced. D6 says absent is honest —
    // this proves the whole family is absent, not partially reconstructed.
    let _env = crate::test_support::env_lock();
    let _sovereign_dir = EnvGuard::set("SOVEREIGN_DIR", ".refarm");
    let node_base = tempfile::tempdir().expect("tempdir");
    let _sovereign_base = EnvGuard::set("SOVEREIGN_BASE", node_base.path().to_str().expect("utf8 path"));

    let tmp = std::env::temp_dir().join(format!("tractor-observation-event-test-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&tmp).expect("create tmp");
    let namespace = std::env::temp_dir()
        .join(format!("tractor-observation-event-ns-{}.db", uuid::Uuid::new_v4()))
        .to_str()
        .expect("utf8 path")
        .to_owned();
    let state = SidecarState::for_test(&tmp, &namespace).expect("state");

    let effort_id = format!("obs-event-{}", uuid::Uuid::new_v4());
    let effort = Effort {
        id: effort_id.clone(),
        direction: Some("dispatch".to_string()),
        tasks: vec![EffortTask {
            id: uuid::Uuid::new_v4().to_string(),
            plugin_id: "vault".to_string(),
            fn_name: Some("extract".to_string()),
            args: serde_json::json!({}),
        }],
        source: Some("test".to_string()),
        submitted_at: "2026-01-01T00:00:00Z".to_string(),
        budget: None,
        workspace_id: None,
        workspace_source: None,
        scenario_id: None,
        expectation: None,
    };

    // `SidecarState::for_test` registers no plugin channel, so the router
    // delivers to nobody and this finalises `failed` — still a TERMINAL
    // status, which is all `finalise_effort`'s observation call site requires.
    dispatch_effort(state.clone(), effort);

    tokio::time::sleep(tokio::time::Duration::from_millis(200)).await;

    let storage = crate::storage::NativeStorage::open(&namespace).expect("open storage");
    let rows = storage.query_nodes("BudgetObservation").expect("query nodes");
    let node = rows
        .iter()
        .find_map(|row| {
            let value: serde_json::Value = serde_json::from_str(&row.payload).ok()?;
            (value.get("effort_id").and_then(|v| v.as_str()) == Some(effort_id.as_str())).then_some(value)
        })
        .expect("a BudgetObservation node for this event-dispatch effort");

    assert_eq!(node["refarm.outcome"], "failed");
    for key in [
        "refarm.budget.deadline_ms.effective",
        "refarm.budget.deadline_ms.declared",
        "refarm.budget.max_tokens.effective",
        "refarm.budget.max_tokens.declared",
        "refarm.budget.max_usd.effective",
        "refarm.budget.max_usd.declared",
        "refarm.budget.max_usd.enforced",
        "refarm.budget.bound_by",
        "refarm.budget.bound_by.max_tokens",
        "refarm.budget.bound_by.max_usd",
    ] {
        assert!(
            node.get(key).is_none(),
            "{key} must be absent on an event-dispatch effort's observation — no budget governed it"
        );
    }
}

// ── F1's other missing half: `write_budget_observation` (the ONE production
// call site) must read BOTH halves of the step fraction off the joined
// UsageRecord — the numerator it shipped reading, and the denominator it
// shipped hardcoding to `None`. `build_observation_node`'s tests above
// (`the_observation_records_all_three_axes_asked_and_ruling`) already proved
// the node SHAPE with `Some(4)`/`Some(25)` — that coverage never exercised
// this call site, which is exactly how the hardcoded `None` shipped green.
// This drives `write_budget_observation` itself, storing a `UsageRecord` the
// way `usage_record_node` (agent crate) actually shapes one and reading the
// `BudgetObservation` back out of the same storage. ─────────────────────────

#[test]
fn write_budget_observation_reads_the_real_step_count_off_the_joined_usage_record() {
    let tmp = std::env::temp_dir().join(format!("tractor-observation-steps-test-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&tmp).expect("create tmp");
    let namespace = std::env::temp_dir()
        .join(format!("tractor-observation-steps-ns-{}.db", uuid::Uuid::new_v4()))
        .to_str()
        .expect("utf8 path")
        .to_owned();
    let state = SidecarState::for_test(&tmp, &namespace).expect("state");

    let effort_id = format!("obs-steps-{}", uuid::Uuid::new_v4());
    let prompt_ref = super::super::prompt_ref_from_effort(&effort_id);

    let storage = crate::storage::NativeStorage::open(&namespace).expect("open storage");
    storage
        .store_node(
            &format!("urn:tractor:usage:{}", uuid::Uuid::new_v4()),
            "UsageRecord",
            None,
            &serde_json::json!({
                "prompt_ref": prompt_ref,
                "provider": "anthropic",
                "model": "claude-sonnet-4-6",
                "tokens_in": 50,
                "tokens_out": 10,
                // Exactly the shape `usage_record_node` stamps in production —
                // top-level, beside rate_table_version. The step pair travels
                // together because one loop counted both; `turns_completed` is
                // the SEPARATE dispatch count that used to masquerade as the
                // numerator here.
                "steps_completed": 4,
                "steps_planned": 25,
                "turns_completed": 1,
            })
            .to_string(),
            Some("agent"),
        )
        .expect("store usage record");

    write_budget_observation(&state, &effort_id, None, None, "timed-out", Some(45_000), &[]);

    let rows = storage.query_nodes("BudgetObservation").expect("query nodes");
    let node = rows
        .iter()
        .find_map(|row| {
            let value: serde_json::Value = serde_json::from_str(&row.payload).ok()?;
            (value.get("effort_id").and_then(|v| v.as_str()) == Some(effort_id.as_str())).then_some(value)
        })
        .expect("a BudgetObservation node for this effort");

    assert_eq!(
        node["refarm.outcome.steps_completed"], 4,
        "the step the run reached must be readable from the record — F1's other missing half"
    );
    assert_eq!(
        node["refarm.outcome.steps_planned"], 25,
        "and the ceiling it was reached against, off the SAME record and the SAME \
         prompt_ref join — not hardcoded `None` on the theory that only an \
         `AgentPlan` could supply it"
    );
    assert_eq!(
        node["refarm.outcome.turns_completed"], 1,
        "the dispatch count still travels, under a name that cannot be read as \
         the numerator of a step fraction"
    );
}

#[test]
fn write_budget_observation_records_the_numerator_without_inventing_a_denominator() {
    // A `UsageRecord` written by an agent that predates `steps_planned` (or by a
    // dispatch whose ceiling could not be established) carries a numerator and
    // nothing else. The honest observation is that numerator plus NO
    // `steps_planned` key — never the `25` that happens to be today's
    // `DEFAULT_TOOL_CALL_MAX_ITER`.
    let tmp = std::env::temp_dir().join(format!("tractor-observation-halfsteps-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&tmp).expect("create tmp");
    let namespace = std::env::temp_dir()
        .join(format!("tractor-observation-halfsteps-ns-{}.db", uuid::Uuid::new_v4()))
        .to_str()
        .expect("utf8 path")
        .to_owned();
    let state = SidecarState::for_test(&tmp, &namespace).expect("state");

    let effort_id = format!("obs-halfsteps-{}", uuid::Uuid::new_v4());
    let prompt_ref = super::super::prompt_ref_from_effort(&effort_id);

    let storage = crate::storage::NativeStorage::open(&namespace).expect("open storage");
    storage
        .store_node(
            &format!("urn:tractor:usage:{}", uuid::Uuid::new_v4()),
            "UsageRecord",
            None,
            &serde_json::json!({
                "prompt_ref": prompt_ref,
                "provider": "anthropic",
                "model": "claude-sonnet-4-6",
                "tokens_in": 50,
                "tokens_out": 10,
                "steps_completed": 4,
            })
            .to_string(),
            Some("agent"),
        )
        .expect("store usage record");

    write_budget_observation(&state, &effort_id, None, None, "timed-out", Some(45_000), &[]);

    let rows = storage.query_nodes("BudgetObservation").expect("query nodes");
    let node = rows
        .iter()
        .find_map(|row| {
            let value: serde_json::Value = serde_json::from_str(&row.payload).ok()?;
            (value.get("effort_id").and_then(|v| v.as_str()) == Some(effort_id.as_str())).then_some(value)
        })
        .expect("a BudgetObservation node for this effort");

    assert_eq!(node["refarm.outcome.steps_completed"], 4);
    assert!(
        node.get("refarm.outcome.steps_planned").is_none(),
        "an unestablished ceiling leaves NO key: a defaulted 25 would read to \
         every later aggregate as a budget somebody actually enforced"
    );
    assert!(
        node.get("refarm.outcome.turns_completed").is_none(),
        "and a record that never carried a turn count does not gain one here"
    );
}

// ── the node-identity wiring: host.name/host.id resolve live from the SAME
// declared base / refarm dir every other fact on this node already uses ────────

#[test]
fn write_budget_observation_records_the_declared_name_and_a_freshly_minted_id() {
    let _env = crate::test_support::env_lock();
    let _sovereign_dir = EnvGuard::set("SOVEREIGN_DIR", ".refarm");

    let node_base = tempfile::tempdir().expect("tempdir");
    let _sovereign_base = EnvGuard::set("SOVEREIGN_BASE", node_base.path().to_str().expect("utf8 path"));
    write_sovereign_config(node_base.path(), r#"{ "node": { "name": "galaxy-a55-5g-desktop" } }"#);

    // `state.refarm_dir` is where the opaque id (`node-id`) is minted and persisted — a
    // fresh tempdir here proves first-boot minting, not a read of a pre-existing file.
    let refarm_dir =
        std::env::temp_dir().join(format!("tractor-observation-identity-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&refarm_dir).expect("create refarm dir");
    let namespace = std::env::temp_dir()
        .join(format!("tractor-observation-identity-ns-{}.db", uuid::Uuid::new_v4()))
        .to_str()
        .expect("utf8 path")
        .to_owned();
    let state = SidecarState::for_test(&refarm_dir, &namespace).expect("state");

    let effort_id = format!("obs-identity-{}", uuid::Uuid::new_v4());
    write_budget_observation(&state, &effort_id, None, None, "failed", None, &[]);

    let storage = crate::storage::NativeStorage::open(&namespace).expect("open storage");
    let rows = storage.query_nodes("BudgetObservation").expect("query nodes");
    let node = rows
        .iter()
        .find_map(|row| {
            let value: serde_json::Value = serde_json::from_str(&row.payload).ok()?;
            (value.get("effort_id").and_then(|v| v.as_str()) == Some(effort_id.as_str())).then_some(value)
        })
        .expect("a BudgetObservation node for this effort");

    assert_eq!(
        node["host.name"], "galaxy-a55-5g-desktop",
        "the declared name in config.json's node.name must ride the record"
    );
    let node_id = node["host.id"].as_str().expect("a minted node id on the record");
    uuid::Uuid::parse_str(node_id).expect("host.id is a valid uuid");

    let persisted = std::fs::read_to_string(crate::node_identity::node_id_path(&refarm_dir))
        .expect("the id was persisted beside the data, not just recorded on this one node");
    assert_eq!(
        persisted.trim(),
        node_id,
        "the id on the record is the one actually persisted to disk, not a second, throwaway mint"
    );
}

#[test]
fn write_budget_observation_omits_steps_completed_when_no_usage_joined() {
    // D6: no UsageRecord ever landed for this effort (e.g. a restart before
    // the agent's turn completed) — absent, never a fabricated zero.
    let tmp = std::env::temp_dir().join(format!("tractor-observation-nosteps-test-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&tmp).expect("create tmp");
    let namespace = std::env::temp_dir()
        .join(format!("tractor-observation-nosteps-ns-{}.db", uuid::Uuid::new_v4()))
        .to_str()
        .expect("utf8 path")
        .to_owned();
    let state = SidecarState::for_test(&tmp, &namespace).expect("state");
    let effort_id = format!("obs-nosteps-{}", uuid::Uuid::new_v4());

    write_budget_observation(&state, &effort_id, None, None, "failed", None, &[]);

    let storage = crate::storage::NativeStorage::open(&namespace).expect("open storage");
    let rows = storage.query_nodes("BudgetObservation").expect("query nodes");
    let node = rows
        .iter()
        .find_map(|row| {
            let value: serde_json::Value = serde_json::from_str(&row.payload).ok()?;
            (value.get("effort_id").and_then(|v| v.as_str()) == Some(effort_id.as_str())).then_some(value)
        })
        .expect("a BudgetObservation node for this effort");

    assert!(
        node.get("refarm.outcome.steps_completed").is_none(),
        "no joined usage means no known step count, not a manufactured zero"
    );
}

// ── WHICH WORK this was: `refarm.scenario.id` / `.hash`, resolved at dispatch
// and read back at finalisation. The pure hashing rules live in
// `sidecar::scenario`'s own unit tests; these prove the WIRING — that a
// declared id survives the whole dispatch→finalisation hand-off, that the
// derived hash is stable across the conditions a run happened to run under, and
// that an effort with no dispatch-time resolution records neither field. ──────

/// Dispatch one effort and read its `BudgetObservation` back out of storage.
/// `SidecarState::for_test` registers no plugin channel, so every effort here
/// finalises `failed` — still terminal, which is all the observation call site
/// needs.
async fn observation_for_dispatched(effort: Effort) -> serde_json::Value {
    let effort_id = effort.id.clone();
    let tmp = std::env::temp_dir().join(format!("tractor-observation-scenario-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&tmp).expect("create tmp");
    let namespace = std::env::temp_dir()
        .join(format!("tractor-observation-scenario-ns-{}.db", uuid::Uuid::new_v4()))
        .to_str()
        .expect("utf8 path")
        .to_owned();
    let state = SidecarState::for_test(&tmp, &namespace).expect("state");

    dispatch_effort(state.clone(), effort);
    tokio::time::sleep(tokio::time::Duration::from_millis(200)).await;

    let storage = crate::storage::NativeStorage::open(&namespace).expect("open storage");
    let rows = storage.query_nodes("BudgetObservation").expect("query nodes");
    rows.iter()
        .find_map(|row| {
            let value: serde_json::Value = serde_json::from_str(&row.payload).ok()?;
            (value.get("effort_id").and_then(|v| v.as_str()) == Some(effort_id.as_str())).then_some(value)
        })
        .expect("a BudgetObservation node for this effort")
}

/// One `vault:extract` dispatch, varying only the CONDITIONS it ran under.
fn scenario_effort(
    scenario_id: Option<&str>,
    workspace_id: Option<&str>,
    budget: Option<crate::sidecar::budget::BudgetDeclaration>,
    args: serde_json::Value,
) -> Effort {
    let effort_id = format!("obs-scenario-{}", uuid::Uuid::new_v4());
    // Shaped exactly as `buildDispatchEffort` shapes a real `refarm dispatch`:
    // `args.replyRef` is the effort's own id, fresh on every submission. It must
    // not reach the hash, or no two dispatches would ever compare.
    let mut args = args;
    if let Some(map) = args.as_object_mut() {
        map.insert("replyRef".to_string(), effort_id.clone().into());
    }
    Effort {
        id: effort_id,
        direction: Some("dispatch".to_string()),
        tasks: vec![EffortTask {
            // A fresh uuid per submission, deliberately: it must not reach the hash.
            id: uuid::Uuid::new_v4().to_string(),
            plugin_id: "vault".to_string(),
            fn_name: Some("extract".to_string()),
            args,
        }],
        source: Some("test".to_string()),
        submitted_at: "2026-01-01T00:00:00.123Z".to_string(),
        budget,
        workspace_id: workspace_id.map(str::to_string),
        workspace_source: None,
        scenario_id: scenario_id.map(str::to_string),
        expectation: None,
    }
}

#[tokio::test]
async fn a_declared_scenario_id_survives_dispatch_and_lands_on_the_observation() {
    let node = observation_for_dispatched(scenario_effort(
        Some("summarise-v1"),
        None,
        None,
        serde_json::json!({ "path": "note.md" }),
    ))
    .await;

    assert_eq!(
        node["refarm.scenario.id"], "summarise-v1",
        "the caller's declaration must reach the record it makes comparable: {node}"
    );
    assert!(
        node.get("refarm.scenario.hash").and_then(|v| v.as_str()).is_some(),
        "the derived hash rides beside the declared id, not instead of it: {node}"
    );
}

#[tokio::test]
async fn an_undeclared_scenario_leaves_the_id_off_the_record_but_still_hashes_the_request() {
    let node = observation_for_dispatched(scenario_effort(
        None,
        None,
        None,
        serde_json::json!({ "path": "note.md" }),
    ))
    .await;

    assert!(
        node.get("refarm.scenario.id").is_none(),
        "nobody declared a scenario, so there is no id — not null, not invented: {node}"
    );
    assert!(
        node.get("refarm.scenario.hash").and_then(|v| v.as_str()).is_some(),
        "undeclared field use is still comparable, which is what the hash is for: {node}"
    );
}

#[tokio::test]
async fn a_declared_expectation_crosses_the_wire_and_reaches_the_record() {
    // The full path, not the pure builder: `Effort.expectation` off the wire →
    // retained input → finalisation → stored node. `SidecarState::for_test`
    // registers no plugin channel, so this effort finalises `failed` with an
    // error and no answer — which is precisely the case that must NOT read as a
    // wrong answer.
    let effort = Effort {
        expectation: Some("  59  ".to_string()),
        ..scenario_effort(None, None, None, serde_json::json!({ "path": "note.md" }))
    };
    let node = observation_for_dispatched(effort).await;

    assert_eq!(
        node["refarm.verification.expected"], "59",
        "the declaration is normalised once and recorded verbatim: {node}"
    );
    assert!(
        node.get("refarm.verification.passed").is_none(),
        "no answer to compare is not a failed comparison: {node}"
    );
    assert_eq!(node["refarm.verification.unknown"], "no-result");
    assert_eq!(
        node["refarm.outcome"], "failed",
        "the terminal status is the terminal status, untouched by any verdict: {node}"
    );
}

#[tokio::test]
async fn an_effort_that_expects_nothing_records_no_verification_keys_at_all() {
    let node =
        observation_for_dispatched(scenario_effort(None, None, None, serde_json::json!({ "path": "note.md" })))
            .await;

    for key in [
        "refarm.verification.expected",
        "refarm.verification.passed",
        "refarm.verification.method",
        "refarm.verification.unknown",
    ] {
        assert!(
            node.get(key).is_none(),
            "{key} must be absent on the ordinary undeclared run: {node}"
        );
    }
}

#[tokio::test]
async fn the_same_request_hashes_the_same_under_a_different_budget_workspace_and_key_order() {
    // The conditions a run ran under are not part of what the work IS. If any of
    // them reached the hash, comparing the same question across two budgets —
    // the entire question this record exists to answer — would file the two runs
    // as two unrelated scenarios.
    let plain = observation_for_dispatched(scenario_effort(
        None,
        None,
        None,
        serde_json::json!({ "path": "note.md", "depth": 2 }),
    ))
    .await;
    let governed = observation_for_dispatched(scenario_effort(
        Some("declared-here-only"),
        Some("rcdc5"),
        Some(crate::sidecar::budget::BudgetDeclaration {
            deadline_ms: Some(300_000),
            ..Default::default()
        }),
        // Same args, written in the other order — the classic JSON key-ordering trap.
        serde_json::json!({ "depth": 2, "path": "note.md" }),
    ))
    .await;

    assert_eq!(
        plain["refarm.scenario.hash"], governed["refarm.scenario.hash"],
        "budget, workspace, scenario id, effort id, task id, args.replyRef and key order are all excluded from the hash"
    );

    let different_work = observation_for_dispatched(scenario_effort(
        None,
        None,
        None,
        serde_json::json!({ "path": "other.md", "depth": 2 }),
    ))
    .await;
    assert_ne!(
        plain["refarm.scenario.hash"], different_work["refarm.scenario.hash"],
        "a different request is a different scenario"
    );
}

#[test]
fn an_effort_with_no_dispatch_time_resolution_records_neither_scenario_field() {
    // The restart-mid-run case the budget stash already handles: this process
    // finalises an effort it never dispatched, so `dispatched_scenarios` holds
    // nothing for it. Both fields are omitted rather than reconstructed — the
    // tasks are gone and the declared id never had another home, so anything
    // written here would be a guess.
    let tmp = std::env::temp_dir().join(format!("tractor-observation-noscenario-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&tmp).expect("create tmp");
    let namespace = std::env::temp_dir()
        .join(format!("tractor-observation-noscenario-ns-{}.db", uuid::Uuid::new_v4()))
        .to_str()
        .expect("utf8 path")
        .to_owned();
    let state = SidecarState::for_test(&tmp, &namespace).expect("state");
    let effort_id = format!("obs-noscenario-{}", uuid::Uuid::new_v4());

    write_budget_observation(&state, &effort_id, None, None, "failed", None, &[]);

    let storage = crate::storage::NativeStorage::open(&namespace).expect("open storage");
    let rows = storage.query_nodes("BudgetObservation").expect("query nodes");
    let node = rows
        .iter()
        .find_map(|row| {
            let value: serde_json::Value = serde_json::from_str(&row.payload).ok()?;
            (value.get("effort_id").and_then(|v| v.as_str()) == Some(effort_id.as_str())).then_some(value)
        })
        .expect("a BudgetObservation node for this effort");

    for key in ["refarm.scenario.id", "refarm.scenario.hash"] {
        assert!(
            node.get(key).is_none(),
            "{key} must be absent when dispatch left no resolution to read back: {node}"
        );
    }
}
