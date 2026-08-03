//! `resolve_budget` conformance — mirrors the seven behaviours
//! `BUDGET_CONFORMANCE_CHECKS` names in `packages/budget-contract-v1/src/conformance.ts`,
//! against the Rust port in `sidecar::budget`, with the SAME fixtures and expected
//! values (not invented numbers). Body-only child of `sidecar::tests` (see the
//! `#[path]` decl in tests.rs).

use super::super::budget::{
    resolve_budget, BudgetDeclaration, BudgetLevel, BudgetTriple, NodeBudget, WorkspaceBudget,
};

// The same node fixture the TS conformance list and its resolve.test.ts use,
// kept in lockstep so a check here and its behaviour there never drift apart
// silently.
fn node() -> NodeBudget {
    NodeBudget {
        ceiling: BudgetTriple {
            deadline_ms: 600_000,
            max_tokens: 500_000,
            max_usd_millis: 10_000,
        },
        default: BudgetTriple {
            deadline_ms: 45_000,
            max_tokens: 100_000,
            max_usd_millis: 1_000,
        },
    }
}

#[test]
fn declared_deadline_below_the_ceiling_is_honoured() {
    let node = NodeBudget {
        ceiling: BudgetTriple {
            deadline_ms: 600_000,
            max_tokens: 500_000,
            max_usd_millis: 10_000,
        },
        default: BudgetTriple {
            deadline_ms: 45_000,
            max_tokens: 100_000,
            max_usd_millis: 1_000,
        },
    };
    let declared = BudgetDeclaration {
        deadline_ms: Some(300_000),
        ..Default::default()
    };
    let resolved = resolve_budget(Some(&declared), None, &node);
    assert_eq!(resolved.deadline_ms.effective, 300_000);
    assert_eq!(resolved.deadline_ms.bound_by, BudgetLevel::Declared);
}

#[test]
fn a_workspace_cannot_grant_what_the_node_cannot_serve() {
    let node = NodeBudget {
        ceiling: BudgetTriple {
            deadline_ms: 600_000,
            max_tokens: 500_000,
            max_usd_millis: 10_000,
        },
        default: BudgetTriple {
            deadline_ms: 45_000,
            max_tokens: 100_000,
            max_usd_millis: 1_000,
        },
    };
    let workspace = WorkspaceBudget {
        ceiling: Some(BudgetDeclaration {
            deadline_ms: Some(9_000_000),
            ..Default::default()
        }),
        default: None,
    };
    let declared = BudgetDeclaration {
        deadline_ms: Some(9_000_000),
        ..Default::default()
    };
    let resolved = resolve_budget(Some(&declared), Some(&workspace), &node);
    assert_eq!(resolved.deadline_ms.effective, 600_000);
    assert_eq!(resolved.deadline_ms.bound_by, BudgetLevel::Node);
}

#[test]
fn uses_the_node_default_when_nobody_declares_anything() {
    let resolved = resolve_budget(None, None, &node());
    assert_eq!(resolved.deadline_ms.effective, 45_000);
    assert_eq!(resolved.deadline_ms.declared, None);
    assert_eq!(resolved.deadline_ms.bound_by, BudgetLevel::Default);
}

#[test]
fn clamps_to_the_node_ceiling_and_says_the_node_did_it() {
    let declared = BudgetDeclaration {
        deadline_ms: Some(9_000_000),
        ..Default::default()
    };
    let resolved = resolve_budget(Some(&declared), None, &node());
    assert_eq!(resolved.deadline_ms.effective, 600_000);
    assert_eq!(resolved.deadline_ms.declared, Some(9_000_000));
    assert_eq!(resolved.deadline_ms.bound_by, BudgetLevel::Node);
}

#[test]
fn clamps_to_a_tighter_workspace_ceiling_and_says_the_workspace_did_it() {
    let workspace = WorkspaceBudget {
        ceiling: Some(BudgetDeclaration {
            deadline_ms: Some(120_000),
            ..Default::default()
        }),
        default: None,
    };
    let declared = BudgetDeclaration {
        deadline_ms: Some(300_000),
        ..Default::default()
    };
    let resolved = resolve_budget(Some(&declared), Some(&workspace), &node());
    assert_eq!(resolved.deadline_ms.effective, 120_000);
    assert_eq!(resolved.deadline_ms.declared, Some(300_000));
    assert_eq!(resolved.deadline_ms.bound_by, BudgetLevel::Workspace);
}

#[test]
fn prefers_a_workspace_default_over_the_node_default() {
    let workspace = WorkspaceBudget {
        ceiling: None,
        default: Some(BudgetDeclaration {
            deadline_ms: Some(90_000),
            ..Default::default()
        }),
    };
    let resolved = resolve_budget(None, Some(&workspace), &node());
    assert_eq!(resolved.deadline_ms.effective, 90_000);
    assert_eq!(resolved.deadline_ms.declared, None);
    assert_eq!(resolved.deadline_ms.bound_by, BudgetLevel::Default);
}

#[test]
fn resolves_each_axis_independently() {
    let declared = BudgetDeclaration {
        deadline_ms: Some(9_000_000),
        max_tokens: Some(1_000),
        ..Default::default()
    };
    let resolved = resolve_budget(Some(&declared), None, &node());
    assert_eq!(resolved.max_tokens.effective, 1_000);
    assert_eq!(resolved.max_tokens.declared, Some(1_000));
    assert_eq!(resolved.max_tokens.bound_by, BudgetLevel::Declared);
}
