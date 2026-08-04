//! `resolve_budget` conformance — mirrors the seven behaviours
//! `BUDGET_CONFORMANCE_CHECKS` names in `packages/budget-contract-v1/src/conformance.ts`,
//! against the Rust port in `sidecar::budget`, with the SAME fixtures and expected
//! values (not invented numbers). Body-only child of `sidecar::tests` (see the
//! `#[path]` decl in tests.rs).

use super::super::budget::{
    node_budget_from_config, resolve_budget, workspace_budget_for, BudgetDeclaration, BudgetLevel,
    BudgetTriple, NodeBudget, WorkspaceBudget,
};

/// Restores `SOVEREIGN_DIR` to whatever it held before a test changed or unset it.
/// `sovereign_config_path` (`crate::host`, re-exported from `config_node`) reads the
/// selector fresh on every call and it is process-global (`std::env::set_var`), so a test
/// proving "no selector ⇒ no path" or "a non-default selector is honoured" must put the
/// value back before any other test in this binary runs — the same shape
/// `host_effects_bridge_tests/connection_host.rs::CwdGuard` uses for `current_dir`, applied
/// here to the OTHER env selector `sovereign_config_path` reads. Local to this file, not
/// shared: this module needs several different values across its tests (default, unset, a
/// non-default name), unlike the sibling test files that only ever need one and so use a
/// simpler set-once-and-leave-it `Once` (their `ensure_sovereign_dir_env`).
struct SovereignDirGuard {
    previous: Option<String>,
}

impl SovereignDirGuard {
    fn set(value: &str) -> Self {
        let previous = std::env::var("SOVEREIGN_DIR").ok();
        std::env::set_var("SOVEREIGN_DIR", value);
        Self { previous }
    }

    fn unset() -> Self {
        let previous = std::env::var("SOVEREIGN_DIR").ok();
        std::env::remove_var("SOVEREIGN_DIR");
        Self { previous }
    }
}

impl Drop for SovereignDirGuard {
    fn drop(&mut self) {
        match &self.previous {
            Some(value) => std::env::set_var("SOVEREIGN_DIR", value),
            None => std::env::remove_var("SOVEREIGN_DIR"),
        }
    }
}

/// A tempdir holding `<dir>/.refarm/config.json` with the given bytes — the layout
/// `sovereign_config_path` actually resolves (`<node_base>/<SOVEREIGN_DIR>/config.json`),
/// NOT `<node_base>/config.json` directly. Callers set `SOVEREIGN_DIR=".refarm"` first
/// (`SovereignDirGuard::set(".refarm")`, under `crate::test_support::env_lock()`) — this
/// helper only writes the file, matching `connection_host.rs`'s
/// `write_connections_config`/`ensure_sovereign_dir_env` split.
fn tempdir_with_config(config_json: &str) -> tempfile::TempDir {
    let dir = tempfile::tempdir().expect("tempdir");
    let sovereign_dir = dir.path().join(".refarm");
    std::fs::create_dir_all(&sovereign_dir).expect("create .refarm dir");
    // "config.json" as a bare literal, matching `connection_host.rs`'s
    // `write_connections_config` — `CONFIG_FILE_NAME` (`config_node`) has no non-test
    // consumer to justify re-exporting it past `sovereign_config_path` itself.
    std::fs::write(sovereign_dir.join("config.json"), config_json).expect("write config.json");
    dir
}

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

// ── D9's workspace level, read from the sovereign config (Task 9) ──────────────────────────

