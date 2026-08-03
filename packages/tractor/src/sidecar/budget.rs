//! Nested budget resolution — the Rust port of `@refarm.dev/budget-contract-v1`'s
//! `resolveBudget` / `resolveAxis` fold (`packages/budget-contract-v1/src/resolve.ts`).
//! `BUDGET_CONFORMANCE_CHECKS` there (`src/conformance.ts`) is the authoritative list
//! of seven behaviours; this module's tests (`sidecar/tests/budget.rs`) mirror the
//! same seven against `resolve_budget` rather than inventing new numbers.
//!
//! `resolve_axis` implements *nested policy resolution* — a value resolved outward
//! to inward across node, scope and request, reporting which level bound it. Budget
//! is its first consumer, not its definition: the function and its doc comment stay
//! free of budget-specific language so a later per-workspace policy (auth) can
//! resolve through the same fold instead of copying it.

use serde::Deserialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum BudgetLevel {
    Node,
    Workspace,
    Declared,
    Default,
}

#[derive(Debug, Clone, Copy, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BudgetDeclaration {
    pub deadline_ms: Option<u64>,
    pub max_tokens: Option<u64>,
    /// Thousandths of a dollar. The wire carries `maxUsd` as a decimal; the
    /// deserialiser multiplies by 1000 so all three axes fold in integers.
    #[serde(
        rename = "maxUsd",
        default,
        deserialize_with = "deserialize_max_usd_millis"
    )]
    pub max_usd_millis: Option<u64>,
}

/// Read the wire's `maxUsd` (decimal dollars) and convert to thousandths of a
/// dollar at the deserialisation boundary — the one place the decimal/integer
/// seam is crossed, so every downstream fold stays integer arithmetic.
fn deserialize_max_usd_millis<'de, D>(deserializer: D) -> Result<Option<u64>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let dollars: Option<f64> = Option::deserialize(deserializer)?;
    Ok(dollars.map(|usd| (usd * 1000.0).round() as u64))
}

#[derive(Debug, Clone, Copy)]
pub(crate) struct BudgetTriple {
    pub deadline_ms: u64,
    pub max_tokens: u64,
    pub max_usd_millis: u64,
}

#[derive(Debug, Clone, Copy)]
pub(crate) struct NodeBudget {
    pub ceiling: BudgetTriple,
    pub default: BudgetTriple,
}

/// The node's `max_tokens` / `max_usd_millis` default and ceiling when nothing
/// else declares them. No env var carries these today — only the dispatch
/// deadline is env-tunable (`REFARM_RESPOND_WATCH_TIMEOUT_MS` /
/// `_CEILING_MS`) — so these mirror the sample node section of the spec's
/// `.refarm/config.json` shape, ready for a config-driven override to land on
/// the same numbers.
const NODE_DEFAULT_MAX_TOKENS: u64 = 100_000;
const NODE_DEFAULT_MAX_USD_MILLIS: u64 = 1_000;
const NODE_CEILING_MAX_TOKENS: u64 = 500_000;
const NODE_CEILING_MAX_USD_MILLIS: u64 = 10_000;

impl NodeBudget {
    /// Resolve the node's floor and ceiling, given the deadline default the
    /// sidecar already resolved from env ONCE at boot
    /// (`state.respond_watch.timeout_ms`, via `respond_watch_timeout_ms_from_env`
    /// — see `RespondWatchConfig::from_env`). Threading it in rather than
    /// re-reading env here keeps ONE resolution per boot and preserves the
    /// existing test convention: a test shrinks the deadline by overriding that
    /// state field directly, never by mutating process env (which leaks across
    /// threads under a parallel test run). The deadline ceiling has no such state
    /// field yet, so it is read fresh from its own env var.
    pub(crate) fn from_respond_watch(default_deadline_ms: u64) -> Self {
        Self {
            default: BudgetTriple {
                deadline_ms: default_deadline_ms,
                max_tokens: NODE_DEFAULT_MAX_TOKENS,
                max_usd_millis: NODE_DEFAULT_MAX_USD_MILLIS,
            },
            ceiling: BudgetTriple {
                deadline_ms: respond_watch_ceiling_ms_from_env(),
                max_tokens: NODE_CEILING_MAX_TOKENS,
                max_usd_millis: NODE_CEILING_MAX_USD_MILLIS,
            },
        }
    }

    /// Standalone resolution straight from env — both the default and the
    /// ceiling read fresh. Calls `respond_watch_timeout_ms_from_env` verbatim,
    /// the SAME function `RespondWatchConfig::from_env` calls at boot, so a
    /// freshly-booted node's `NodeBudget` and its `state.respond_watch.timeout_ms`
    /// agree. `dispatch_effort` prefers `from_respond_watch` (above) so a test
    /// overriding the state field is honoured without a second env read.
    #[allow(dead_code)] // symmetry with RespondWatchConfig::from_env; not yet dispatch_effort's path
    pub(crate) fn from_env() -> Self {
        Self::from_respond_watch(super::dispatch::respond_watch_timeout_ms_from_env())
    }
}

