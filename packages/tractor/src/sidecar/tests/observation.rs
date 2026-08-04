//! `build_observation_node` — the PURE `BudgetObservation` node-shape builder.
//! No storage in the loop: these tests exercise `ObservationInput` →
//! `serde_json::Value` directly, mirroring the field names and behaviours D1,
//! D2 and D6 name in the Task 10 brief. Body-only child of `sidecar::tests`
//! (see the `#[path]` decl in tests.rs).

use super::super::budget::{resolve_budget, BudgetDeclaration, BudgetTriple, NodeBudget};
use super::super::observation::{build_observation_node, ObservationInput};
use super::super::{dispatch_effort, Effort, EffortTask, SidecarState};

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
        spawner: Some("termux"),
        outcome: "timed-out",
        elapsed_ms: Some(45_000),
        steps_completed: Some(4),
        steps_planned: Some(25),
        resolved: Some(resolve_budget(Some(&declared), None, &node)),
        usage: None,
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
    assert_eq!(node["refarm.scenario.id"], serde_json::Value::Null);
}

#[test]
fn an_undeterminable_field_is_omitted_rather_than_zeroed() {
    // D6: absent is not zero. A run with no workspace must not read as
    // workspace "" or 0 once someone aggregates a thousand of these. Same for a
    // run with no plan, where a planned step count does not exist at all.
    let node = build_observation_node(ObservationInput {
        workspace_id: None,
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
        submitted_at: "2026-01-01T00:00:00Z".to_string(),
        // Undeclared on purpose: an undeclared axis falls back to the CONFIG's
        // node default, which is exactly the value this test moves out from
        // under the effort between dispatch and finalisation.
        budget: None,
        workspace_id: None,
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