#[test]
fn a_config_with_no_budget_section_changes_nothing() {
    // Backward compatibility is not negotiable: every existing installation has
    // no budget section, and must resolve exactly as it did before this task.
    let _env = crate::test_support::env_lock();
    let _sovereign_dir = SovereignDirGuard::set(".refarm");
    let dir = tempdir_with_config(r#"{ "workspaces": {} }"#);
    assert!(workspace_budget_for(dir.path(), Some("rcdc5")).is_none());
}

#[test]
fn a_workspace_ceiling_is_read_for_that_workspace_only() {
    let _env = crate::test_support::env_lock();
    let _sovereign_dir = SovereignDirGuard::set(".refarm");
    let dir = tempdir_with_config(
        r#"{ "budget": { "workspaces": { "rcdc5": { "ceiling": { "deadlineMs": 300000 } } } } }"#,
    );
    let ws = workspace_budget_for(dir.path(), Some("rcdc5")).expect("declared");
    assert_eq!(ws.ceiling.and_then(|c| c.deadline_ms), Some(300_000));
    assert!(
        workspace_budget_for(dir.path(), Some("other")).is_none(),
        "one workspace's ceiling must not bind another"
    );
    assert!(
        workspace_budget_for(dir.path(), None).is_none(),
        "a dispatch with no workspace has no workspace ceiling"
    );
}

#[test]
fn max_usd_crosses_the_boundary_as_a_decimal_and_lands_as_millis() {
    let _env = crate::test_support::env_lock();
    let _sovereign_dir = SovereignDirGuard::set(".refarm");
    let dir = tempdir_with_config(
        r#"{ "budget": { "workspaces": { "w": { "ceiling": { "maxUsd": 2.5 } } } } }"#,
    );
    let ws = workspace_budget_for(dir.path(), Some("w")).expect("declared");
    assert_eq!(ws.ceiling.and_then(|c| c.max_usd_millis), Some(2_500));
}

// ── proof that this goes through `sovereign_config_path`, not a hand-joined lookalike ──────
//
// A hand-joined `node_base.join(".refarm").join("config.json")` would pass every test above
// too — they all happen to use `.refarm`, this crate's own convention. These two don't:
// one proves the substrate's "unset selector ⇒ no path, never a guess" rule; the other
// proves the join uses whatever `SOVEREIGN_DIR` actually names, not a hardcoded `.refarm`.
// Either a hand join or a hardcoded name would fail one of these two.

#[test]
fn no_sovereign_dir_selector_means_no_sovereign_config_path_not_a_guessed_one() {
    let _env = crate::test_support::env_lock();
    let _sovereign_dir = SovereignDirGuard::unset();
    let dir = tempfile::tempdir().expect("tempdir");
    // Sits exactly where the OLD (round-1) convention would have looked — proof that an
    // unset selector refuses it rather than falling back to finding it anyway.
    std::fs::write(
        dir.path().join("config.json"),
        r#"{ "budget": { "workspaces": { "rcdc5": { "ceiling": { "deadlineMs": 1 } } } } }"#,
    )
    .expect("write config.json");
    assert!(workspace_budget_for(dir.path(), Some("rcdc5")).is_none());
    let fallback = node();
    let resolved = node_budget_from_config(dir.path(), fallback);
    assert_eq!(resolved.default.deadline_ms, fallback.default.deadline_ms);
}

#[test]
fn a_non_default_sovereign_dir_selector_is_honoured_not_a_hardcoded_dot_refarm() {
    let _env = crate::test_support::env_lock();
    let _sovereign_dir = SovereignDirGuard::set("custom-sovereign-dir");
    let dir = tempfile::tempdir().expect("tempdir");
    let custom_dir = dir.path().join("custom-sovereign-dir");
    std::fs::create_dir_all(&custom_dir).expect("create custom sovereign dir");
    std::fs::write(
        custom_dir.join("config.json"),
        r#"{ "budget": { "workspaces": { "rcdc5": { "ceiling": { "deadlineMs": 42 } } } } }"#,
    )
    .expect("write config.json");
    let ws =
        workspace_budget_for(dir.path(), Some("rcdc5")).expect("declared under the custom dir");
    assert_eq!(ws.ceiling.and_then(|c| c.deadline_ms), Some(42));
}

// ── `budget.node` layers over the env-resolved fallback (the OTHER half of the section) ────
//
// Not in the brief's own list, added alongside it: controller resolution #1 is explicit that
// reading only `budget.workspaces` reproduces this task's own defect one level up, so
// `node_budget_from_config` gets the same proof `workspace_budget_for` gets above.

#[test]
fn a_config_with_no_budget_node_leaves_the_fallback_untouched() {
    let _env = crate::test_support::env_lock();
    let _sovereign_dir = SovereignDirGuard::set(".refarm");
    let dir = tempdir_with_config(r#"{ "budget": { "workspaces": {} } }"#);
    let fallback = node();
    let resolved = node_budget_from_config(dir.path(), fallback);
    assert_eq!(resolved.default.deadline_ms, fallback.default.deadline_ms);
    assert_eq!(resolved.ceiling.deadline_ms, fallback.ceiling.deadline_ms);
}

// ── F8: a nonzero declared max_usd that rounds to a $0 ceiling warns, an
// intentional zero does not — the rounding itself never changes ─────────────

type LogBuffer = std::sync::Arc<std::sync::Mutex<Vec<u8>>>;

struct LogSink(LogBuffer);
impl std::io::Write for LogSink {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
        self.0.lock().unwrap().extend_from_slice(buf);
        Ok(buf.len())
    }
    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

/// Capture everything `tracing` emits while `f` runs — same minimal shape as
/// `sidecar::auth`'s own test-only `captured_logs`, kept local rather than
/// shared per this file's own convention (see `SovereignDirGuard`'s doc).
fn captured_logs(f: impl FnOnce()) -> String {
    let buffer: LogBuffer = Default::default();
    let subscriber = tracing_subscriber::fmt()
        .with_max_level(tracing::Level::TRACE)
        .with_ansi(false)
        .with_writer({
            let buffer = buffer.clone();
            move || LogSink(buffer.clone())
        })
        .finish();
    tracing::subscriber::with_default(subscriber, f);
    let bytes = buffer.lock().unwrap().clone();
    String::from_utf8_lossy(&bytes).to_string()
}

#[test]
fn a_nonzero_declared_max_usd_that_rounds_to_zero_millis_is_still_accepted() {
    // 0.0004 * 1000 = 0.4, which rounds DOWN to 0 — still `Some(0)`, exactly
    // like an intentional zero. The rounding itself must not change.
    let declared: BudgetDeclaration =
        serde_json::from_str(r#"{ "maxUsd": 0.0004 }"#).expect("valid declaration");
    assert_eq!(declared.max_usd_millis, Some(0));
}

#[test]
fn an_intentional_zero_max_usd_does_not_warn() {
    let logs = captured_logs(|| {
        let declared: BudgetDeclaration =
            serde_json::from_str(r#"{ "maxUsd": 0 }"#).expect("valid declaration");
        assert_eq!(declared.max_usd_millis, Some(0));
    });
    assert!(
        !logs.contains("rounds to a $0 ceiling"),
        "an operator who typed exactly 0 declared it on purpose — nothing to warn about: {logs}"
    );
}

#[test]
fn a_nonzero_max_usd_that_rounds_to_zero_millis_warns_at_the_surface() {
    let logs = captured_logs(|| {
        let declared: BudgetDeclaration =
            serde_json::from_str(r#"{ "maxUsd": 0.0004 }"#).expect("valid declaration");
        assert_eq!(declared.max_usd_millis, Some(0));
    });
    assert!(
        logs.contains("rounds to a $0 ceiling"),
        "a nonzero declaration that silently becomes a real zero ceiling must warn: {logs}"
    );
}

#[test]
fn a_declared_node_axis_wins_and_an_undeclared_one_keeps_the_fallback() {
    let _env = crate::test_support::env_lock();
    let _sovereign_dir = SovereignDirGuard::set(".refarm");
    let dir = tempdir_with_config(
        r#"{ "budget": { "node": { "default": { "deadlineMs": 12345 }, "ceiling": { "maxTokens": 999999 } } } }"#,
    );
    let fallback = node();
    let resolved = node_budget_from_config(dir.path(), fallback);
    assert_eq!(resolved.default.deadline_ms, 12_345, "declared default axis wins");
    assert_eq!(
        resolved.default.max_tokens, fallback.default.max_tokens,
        "undeclared default axis keeps the fallback"
    );
    assert_eq!(resolved.ceiling.max_tokens, 999_999, "declared ceiling axis wins");
    assert_eq!(
        resolved.ceiling.deadline_ms, fallback.ceiling.deadline_ms,
        "undeclared ceiling axis keeps the fallback"
    );
}