/// Parse `REFARM_RESPOND_WATCH_CEILING_MS` from env — the new counterpart to
/// `respond_watch_timeout_ms_from_env`, same absent/zero/unparseable-all-fall-back
/// filter, default 600_000ms (10 minutes).
fn respond_watch_ceiling_ms_from_env() -> u64 {
    std::env::var("REFARM_RESPOND_WATCH_CEILING_MS")
        .ok()
        .and_then(|raw| raw.parse::<u64>().ok())
        .filter(|ms| *ms > 0)
        .unwrap_or(600_000)
}

#[derive(Debug, Clone, Copy, Default)]
pub(crate) struct WorkspaceBudget {
    pub ceiling: Option<BudgetDeclaration>,
    pub default: Option<BudgetDeclaration>,
}

#[derive(Debug, Clone, Copy)]
pub(crate) struct ResolvedAxis {
    pub effective: u64,
    // `declared` and `bound_by` are read by the conformance tests
    // (sidecar/tests/budget.rs) and by a later task's telemetry/enforcement —
    // dispatch_effort itself only consumes `deadline_ms.effective` today.
    #[cfg_attr(not(test), allow(dead_code))]
    pub declared: Option<u64>,
    #[cfg_attr(not(test), allow(dead_code))]
    pub bound_by: BudgetLevel,
}

#[derive(Debug, Clone, Copy)]
pub(crate) struct ResolvedBudget {
    pub deadline_ms: ResolvedAxis,
    // `max_tokens` / `max_usd_millis` are resolved (and test-covered) now so the
    // fold is proven on all three axes; enforcing them is a later task's job —
    // dispatch_effort only reads `deadline_ms` today.
    #[cfg_attr(not(test), allow(dead_code))]
    pub max_tokens: ResolvedAxis,
    #[cfg_attr(not(test), allow(dead_code))]
    pub max_usd_millis: ResolvedAxis,
}

/// One axis, three levels, resolved outward to inward (D9). A workspace ceiling
/// above the node's is clamped rather than obeyed: a workspace cannot grant
/// capacity the machine does not have.
fn resolve_axis(
    declared: Option<u64>,
    workspace_ceiling: Option<u64>,
    workspace_default: Option<u64>,
    node_ceiling: u64,
    node_default: u64,
) -> ResolvedAxis {
    let ceiling = match workspace_ceiling {
        Some(w) => w.min(node_ceiling),
        None => node_ceiling,
    };
    let fallback = workspace_default.unwrap_or(node_default);
    let requested = declared.unwrap_or(fallback);

    if requested <= ceiling {
        return ResolvedAxis {
            effective: requested,
            declared,
            bound_by: if declared.is_some() {
                BudgetLevel::Declared
            } else {
                BudgetLevel::Default
            },
        };
    }

    let cut_by_workspace = matches!(workspace_ceiling, Some(w) if w <= node_ceiling);
    ResolvedAxis {
        effective: ceiling,
        declared,
        bound_by: if cut_by_workspace {
            BudgetLevel::Workspace
        } else {
            BudgetLevel::Node
        },
    }
}

pub(crate) fn resolve_budget(
    declared: Option<&BudgetDeclaration>,
    workspace: Option<&WorkspaceBudget>,
    node: &NodeBudget,
) -> ResolvedBudget {
    let ws_ceiling = workspace.and_then(|w| w.ceiling);
    let ws_default = workspace.and_then(|w| w.default);
    ResolvedBudget {
        deadline_ms: resolve_axis(
            declared.and_then(|d| d.deadline_ms),
            ws_ceiling.and_then(|c| c.deadline_ms),
            ws_default.and_then(|d| d.deadline_ms),
            node.ceiling.deadline_ms,
            node.default.deadline_ms,
        ),
        max_tokens: resolve_axis(
            declared.and_then(|d| d.max_tokens),
            ws_ceiling.and_then(|c| c.max_tokens),
            ws_default.and_then(|d| d.max_tokens),
            node.ceiling.max_tokens,
            node.default.max_tokens,
        ),
        max_usd_millis: resolve_axis(
            declared.and_then(|d| d.max_usd_millis),
            ws_ceiling.and_then(|c| c.max_usd_millis),
            ws_default.and_then(|d| d.max_usd_millis),
            node.ceiling.max_usd_millis,
            node.default.max_usd_millis,
        ),
    }
}
