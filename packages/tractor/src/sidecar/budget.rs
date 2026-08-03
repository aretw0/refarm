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

use std::collections::HashMap;
use std::path::Path;

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
/// else declares them — including when `budget.node` is absent from config
/// (`node_budget_from_config` below layers a declared value over these; it never
/// replaces them wholesale). No env var carries these directly — only the
/// dispatch deadline is env-tunable (`REFARM_RESPOND_WATCH_TIMEOUT_MS` /
/// `_CEILING_MS`) — so these mirror the sample node section of the spec's
/// `.refarm/config.json` shape.
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

#[derive(Debug, Clone, Copy, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WorkspaceBudget {
    #[serde(default)]
    pub ceiling: Option<BudgetDeclaration>,
    #[serde(default)]
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

// ── the sovereign config's `budget` section — D9's middle level, made reachable ──────────
//
// `resolve_budget` has folded a workspace ceiling since it was written; nothing ever read
// one off disk to hand it in. This is that read: the top-level `budget` section of the
// sovereign config, resolved from `node_base` — the SAME "base" `declared_base()` returns —
// through `read_refarm_config_value_at` (`crate::host`, re-exported from
// `host_effects_bridge` for this reason), the ONE hardened reader `spawn_env.rs`,
// `surfaces_decl.rs` and `connection_decl.rs` already use for this exact file: size cap,
// symlink/regular-file check, dev+ino TOCTOU guard. A budget section read with anything
// weaker would be the one sovereign-config read on this node that trusts what the others
// refuse to — so this is a consumer of that reader, not a second one.
//
// Every key optional, and every failure mode — no selector, no file, unreadable bytes,
// invalid JSON (the hardened reader's `Err`, mapped to `None` at this boundary), no
// `budget` key, a `budget` value that doesn't parse into this shape, no entry for the
// workspace asked about — resolves to `None`/the fallback rather than stopping a dispatch.
// A malformed config is a different problem with a different owner (see the module-level
// rule this mirrors for the fold itself).

/// The top-level `budget` section, deserialised straight off the wire shape the maintainer
/// settled: `{ "node": { "default": {...}, "ceiling": {...} }, "workspaces": { "<id>": {
/// "ceiling": {...}, "default": {...} } } }`. Both halves are read here — `node` as well as
/// `workspaces` — so a config that declares `budget.node` is never declared-and-ignored,
/// which is the exact defect this task exists to close, one level up.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BudgetSection {
    #[serde(default)]
    node: Option<NodeBudgetSection>,
    #[serde(default)]
    workspaces: HashMap<String, WorkspaceBudget>,
}

/// `budget.node` — each half optional, exactly like a workspace's. Absent entirely, or with
/// either half absent, is not an error: `node_budget_from_config` layers whatever IS declared
/// over the env-resolved fallback rather than requiring the whole shape.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct NodeBudgetSection {
    #[serde(default)]
    default: Option<BudgetDeclaration>,
    #[serde(default)]
    ceiling: Option<BudgetDeclaration>,
}

/// Resolve the sovereign config's `budget` section from `node_base` — the base
/// `declared_base()` returns, read through the crate's one hardened sovereign-config
/// reader (see the section doc above). `None` for any reason at all: no sovereign config
/// path, no file, or the hardened reader's `Err` (oversized, not a regular file, fails its
/// TOCTOU check, or isn't valid JSON) — logged and swallowed here, exactly as absence is,
/// because a malformed config must fail shut into "no budget declared", never into a
/// stopped dispatch. No caching, no state: called once per dispatch, which is what lets a
/// config edit take effect on the very next effort without a restart, the same immediacy
/// `sidecar::auth`'s policy watcher gives the credential gate.
fn read_budget_section(node_base: &Path) -> Option<BudgetSection> {
    let config = crate::host::read_refarm_config_value_at(node_base)
        .inspect_err(|error| {
            tracing::warn!(%error, "sidecar: sovereign config unreadable for budget — treating as absent");
        })
        .ok()??;
    let budget = config.get("budget")?;
    serde_json::from_value(budget.clone()).ok()
}

/// The declared ceiling/default for ONE workspace, or `None` when there is nothing to
/// declare it: no workspace id on the effort (`workspace_id`), no sovereign config path
/// (`SOVEREIGN_DIR` unset), no config file, no `budget` section, or no entry under this
/// workspace's id. A workspace's ceiling never binds another's — `resolve_budget`'s caller
/// passes exactly the entry keyed to the effort's own `workspace_id`, nothing broader.
///
/// `node_base`, not `refarm_dir`: this is `declared_base()`'s BASE (the directory that
/// CONTAINS the sovereign dir), the value `dispatch_effort` passes at its call site —
/// taken as a parameter, rather than resolved internally, so this stays directly testable
/// against a tempdir without touching env or cwd for the base half of the resolution.
pub(crate) fn workspace_budget_for(
    node_base: &Path,
    workspace_id: Option<&str>,
) -> Option<WorkspaceBudget> {
    let workspace_id = workspace_id?;
    let section = read_budget_section(node_base)?;
    section.workspaces.get(workspace_id).copied()
}

/// Layer `budget.node` over the env-resolved `fallback` — config wins where it declares a
/// value, `fallback` (already `NodeBudget::from_respond_watch`'d by the caller) fills the
/// rest. An installation with no sovereign config path, no `budget` section, or no
/// `budget.node`, gets back `fallback` untouched: byte-identical to today's behaviour.
///
/// `node_base` — see `workspace_budget_for`'s doc for why this is the base, not the
/// `.refarm` dir itself, and why it's a parameter rather than resolved internally.
pub(crate) fn node_budget_from_config(node_base: &Path, fallback: NodeBudget) -> NodeBudget {
    let Some(node) = read_budget_section(node_base).and_then(|section| section.node) else {
        return fallback;
    };
    NodeBudget {
        default: layer_triple_over(fallback.default, node.default),
        ceiling: layer_triple_over(fallback.ceiling, node.ceiling),
    }
}

/// One `BudgetTriple`, axis by axis: a declared axis wins, an undeclared one keeps the
/// fallback's value. Mirrors `resolve_axis`'s "declared wins, fallback fills" shape one level
/// up — this layers CONFIG over ENV, `resolve_axis` layers a DECLARATION over a CEILING/DEFAULT.
fn layer_triple_over(fallback: BudgetTriple, declared: Option<BudgetDeclaration>) -> BudgetTriple {
    let Some(declared) = declared else {
        return fallback;
    };
    BudgetTriple {
        deadline_ms: declared.deadline_ms.unwrap_or(fallback.deadline_ms),
        max_tokens: declared.max_tokens.unwrap_or(fallback.max_tokens),
        max_usd_millis: declared.max_usd_millis.unwrap_or(fallback.max_usd_millis),
    }
}
