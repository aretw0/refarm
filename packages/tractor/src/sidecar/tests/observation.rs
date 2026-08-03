//! `build_observation_node` — the PURE `BudgetObservation` node-shape builder.
//! No storage in the loop: these tests exercise `ObservationInput` →
//! `serde_json::Value` directly, mirroring the field names and behaviours D1,
//! D2 and D6 name in the Task 10 brief. Body-only child of `sidecar::tests`
//! (see the `#[path]` decl in tests.rs).

use super::super::budget::{resolve_budget, BudgetDeclaration, BudgetTriple, NodeBudget};
use super::super::observation::{build_observation_node, ObservationInput};

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
        elapsed_ms: 45_000,
        steps_completed: Some(4),
        steps_planned: Some(25),
        resolved: resolve_budget(Some(&declared), None, &node),
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

    let api = build_observation_node(ObservationInput {
        usage: Some(serde_json::json!({ "usage": { "pricing_mode": "api" } })),
        ..base_input()
    });
    assert_eq!(api["refarm.budget.max_usd.enforced"], true);

    // Unknown pricing mode is absent, never a default true (D6).
    let unknown = build_observation_node(base_input());
    assert!(unknown.get("refarm.budget.max_usd.enforced").is_none());
}
