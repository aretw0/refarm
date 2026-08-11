/// Resolves the active provider name with full user control:
///   MODEL_PROVIDER          — explicit choice for this run
///   MODEL_DEFAULT_PROVIDER  — user's personal sovereign default (fallback when MODEL_PROVIDER unset)
///   hardcoded "ollama"      — the keyless local floor; matches the host ModelRoute
///                             env-unset default (wasi_bridge/core.rs). base_url still
///                             honors MODEL_BASE_URL first (provider.rs), falling through
///                             to http://localhost:11434 only when unset — exactly as the
///                             host resolves it — so a zero-config run agrees end-to-end
///                             instead of tagging the request a provider the host rejects.
pub(crate) fn provider_name_from_env() -> String {
    std::env::var("MODEL_PROVIDER")
        .or_else(|_| std::env::var("MODEL_DEFAULT_PROVIDER"))
        .unwrap_or_else(|_| "ollama".into())
}

/// Prefer an in-scope route override over the ambient env default — the SAME
/// precedence the completion path itself already applies (`wasm_flow.rs`'s
/// `explicit_provider` beats env/profile; `react_loop.rs`'s own post-completion
/// `provider_name` already reads it this way). `prompt_handler.rs`'s
/// `execute_prompt_with_route` used to re-derive the provider from env
/// UNCONDITIONALLY, even when `provider_override` was in scope and had picked
/// a DIFFERENT provider for the actual completion (F3, whole-branch review):
/// the record this value feeds — `pricing_mode`, `estimated_usd`, and the
/// `provider` label itself, via `store_usage_record` — silently disagreed with
/// the provider that served the run. "Descriptive telemetry label" was the
/// ruling that parked this; a later task made the value DECIDE
/// (`pricing_mode`/`estimated_usd`), which is the case that ruling itself
/// names as unacceptable.
pub(crate) fn resolved_provider_name(provider_override: Option<&str>) -> String {
    provider_override
        .map(str::to_owned)
        .unwrap_or_else(provider_name_from_env)
}

/// Sum `estimated_usd` from UsageRecord JSON payloads for `provider`
/// within a rolling window ending at `now_ns`. Records older than the window are excluded.
pub(crate) fn sum_provider_spend_usd(
    records: &[String],
    provider: &str,
    now_ns: u64,
    window_ns: u64,
) -> f64 {
    let cutoff = now_ns.saturating_sub(window_ns);
    records.iter().fold(0.0_f64, |acc, raw| {
        let Ok(v) = serde_json::from_str::<serde_json::Value>(raw) else {
            return acc;
        };
        if v["provider"].as_str() != Some(provider) {
            return acc;
        }
        let ts = v["timestamp_ns"].as_u64().unwrap_or(0);
        if ts < cutoff {
            return acc;
        }
        acc + v["estimated_usd"].as_f64().unwrap_or(0.0)
    })
}

/// Why the budget guard could not establish the true 30-day spend total.
///
/// ROUND 2 removed the other reason this enum used to carry (`Truncated`): see
/// `resolve_budget_check` below, a truncated `query-nodes` page on the FIRST
/// read is no longer a reason to be unknown at all — it either proves "over" by
/// arithmetic on the visible rows, or triggers a follow-up read for the
/// complete set. A variant that can never be constructed is worse than no
/// variant: it looks live and isn't, so it was removed rather than kept and
/// marked dead. That left `QueryError` as the only reason for a while — until
/// ROUND 4 found the follow-up read itself can come back truncated (more rows
/// arrived between the two reads, a race — see `resolve_budget_check`'s doc),
/// which is a genuinely new failure mode the earlier round's comment predicted
/// would need its own reason rather than being folded into `QueryError`'s
/// meaning. `RequeryTruncated` is that reason. The type stays an enum (not a
/// bool or a unit struct) because it names WHY.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum BudgetUnknownReason {
    /// A `query-nodes` call returned `Err` (host/storage failure) — either the
    /// FIRST read, or the follow-up read `resolve_budget_check` issues when the
    /// first read was truncated and still under budget (see below). Zero rows
    /// were SEEN, not "zero rows exist", so summing an empty set here would be
    /// reading a failure as evidence of no spend.
    QueryError,
    /// The follow-up read (`requery_all(stored)`) came back truncated ITSELF —
    /// `stored` rows were asked for, but more than `stored` now exist, so the
    /// guard still did not see the complete set. This happens when rows are
    /// written to the store between the first read (which reported `stored`)
    /// and the follow-up (which asked for exactly that many). Only reached when
    /// the follow-up's own visible sum is still UNDER budget — an over-budget
    /// sum is `Known` by the same lower-bound arithmetic `resolve_budget_check`
    /// applies to the first read, regardless of truncation.
    RequeryTruncated,
}

impl BudgetUnknownReason {
    /// Stable string for telemetry payloads — see `wasm_ops::budget_exceeded_for_provider`.
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            BudgetUnknownReason::QueryError => "query_error",
            BudgetUnknownReason::RequeryTruncated => "requery_truncated",
        }
    }
}

/// The outcome of trying to establish a provider's rolling spend against its budget.
///
/// `Unknown` is a structurally separate variant from `Known` — not a bool plus a
/// log line — so a caller (and a test) can tell "the guard does not know" from
/// "the guard checked and it is fine". As of round 2, `Unknown` is the rare case:
/// `Known` is reached even from a truncated read, either by an arithmetic lower
/// bound that already clears the budget or by a complete follow-up read — see
/// `resolve_budget_check`.
#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) enum BudgetCheck {
    /// A definite answer: `spend_usd` is either the true rolling-window sum (a
    /// complete or completed-by-follow-up read) or a lower bound on it that
    /// already meets `budget_usd` on its own — both are `Known` because neither
    /// needs more data to be trusted for the comparison against `budget_usd`.
    Known { spend_usd: f64, budget_usd: f64 },
    /// The total could not be established; carries why (see `BudgetUnknownReason`).
    Unknown(BudgetUnknownReason),
}

/// Build the `BudgetCheck` for `provider` against `budget_usd`, resolving
/// truncation on the first read (round 2), a non-positive budget (round 3),
/// and a follow-up read that is itself truncated (round 4) into a definite
/// answer wherever the data supports one, instead of reporting `Unknown`.
///
/// `query_first` and `requery_all` are closures rather than eagerly-computed
/// values for two reasons: it keeps this natively testable (the wasm caller
/// passes real `tractor_bridge::query_nodes` calls; a test passes a fixture, an
/// `Err(())`, or a stub that panics if invoked), AND it lets a proof that needs
/// no data at all return without ever calling either — see case 0.
///
///   0. ZERO-OR-NEGATIVE BUDGET, checked FIRST, before any query. A budget of
///      `<= 0.0` means "spend nothing", and every real `estimated_usd` is
///      non-negative — so `0.0 >= budget_usd` holds for ANY provider, whatever it
///      has spent, without reading a single `UsageRecord`. `Known { spend_usd:
///      0.0, budget_usd }` is returned immediately; neither `query_first` nor
///      `requery_all` is ever called. Same move as case 1 below — a bound
///      provable without complete data is not uncertainty — applied to an even
///      smaller amount of data (none). Restores the
///      `MODEL_BUDGET_<PROVIDER>_USD=0` hard stop the pre-Task-3 code produced as
///      an ACCIDENT of an empty sum meeting a zero budget (see the HISTORY note
///      on `budget_exceeded`) — deliberately this time, and closes the one path
///      round 2 had left open (see that HISTORY note too).
///
/// For a positive budget, `query_first()` runs: `Err(())` when the query failed
/// outright, or `Ok((nodes, truncated, stored))` — the page's rows, the
/// `node-page` record's `truncated` flag, and `stored` (the true row count as of
/// this read, independent of the query's `limit`; see
/// `packages/plugin-wit/wit/host.wit`). Every `UsageRecord.estimated_usd` is
/// non-negative, so a SUBSET's sum is always a valid LOWER BOUND on the true
/// total. Two more consequences, in order:
///
///   1. If the (possibly partial) visible sum ALREADY meets or exceeds
///      `budget_usd`, the true total does too — no further data can change that
///      answer, so it is `Known`, not `Unknown`, even when `truncated` is `true`.
///      This is arithmetic, not extra strictness, and it is exactly the block the
///      pre-Task-3 code used to perform on a truncated-but-over page (see the
///      history note on `budget_exceeded`) — round 2 restored it on purpose.
///   2. Only when the visible sum is UNDER budget does truncation matter: the
///      missing rows could be anything, so nothing can be concluded from a
///      partial sum alone. Rather than report `Unknown`, ask again —
///      `requery_all(stored)` asks for the complete set the first read's own
///      `stored` count said exists. That follow-up can come back truncated
///      ITSELF (round 4 — see the race paragraph below): its own `truncated`
///      flag is checked the same way as case 1 — an already-over visible sum
///      is still `Known` by the same lower-bound arithmetic, regardless of
///      truncation — and only a follow-up that is BOTH truncated AND still
///      under budget is reported `Unknown(RequeryTruncated)`. A `Known` is
///      never built from a read this function knows is incomplete.
///
/// A record written to the store between the two reads is a real, BOUNDED race
/// — but the direction that matters is the opposite of what it might look like
/// at a glance. `requery_all(stored)` asks for `stored` rows from a store that
/// returns the NEWEST N rows for a given limit (`storage::sqlite::query_nodes_limited`
/// takes the newest N, not the oldest), so a record written in the narrow
/// window between the two reads IS among the newest rows and so IS included in
/// the follow-up's `nodes` — new writes do not go missing. What falls off the
/// end instead are OLDER rows that were within the top `stored` at the first
/// read but got pushed past that cut by the new arrivals by the time of the
/// second — and those older rows can still be inside the 30-day window this
/// guard sums over. That is precisely what the follow-up's own `truncated`
/// flag reports when it fires: the true row count grew past `stored` between
/// the two reads, so the follow-up page is itself incomplete, and its visible
/// sum is missing older, still-in-window spend — a systematic UNDERCOUNT, not
/// a rounding error. Reporting that as `Known` would let the guard answer
/// "under budget" on an undercounted sum — this function's own founding
/// failure mode, in miniature — so case 2 above reports `Unknown
/// (RequeryTruncated)` instead unless the partial sum already proves "over".
/// Only an outright `Err` from either read lands in `Unknown(QueryError)`.
///
/// COST, stated honestly rather than left implicit:
///   - `requery_all` loads every `UsageRecord` of this provider into guest memory
///     when it fires (truncated AND still under budget). Fine at today's
///     volumes; a provider whose full history is both very large and genuinely
///     under budget would eventually want host-side summing instead of a
///     guest-side full fetch. That is a follow-up, not this function.
///   - `requery_all` is called AT MOST ONCE. A follow-up that is itself
///     truncated-and-under-budget is reported `Unknown(RequeryTruncated)`
///     rather than chased with a third read — an unbounded retry loop under
///     sustained concurrent writes is worse than a rare, LOUD `Unknown` (see
///     `budget_exceeded`'s FAIL OPEN BUT LOUD policy). A caller that wants the
///     guard to keep trying can call `budget_exceeded_for_provider` again.
///   - OPERATIONAL FINDING (record, not fixed here): `query-nodes` filters by
///     node TYPE only, not by provider (`packages/plugin-wit/wit/host.wit`), so
///     `truncated` is driven by the SYSTEM-WIDE `UsageRecord` count across every
///     provider, not this one provider's history — and `UsageRecord` is never
///     pruned (`node_reap.rs` reaps other node types, not this one). So once
///     total stored `UsageRecord` rows cross the 10,000-row query limit for ANY
///     provider, the truncated branch above stops being a rare edge: it fires on
///     EVERY call this guard makes from then on, and `budget_exceeded_for_provider`
///     runs on every primary AND fallback completion
///     (`runtime/wasm_flow.rs`). Past that point the full re-query becomes a
///     PERMANENT per-call cost on the hot path, and per-request latency grows
///     roughly linearly with total stored `UsageRecord` rows — well before guest
///     memory becomes the binding constraint. Two ways out, neither chosen here:
///     sum on the host side instead of fetching every row into the guest, or
///     make the query filterable by provider so truncation tracks one
///     provider's history instead of the system's. Both are follow-ups.
pub(crate) fn resolve_budget_check<Q, F>(
    provider: &str,
    budget_usd: f64,
    now_ns: u64,
    window_ns: u64,
    query_first: Q,
    requery_all: F,
) -> BudgetCheck
where
    Q: FnOnce() -> Result<(Vec<String>, bool, u32), ()>,
    F: FnOnce(u32) -> Result<(Vec<String>, bool), ()>,
{
    if budget_usd <= 0.0 {
        // ARITHMETIC PROOF #2 (see case 0 above): decided before either closure
        // is ever invoked.
        return BudgetCheck::Known { spend_usd: 0.0, budget_usd };
    }

    let (nodes, truncated, stored) = match query_first() {
        Err(()) => return BudgetCheck::Unknown(BudgetUnknownReason::QueryError),
        Ok(triplet) => triplet,
    };

    let visible_spend_usd = sum_provider_spend_usd(&nodes, provider, now_ns, window_ns);

    if !truncated {
        // A complete read: the visible sum IS the total.
        return BudgetCheck::Known { spend_usd: visible_spend_usd, budget_usd };
    }
    if visible_spend_usd >= budget_usd {
        // Lower bound alone already crosses the ceiling — arithmetic proof, no
        // re-query needed or performed.
        return BudgetCheck::Known { spend_usd: visible_spend_usd, budget_usd };
    }

    // Under budget on a partial view proves nothing about the total — ask again.
    match requery_all(stored) {
        Err(()) => BudgetCheck::Unknown(BudgetUnknownReason::QueryError),
        Ok((all_nodes, requery_truncated)) => {
            let full_spend_usd = sum_provider_spend_usd(&all_nodes, provider, now_ns, window_ns);
            if full_spend_usd >= budget_usd {
                // Same arithmetic proof as case 1, reapplied to the follow-up's
                // own visible sum: a lower bound that already crosses the
                // ceiling is `Known` regardless of whether THIS read is complete.
                return BudgetCheck::Known { spend_usd: full_spend_usd, budget_usd };
            }
            if requery_truncated {
                // The follow-up itself did not see the complete set (rows were
                // written between the two reads — see the race paragraph above):
                // its under-budget sum is a systematic undercount, not a total.
                // Do not build `Known` from a read this function knows is
                // incomplete — no further requery is issued (see COST below).
                return BudgetCheck::Unknown(BudgetUnknownReason::RequeryTruncated);
            }
            BudgetCheck::Known { spend_usd: full_spend_usd, budget_usd }
        }
    }
}

/// THE POLICY DECISION, and the one place `Unknown` is mapped to a proceed/block
/// answer: **FAIL OPEN BUT LOUD**. `Known` compares spend to budget normally.
/// `Unknown` returns `false` (not blocked) — and as of round 4, `Unknown`
/// happens either when a `query-nodes` call fails outright under a POSITIVE
/// budget, or when the follow-up read is itself truncated and still under
/// budget (see `resolve_budget_check`); an untruncated read, an already-over
/// visible sum at either read, and a zero-or-negative budget are all always
/// resolved to `Known` first, by arithmetic proof or by a follow-up read that
/// turns out to be complete.
///
/// HISTORY — corrected four times now; read this before touching the claim
/// again:
///   - The FIRST cut of this guard (before `BudgetCheck` existed) summed whatever
///     page it got, ignoring `truncated` entirely. A truncated-but-over-budget
///     page STILL blocked (undercounting the true total, but enforcing on what it
///     could see); a query error defaulted to an empty sum and only blocked when
///     `budget_usd <= 0.0` (the `MODEL_BUDGET_<PROVIDER>_USD=0` hard-stop case) —
///     an ACCIDENT of `0.0 >= 0.0`, not a deliberate check.
///   - ROUND 1 modelled `Unknown` but mapped BOTH truncated and query-error to
///     `Unknown` -> proceed, unconditionally, and its doc comment wrongly claimed
///     that was behaviour-preserving. It was a real loosening on two fronts: a
///     truncated-but-over-budget page stopped blocking, and the
///     `budget_usd <= 0.0` hard stop stopped firing on a query error.
///   - ROUND 2 closed the FIRST front — see `resolve_budget_check` cases 1-2 —
///     but its doc comment claimed "no block the operator had is lost" while the
///     SECOND front (the zero-budget hard stop on a query error) was still open.
///     That claim was false when written — the same mistake round 1 made,
///     recurring in a new spot instead of being fully closed.
///   - ROUND 3 (this version) closes the second front — see case 0 in
///     `resolve_budget_check`. A `budget_usd <= 0.0` is now decided before
///     `query_first` ever runs, so a query error can no longer race a zero
///     budget's hard stop out of existence. With BOTH fronts closed, "no block
///     the operator had is lost" is finally true: the pre-Task-3
///     truncated-but-over block and the pre-Task-3 zero-budget hard stop are
///     both reproduced here by PROOF rather than by accident, and the only
///     `Unknown` left was a `query-nodes` call that genuinely failed under a
///     budget that needed real data to evaluate.
///   - ROUND 4 found a signal round 2 introduced and then dropped one line
///     later: `requery_all`'s result carried its OWN `truncated` flag (the
///     `node-page` record has one, same as the first read), but the follow-up
///     was mapped straight to `Known` without ever looking at it — a re-query
///     that raced fresh writes and came back truncated itself was reported
///     `Known` from an undercounted sum anyway, which is this guard's own
///     founding failure mode ("under budget" from data that was not the whole
///     total). `resolve_budget_check` now threads that second `truncated`
///     through: `Known` only when the follow-up is complete OR its partial sum
///     already proves "over"; otherwise `Unknown(RequeryTruncated)`, a second,
///     narrower reason alongside `QueryError`.
///
/// This mapping IS the policy, chosen deliberately over the alternatives the task
/// considered:
///   - Fail CLOSED (`Unknown` -> over-budget) protects the wallet, but can block a
///     run the operator would have allowed on nothing more than a transient
///     storage hiccup — a false positive with no mid-run escape hatch, decided on
///     the operator's behalf without his say-so. (A large `UsageRecord` history is
///     no longer a reason to fail closed at all — round 2 resolves it instead of
///     needing to choose a side on it.)
///   - A third state in the RETURN TYPE (push the decision to the caller) may be
///     right if the caller has context this function lacks — but today's callers
///     (`run_primary_completion` / `try_fallback_completion` in `runtime/wasm_flow.rs`)
///     have nothing beyond the provider name; they would just re-collapse `Unknown`
///     to a bool one frame later, with strictly less information than this function
///     has right here.
/// "LOUD" is what makes leaving a genuine `Unknown` open safe rather than silent —
/// the wasm boundary (`wasm_ops::budget_exceeded_for_provider`) emits
/// `agent:budget:unknown` naming the reason whenever this function is fed an
/// `Unknown` check, so a query failure is visible on the record instead of
/// indistinguishable from "all clear".
pub(crate) fn budget_exceeded(check: &BudgetCheck) -> bool {
    match check {
        BudgetCheck::Known { spend_usd, budget_usd } => spend_usd >= budget_usd,
        BudgetCheck::Unknown(_) => false,
    }
}

/// Build conversation messages from raw UserPrompt + AgentResponse JSON payloads.
/// Sorted by timestamp_ns ascending; capped at `max_turns` most recent entries.
/// Returns (role, content) pairs ready to pass to Provider::complete.
pub(crate) fn history_from_nodes(nodes: &[String], max_turns: usize) -> Vec<(String, String)> {
    let mut entries: Vec<(u64, &'static str, String)> = nodes
        .iter()
        .filter_map(|raw| {
            let v = serde_json::from_str::<serde_json::Value>(raw).ok()?;
            let ts = v["timestamp_ns"].as_u64().unwrap_or(0);
            let role = match v["@type"].as_str()? {
                "UserPrompt" => "user",
                "Response" => "assistant",
                _ => return None,
            };
            let content = v["content"].as_str()?.to_owned();
            Some((ts, role, content))
        })
        .collect();
    entries.sort_by_key(|(ts, _, _)| *ts);
    let start = entries.len().saturating_sub(max_turns);
    entries[start..]
        .iter()
        .map(|(_, role, content)| (role.to_string(), content.clone()))
        .collect()
}

/// Walk the parent_entry_id chain from `leaf_id`, collecting up to `max_turns`
/// user/agent entries. Pure function — `nodes` is a flat list of SessionEntry JSON
/// strings; a HashMap index is built internally. Returns oldest-first pairs.
#[cfg_attr(not(test), allow(dead_code))]
pub(crate) fn history_from_tree(
    nodes: &[String],
    leaf_id: &str,
    max_turns: usize,
) -> Vec<(String, String)> {
    let index: std::collections::HashMap<String, serde_json::Value> = nodes
        .iter()
        .filter_map(|raw| {
            let v = serde_json::from_str::<serde_json::Value>(raw).ok()?;
            let id = v["@id"].as_str()?.to_owned();
            Some((id, v))
        })
        .collect();

    let mut chain: Vec<(String, String)> = Vec::new();
    let mut current = Some(leaf_id.to_owned());
    while let Some(id) = current.take() {
        if chain.len() >= max_turns {
            break;
        }
        let Some(v) = index.get(&id) else {
            break;
        };
        let role = match v["kind"].as_str().unwrap_or("") {
            "user" => "user",
            "agent" => "assistant",
            _ => {
                current = v["parent_entry_id"].as_str().map(|s| s.to_owned());
                continue;
            }
        };
        let content = v["content"].as_str().unwrap_or("").to_owned();
        chain.push((role.to_string(), content));
        current = v["parent_entry_id"].as_str().map(|s| s.to_owned());
    }
    chain.reverse(); // oldest first for LLM context window
    chain
}

/// Pick "the current session id" from Session-node JSON payloads that the storage
/// layer already returned newest-first (`updated_at DESC, id DESC` — see
/// `docs/SOVEREIGN_RECORD_ORDERING.md`). Pure and total-order-preserving: it does
/// NOT re-sort `sessions` by any field of its own. Session rows are UPSERTED on
/// append, so `updated_at` (newest-TOUCHED) and any `created_at_ns` payload field
/// (newest-CREATED) are different facts; re-deriving "newest" from the latter would
/// be exactly the second, disagreeing sort order that document forbids.
///
/// The `v1_prefix` preference IS deliberate and must survive the fix: both
/// `urn:sovereign:session:v1:`-prefixed and legacy unprefixed session ids live in
/// the same table, and a v1 id is preferred when the input contains one. The rule
/// is "the FIRST v1-prefixed row in the given order, else the FIRST row of any
/// shape" — not "the first row" outright, and not a fold/max over the whole list.
pub(crate) fn pick_latest_session_id(
    sessions: &[serde_json::Value],
    v1_prefix: &str,
) -> Option<String> {
    // First-match scans over `sessions` AS GIVEN — no sort, no max_by_key on any
    // timestamp field. `sessions` is trusted to already be newest-first.
    let ids = || sessions.iter().filter_map(|v| v["@id"].as_str());
    ids()
        .find(|id| id.starts_with(v1_prefix))
        .or_else(|| ids().next())
        .map(str::to_owned)
}

/// Pick "the leaf entry id of the current session" from Session-node JSON payloads
/// already returned newest-touched-first by the storage layer (`ORDER BY updated_at
/// DESC, id DESC` — see `docs/SOVEREIGN_RECORD_ORDERING.md`). Pure, no re-sort: this
/// is the `leaf_entry_id` of the FIRST row in the given order that actually carries
/// one — never the leaf of whichever row has the largest `created_at_ns` among rows
/// that carry one, which would be a second, disagreeing sort order over the same
/// data. A session with no entries yet (freshly created, `leaf_entry_id`
/// absent/null) is skipped in favour of the next-most-recently-touched session that
/// has one — the same skip behaviour this function always had; only the re-sort is
/// removed.
///
/// Unlike `pick_latest_session_id`, there is no id-shape preference to apply here:
/// this never compares or ranks session ids by string, it only reads a field off
/// whichever row SQL already put first among the ones that have it.
pub(crate) fn pick_latest_session_leaf_id(sessions: &[serde_json::Value]) -> Option<String> {
    sessions
        .iter()
        .find_map(|v| v["leaf_entry_id"].as_str())
        .map(str::to_owned)
}

/// Build a Session node JSON payload.
/// `leaf_entry_id`: current tip of the conversation tree (None for empty session).
/// `parent_session_id`: set when this session is a fork of another (None for root).
pub(crate) fn session_participant_from_agent_id(agent_id: Option<&str>) -> String {
    match agent_id {
        Some(agent_id) if !agent_id.is_empty() => format!("urn:sovereign:agent:{agent_id}"),
        _ => "urn:sovereign:agent:runtime-agent".to_string(),
    }
}

fn default_session_participant() -> String {
    session_participant_from_agent_id(std::env::var("MODEL_AGENT_ID").ok().as_deref())
}

/// `workspace`: `(workspace_id, workspace_source)` when this session is attributed to a
/// workspace, `None` when it is not. Absent means absent — an unattributed session carries
/// NEITHER key rather than a null, because a null here would read as "attributed to
/// nothing in particular" where the truth is "nobody has said yet."
pub(crate) fn session_node(
    id: &str,
    name: Option<&str>,
    leaf_entry_id: Option<&str>,
    parent_session_id: Option<&str>,
    created_at_ns: u64,
    workspace: Option<(&str, &str)>,
) -> serde_json::Value {
    let mut node = serde_json::json!({
        "@type":             "Session",
        "@id":               id,
        "participants":      [default_session_participant()],
        "context_id":        serde_json::Value::Null,
        "name":              name,
        "leaf_entry_id":     leaf_entry_id,
        "parent_session_id": parent_session_id,
        "created_at_ns":     created_at_ns,
    });
    if let Some((workspace_id, workspace_source)) = workspace {
        let map = node.as_object_mut().expect("session_node builds an object");
        map.insert("workspace_id".into(), workspace_id.into());
        map.insert("workspace_source".into(), workspace_source.into());
    }
    node
}

/// Build a SessionEntry node JSON payload.
/// `parent_entry_id`: previous entry in the conversation chain (None for tree root).
/// `kind`: one of "user" | "agent" | "tool_call" | "tool_result".
pub(crate) fn session_entry_node(
    id: &str,
    session_id: &str,
    parent_entry_id: Option<&str>,
    kind: &str,
    content: &str,
    timestamp_ns: u64,
) -> serde_json::Value {
    serde_json::json!({
        "@type":           "SessionEntry",
        "@id":             id,
        "session_id":      session_id,
        "parent_entry_id": parent_entry_id,
        "kind":            kind,
        "content":         content,
        "timestamp_ns":    timestamp_ns,
    })
}

/// Rough token estimate for a role+content pair (the chars/4 heuristic the context
/// guard already uses; a real tokenizer is a later refinement). The role label and
/// wire overhead are folded into a small per-message constant.
fn estimated_pair_tokens(role: &str, content: &str) -> usize {
    (role.len() + content.len()) / 4 + 4
}

/// The `on_overflow` moment of ADR-058: when the conversation history would exceed
/// the context budget, FOLD the oldest turns into one structured summary and keep a
/// recent tail at full fidelity — instead of blocking the turn (the old behavior) or
/// letting the window silently overflow.
///
/// Pure and deterministic (no clock, no I/O), so it is unit-testable and runs the
/// same in the wasm guest. `pairs` is oldest-first `(role, content)`. Returns the
/// compacted list: `[("system", <summary>), ...recent tail...]` when folding kicked
/// in, or `pairs` unchanged when it already fits (or budget is 0 = disabled).
///
/// The summary is a deterministic, structured digest (Goal / Progress / Next Steps —
/// the ADR's schema) built from the folded turns' text, NOT an LLM call: compaction
/// must not itself cost a round-trip. A model-authored summary can replace this body
/// later without changing the seam.
pub(crate) fn compact_history(
    pairs: Vec<(String, String)>,
    budget_tokens: usize,
) -> Vec<(String, String)> {
    compact_history_detailed(pairs, budget_tokens).compacted
}

/// The result of a compaction: the compacted list, plus HOW MANY of the oldest pairs
/// were folded and the summary that replaced them. The seam uses `folded_count`/
/// `summary` to record a reversible `SessionContextFold`; `folded_count == 0` means no
/// fold happened (disabled, already-fits, or nothing old enough).
pub(crate) struct CompactionResult {
    pub compacted: Vec<(String, String)>,
    pub folded_count: usize,
    pub summary: Option<String>,
}

/// The full compaction, returning the fold details. `compact_history` is the thin
/// list-only wrapper over this.
pub(crate) fn compact_history_detailed(
    pairs: Vec<(String, String)>,
    budget_tokens: usize,
) -> CompactionResult {
    let no_fold = |compacted: Vec<(String, String)>| CompactionResult {
        compacted,
        folded_count: 0,
        summary: None,
    };
    if budget_tokens == 0 {
        return no_fold(pairs); // disabled
    }
    let total: usize = pairs
        .iter()
        .map(|(r, c)| estimated_pair_tokens(r, c))
        .sum();
    if total <= budget_tokens {
        return no_fold(pairs); // already fits — no-op
    }

    // Keep the newest tail that fits under the budget, reserving room for the summary
    // block. Walk from the end, accumulating, until adding the next-older pair would
    // exceed the tail budget; everything older than that is folded.
    let summary_reserve = budget_tokens / 4; // cap the digest at ~1/4 of the budget
    let tail_budget = budget_tokens.saturating_sub(summary_reserve).max(1);

    let mut tail_tokens = 0usize;
    let mut split = pairs.len(); // index where the tail starts
    for (i, (role, content)) in pairs.iter().enumerate().rev() {
        let cost = estimated_pair_tokens(role, content);
        if tail_tokens + cost > tail_budget {
            split = i + 1;
            break;
        }
        tail_tokens += cost;
        split = i;
    }
    // Always keep at least the last pair (the current turn context) even if huge.
    if split >= pairs.len() && !pairs.is_empty() {
        split = pairs.len() - 1;
    }

    let folded = &pairs[..split];
    if folded.is_empty() {
        return no_fold(pairs); // nothing old enough to fold; fits as-is
    }
    let summary = summarize_folded_turns(folded, summary_reserve);
    let mut out = Vec::with_capacity(pairs.len() - split + 1);
    out.push(("system".to_string(), summary.clone()));
    out.extend(pairs[split..].iter().cloned());
    CompactionResult {
        compacted: out,
        folded_count: split,
        summary: Some(summary),
    }
}

/// Build the deterministic Goal / Progress / Next Steps digest from the folded turns.
/// Goal = the first user turn; Next Steps = the last user turn; Progress = the count
/// plus the last folded result. Every structured section is ALWAYS present — the size
/// is bounded per-field (so a small budget shrinks each field), never by chopping the
/// whole summary, which could drop a section entirely.
fn summarize_folded_turns(folded: &[(String, String)], token_cap: usize) -> String {
    // Split the field budget across the ~4 fields, in chars (tokens*4). A floor keeps
    // each field readable even on a tiny budget; the fields shrink, they don't vanish.
    let per_field = (token_cap.saturating_mul(4) / 4).clamp(40, 400);
    let first_user = folded
        .iter()
        .find(|(r, _)| r == "user")
        .map(|(_, c)| c.as_str());
    let last_user = folded
        .iter()
        .rev()
        .find(|(r, _)| r == "user")
        .map(|(_, c)| c.as_str());
    let user_turns = folded.iter().filter(|(r, _)| r == "user").count();
    let assistant_turns = folded.iter().filter(|(r, _)| r == "assistant").count();

    let mut summary = String::from("[compacted history — earlier turns folded]\n");
    if let Some(goal) = first_user {
        summary.push_str(&format!("Goal: {}\n", truncate_line(goal, per_field)));
    }
    summary.push_str(&format!(
        "Progress: {user_turns} user / {assistant_turns} assistant turns folded.\n"
    ));
    // The last folded assistant text is the most recent progress signal — keeps a
    // thread of what was just done.
    if let Some((_, last_asst)) = folded.iter().rev().find(|(r, _)| r == "assistant") {
        summary.push_str(&format!("Last result: {}\n", truncate_line(last_asst, per_field)));
    }
    if let Some(next) = last_user {
        summary.push_str(&format!("Next Steps: {}\n", truncate_line(next, per_field)));
    }
    summary
}

/// Collapse whitespace/newlines and cap a single field at `max_chars`.
fn truncate_line(text: &str, max_chars: usize) -> String {
    let flat: String = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if flat.chars().count() <= max_chars {
        flat
    } else {
        let mut s: String = flat.chars().take(max_chars).collect();
        s.push('…');
        s
    }
}

/// The provenance value the CLI sends when a HUMAN named the workspace. Anything else — today
/// only `"seeded-from-cwd"` — is an inference, and ADR-094 H2 makes that distinction
/// load-bearing: a seed is not policy truth.
pub(crate) const WORKSPACE_SOURCE_DECLARED: &str = "declared";

/// PURE. What a declaration IS, in one place — trimmed, and empty means absent.
///
/// The same rule `dispatch.rs` applies on the sidecar side (`str::trim` then reject empty). It
/// was applied there and nowhere else on the way in: `prompt_handler.rs` forwarded the raw
/// string into the env, and `declared_workspace` rejected a trim-empty value without TRIMMING
/// the one it kept. So a caller that is not the CLI could send `"  rcdc5  "` and have it stamped
/// verbatim onto the Session node, where it matches no workspace in the catalog and no budget
/// keyed by one — an attribution that exists, looks declared, and selects nothing (ISS-060).
///
/// Three sites applying "the same" rule from memory is how they came to differ. One function is
/// how they stop.
pub(crate) fn normalize_declaration(raw: Option<&str>) -> Option<String> {
    let trimmed = raw?.trim();
    if trimmed.is_empty() {
        return None;
    }
    Some(trimmed.to_string())
}

/// What the store said about a Session node — THREE states, never two.
///
/// `get_or_create_session` used to ask `get_node(id).is_err()` and branch on the boolean. That
/// collapses `PluginError::NotFound` (the node is not there) onto `Internal` (the store could
/// not be asked), and the two demand opposite actions: the first says create, the second says
/// touch nothing. The WIT surface has carried the distinction all along; only the caller threw
/// it away (ISS-063).
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum StoredSession {
    /// Not in the store. Creating is safe.
    Absent,
    /// In the store, carrying this attribution (`None` when it carries none).
    Present(Option<(String, String)>),
    /// The store could not be asked. NOT absent — and the difference is a conversation's
    /// attribution, so it is not a nuance.
    Unreadable,
}

/// What to do about the workspace stamp.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum WorkspaceStamp {
    /// Write a new Session node carrying the incoming attribution.
    Create,
    /// The node exists; write the attribution onto it.
    Stamp,
    /// Change nothing.
    Leave,
}

/// PURE. The whole attribution policy in one place, so the three defects it closes cannot drift
/// apart again — they were one decision made in three halves.
///
/// - **Unreadable → Leave.** Never create on a read failure: the node may exist and be carrying a
///   declaration this call would silently replace with whatever it happens to hold (ISS-063).
/// - **Absent → Create.** The ordinary first call on a CLI-generated id.
/// - **Present with NO attribution → Stamp**, whenever anything is declared. Every session
///   created before attribution existed is in this state, and without this the cwd seed re-fires
///   on every single run for the rest of that conversation's life (ISS-059).
/// - **Present WITH an attribution → Stamp only for a human declaration.** `--workspace` is the
///   operator speaking, and the operator may correct a session that was seeded wrongly (ISS-057).
///   A seed may not: the fear the old comment recorded — "a later run from another directory
///   cannot silently re-attribute a conversation already under way" — is exactly right about
///   seeds, and this keeps it true of them while letting a human be heard.
pub(crate) fn workspace_stamp_action(
    stored: &StoredSession,
    incoming: Option<(&str, &str)>,
) -> WorkspaceStamp {
    match stored {
        StoredSession::Unreadable => WorkspaceStamp::Leave,
        StoredSession::Absent => WorkspaceStamp::Create,
        StoredSession::Present(existing) => match (existing, incoming) {
            (_, None) => WorkspaceStamp::Leave,
            (None, Some(_)) => WorkspaceStamp::Stamp,
            (Some(_), Some((_, source))) if source == WORKSPACE_SOURCE_DECLARED => {
                WorkspaceStamp::Stamp
            }
            (Some(_), Some(_)) => WorkspaceStamp::Leave,
        },
    }
}

/// PURE. Reads the attribution off a stored Session payload. Both keys or neither, the same pair
/// rule `session_node` writes them with and `declared_workspace` reads them with — an id with no
/// provenance is not defaulted to `"declared"`, because defaulting there would fail toward the
/// STRONGER claim on the one distinction that decides budget policy.
pub(crate) fn stored_workspace_of(node: &serde_json::Value) -> Option<(String, String)> {
    let id = node.get("workspace_id")?.as_str()?.trim();
    let source = node.get("workspace_source")?.as_str()?.trim();
    if id.is_empty() || source.is_empty() {
        return None;
    }
    Some((id.to_string(), source.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    const V1: &str = "urn:sovereign:session:v1:";

    /// The whole point: SQL already ordered these newest-TOUCHED-first. The row at
    /// index 0 has an OLDER `created_at_ns` than the row at index 1 — a session
    /// that was created earlier but touched (appended to) most recently. The old
    /// `max_by_key(created_at_ns)` re-sort would return index 1; the storage
    /// layer's order says index 0 is the answer to "which session was I last in."
    /// If this fixture didn't disagree on the two fields, it couldn't tell the two
    /// behaviours apart.
    #[test]
    fn returns_the_first_row_sql_gave_not_the_one_with_the_newest_created_at() {
        let sessions = vec![
            serde_json::json!({
                "@id": format!("{V1}newest-touched-but-older-created"),
                "created_at_ns": 100_u64,
            }),
            serde_json::json!({
                "@id": format!("{V1}older-touched-but-newer-created"),
                "created_at_ns": 999_u64,
            }),
        ];

        let picked = pick_latest_session_id(&sessions, V1);

        assert_eq!(
            picked.as_deref(),
            Some(format!("{V1}newest-touched-but-older-created").as_str()),
            "must trust SQL's newest-touched-first order, not re-sort by created_at_ns"
        );
    }

    /// The v1 preference survives: a legacy (unprefixed) row sits ahead of a v1 row
    /// in SQL's order (it was touched more recently) AND has a newer `created_at_ns`
    /// — two reasons a naive "just take the first row" or a naive max_by_key would
    /// both pick the legacy row. The v1 row must still win.
    #[test]
    fn v1_prefixed_row_wins_over_a_legacy_row_that_is_both_earlier_in_order_and_newer_by_created_at(
    ) {
        let sessions = vec![
            serde_json::json!({
                "@id": "legacy-unprefixed-newest-touched-and-newest-created",
                "created_at_ns": 999_u64,
            }),
            serde_json::json!({
                "@id": format!("{V1}older-touched-and-older-created"),
                "created_at_ns": 1_u64,
            }),
        ];

        let picked = pick_latest_session_id(&sessions, V1);

        assert_eq!(
            picked.as_deref(),
            Some(format!("{V1}older-touched-and-older-created").as_str()),
            "the v1-prefixed row must be preferred even though it is neither first \
             in SQL's order nor newest by created_at_ns"
        );
    }

    /// No v1 row present at all: falls back to the first row of any shape (SQL's
    /// order), not a max_by_key over created_at_ns.
    #[test]
    fn falls_back_to_first_row_of_any_shape_when_no_v1_row_exists() {
        let sessions = vec![
            serde_json::json!({
                "@id": "legacy-first-in-order-but-older-created",
                "created_at_ns": 1_u64,
            }),
            serde_json::json!({
                "@id": "legacy-second-in-order-but-newer-created",
                "created_at_ns": 999_u64,
            }),
        ];

        let picked = pick_latest_session_id(&sessions, V1);

        assert_eq!(
            picked.as_deref(),
            Some("legacy-first-in-order-but-older-created"),
            "with no v1 row, the first row in SQL's order wins — not the newest by created_at_ns"
        );
    }

    #[test]
    fn empty_input_returns_none() {
        assert_eq!(pick_latest_session_id(&[], V1), None);
    }

    /// The whole point, mirroring the sibling function's discriminating fixture:
    /// the row FIRST in SQL's newest-touched-first order has an OLDER
    /// `created_at_ns` than the row second in order. The old
    /// `max_by_key(created_at_ns)` re-sort would return the second row's leaf; the
    /// storage layer's order says the first row is the current session, so its
    /// leaf is the answer.
    #[test]
    fn returns_the_leaf_of_the_first_row_sql_gave_not_the_one_with_the_newest_created_at() {
        let sessions = vec![
            serde_json::json!({
                "leaf_entry_id": "leaf-of-newest-touched-but-older-created",
                "created_at_ns": 100_u64,
            }),
            serde_json::json!({
                "leaf_entry_id": "leaf-of-older-touched-but-newer-created",
                "created_at_ns": 999_u64,
            }),
        ];

        let picked = pick_latest_session_leaf_id(&sessions);

        assert_eq!(
            picked.as_deref(),
            Some("leaf-of-newest-touched-but-older-created"),
            "must trust SQL's newest-touched-first order, not re-sort by created_at_ns"
        );
    }

    /// A freshly-created session (no entries yet, so no `leaf_entry_id`) sits first
    /// in SQL's order — it was touched most recently by virtue of just being
    /// created, but it has nothing to hand back. The next-most-recently-touched
    /// session that DOES have a leaf must be returned instead. This skip behaviour
    /// is preserved from before the fix; only the re-sort is removed.
    #[test]
    fn skips_a_leading_row_with_no_leaf_entry_id() {
        let sessions = vec![
            serde_json::json!({ "created_at_ns": 500_u64 }), // no leaf_entry_id at all
            serde_json::json!({
                "leaf_entry_id": "leaf-of-second-row",
                "created_at_ns": 1_u64,
            }),
        ];

        let picked = pick_latest_session_leaf_id(&sessions);

        assert_eq!(picked.as_deref(), Some("leaf-of-second-row"));
    }

    #[test]
    fn leaf_id_empty_input_returns_none() {
        assert_eq!(pick_latest_session_leaf_id(&[]), None);
    }

    // ── budget guard: resolve_budget_check / budget_exceeded ───────────────────
    //
    // Nine cases: known-under, known-over, truncated-but-already-over (the
    // arithmetic-proof case that round 1's code would wrongly regress on),
    // truncated-and-still-under (triggers a real re-query), a re-query that
    // itself fails, a first query that fails outright, (round 3) a
    // zero-or-negative budget that must block WITHOUT any query at all, and
    // (round 4) a re-query that is ITSELF truncated — split into the
    // still-under-budget case (must be `Unknown`, not a false `Known`-under)
    // and the already-over case (still `Known` by the same arithmetic proof).
    //
    // Every case that must NOT touch storage passes `never_queried` and/or
    // `never_requeried` — closures that panic if called — so the test fails
    // loudly (not just by returning a wrong-but-plausible value) if a
    // short-circuit stops firing.

    fn usage_record(provider: &str, timestamp_ns: u64, estimated_usd: f64) -> String {
        serde_json::json!({
            "@type": "UsageRecord",
            "provider": provider,
            "timestamp_ns": timestamp_ns,
            "estimated_usd": estimated_usd,
        })
        .to_string()
    }

    const DAY_NS: u64 = 24 * 3600 * 1_000_000_000;
    const WINDOW_30D_NS: u64 = 30 * DAY_NS;

    fn never_queried() -> Result<(Vec<String>, bool, u32), ()> {
        panic!("query_first must not be called: a budget_usd <= 0.0 is provable \
                 without reading a single UsageRecord");
    }

    fn never_requeried(_limit: u32) -> Result<(Vec<String>, bool), ()> {
        panic!("requery_all must not be called: an untruncated read or an arithmetic \
                 proof from the visible sum alone must decide this case");
    }

    #[test]
    fn budget_known_under_is_not_exceeded() {
        let records = vec![
            usage_record("anthropic", 10 * DAY_NS, 1.0),
            usage_record("anthropic", 20 * DAY_NS, 2.0),
        ];
        let now = 30 * DAY_NS;

        let check = resolve_budget_check(
            "anthropic",
            5.0,
            now,
            WINDOW_30D_NS,
            move || Ok((records, false, 2)),
            never_requeried,
        );

        assert_eq!(
            check,
            BudgetCheck::Known { spend_usd: 3.0, budget_usd: 5.0 },
            "a complete, untruncated read must report the true sum as Known"
        );
        assert!(
            !budget_exceeded(&check),
            "3.0 spent against a 5.0 budget is under — must not block"
        );
    }

    #[test]
    fn budget_known_over_is_exceeded() {
        let records = vec![
            usage_record("anthropic", 10 * DAY_NS, 4.0),
            usage_record("anthropic", 20 * DAY_NS, 3.0),
        ];
        let now = 30 * DAY_NS;

        let check = resolve_budget_check(
            "anthropic",
            5.0,
            now,
            WINDOW_30D_NS,
            move || Ok((records, false, 2)),
            never_requeried,
        );

        assert_eq!(
            check,
            BudgetCheck::Known { spend_usd: 7.0, budget_usd: 5.0 },
            "a complete, untruncated read must report the true sum as Known"
        );
        assert!(
            budget_exceeded(&check),
            "7.0 spent against a 5.0 budget is over — must block"
        );
    }

    #[test]
    fn budget_truncated_and_already_over_is_known_by_arithmetic_not_unknown() {
        // THE REGRESSION GUARD for round 1's loosening: the visible rows alone
        // already sum to 9.0, over the 5.0 budget, even though `truncated: true`
        // says more rows exist. A subset's sum is a valid lower bound (every
        // `estimated_usd` is non-negative), so the true total is provably >= 9.0
        // too — this MUST be `Known`, and MUST block, without needing the rest of
        // the rows. Round 1's code would have returned `Unknown(Truncated)` here
        // and silently stopped enforcing; this is exactly the case that regression
        // would fail on.
        let records = vec![usage_record("anthropic", 10 * DAY_NS, 9.0)];
        let now = 30 * DAY_NS;

        let check = resolve_budget_check(
            "anthropic",
            5.0,
            now,
            WINDOW_30D_NS,
            move || Ok((records, true /* truncated */, 500)),
            never_requeried,
        );

        assert_eq!(
            check,
            BudgetCheck::Known { spend_usd: 9.0, budget_usd: 5.0 },
            "a truncated page whose visible sum already meets budget must be Known, \
             proved by arithmetic, without consulting the rest of the rows"
        );
        assert!(budget_exceeded(&check), "9.0 visible against a 5.0 budget must block");
    }

    #[test]
    fn budget_truncated_and_still_under_requeries_and_decides_on_the_complete_set() {
        // Visible rows sum to 1.0 — under the 5.0 budget — so the arithmetic
        // shortcut above cannot fire; the partial sum proves nothing about the
        // total. `stored` (500) must be threaded to `requery_all` as the limit for
        // the follow-up read, and the FINAL answer must come from the complete
        // set the follow-up returns (8.0, over budget) — not from the partial
        // sum (1.0, under budget). A guard that decided on the partial sum here
        // would answer "under"; the correct answer, once the full history is
        // read, is "over".
        let records = vec![usage_record("anthropic", 10 * DAY_NS, 1.0)];
        let now = 30 * DAY_NS;

        let seen_limit = std::cell::Cell::new(0u32);
        let full_records = vec![
            usage_record("anthropic", 5 * DAY_NS, 1.0),
            usage_record("anthropic", 10 * DAY_NS, 1.0),
            usage_record("anthropic", 15 * DAY_NS, 6.0),
        ];
        let check = resolve_budget_check(
            "anthropic",
            5.0,
            now,
            WINDOW_30D_NS,
            move || Ok((records, true, 500)),
            |limit| {
                seen_limit.set(limit);
                Ok((full_records.clone(), false /* the follow-up itself is complete */))
            },
        );

        assert_eq!(seen_limit.get(), 500, "the follow-up query must use `stored` as its limit");
        assert_eq!(
            check,
            BudgetCheck::Known { spend_usd: 8.0, budget_usd: 5.0 },
            "the decision must come from the COMPLETE set the follow-up read returns, \
             not from the under-budget partial sum of the first read"
        );
        assert!(budget_exceeded(&check), "8.0 from the complete set is over a 5.0 budget");
    }

    #[test]
    fn budget_requery_that_is_itself_truncated_is_unknown_not_known_under() {
        // Fix 2's regression guard. The follow-up read (`requery_all`) can race
        // fresh writes and come back truncated ITSELF — the FIRST read said
        // `stored: 500`, but by the time the follow-up asks for 500 rows, more
        // than 500 now exist, so it is STILL a partial view. The fixture is
        // deliberately discriminating: the re-queried rows sum to 2.0, UNDER the
        // 5.0 budget — the SAME arithmetic outcome a legitimate, complete,
        // under-budget read would produce. A guard that dropped the follow-up's
        // own `truncated` flag (as this one did before Fix 2) would return
        // `Known { spend_usd: 2.0, budget_usd: 5.0 }` here — indistinguishable
        // from "checked and genuinely under" — even though the true total is
        // unknown and could be over. The correct answer is `Unknown
        // (RequeryTruncated)`, not `Known`-under.
        let records = vec![usage_record("anthropic", 10 * DAY_NS, 1.0)];
        let now = 30 * DAY_NS;

        let requeried_but_still_truncated = vec![
            usage_record("anthropic", 5 * DAY_NS, 1.0),
            usage_record("anthropic", 10 * DAY_NS, 1.0),
        ]; // sums to 2.0 — under the 5.0 budget, same shape as a clean under-budget read

        let check = resolve_budget_check(
            "anthropic",
            5.0,
            now,
            WINDOW_30D_NS,
            move || Ok((records, true /* first read truncated */, 500)),
            move |limit| {
                assert_eq!(limit, 500, "the follow-up query must still use `stored` as its limit");
                Ok((requeried_but_still_truncated.clone(), true /* STILL truncated */))
            },
        );

        assert_eq!(
            check,
            BudgetCheck::Unknown(BudgetUnknownReason::RequeryTruncated),
            "a follow-up read that is itself truncated must not be trusted as the \
             complete set, even though its partial sum (2.0) looks like an ordinary \
             under-budget answer"
        );
        assert!(
            !budget_exceeded(&check),
            "policy is FAIL OPEN but LOUD: Unknown still proceeds"
        );
    }

    #[test]
    fn budget_requery_that_is_itself_truncated_but_already_over_is_known_by_arithmetic() {
        // The companion case: even a re-truncated follow-up is `Known` (not
        // `Unknown`) when its own visible sum already meets/exceeds budget — the
        // same lower-bound arithmetic proof `resolve_budget_check` applies to the
        // first read applies here too. Only an under-budget, still-truncated
        // follow-up is `Unknown`.
        let records = vec![usage_record("anthropic", 10 * DAY_NS, 1.0)];
        let now = 30 * DAY_NS;

        let requeried_over_budget_but_truncated =
            vec![usage_record("anthropic", 10 * DAY_NS, 9.0)];

        let check = resolve_budget_check(
            "anthropic",
            5.0,
            now,
            WINDOW_30D_NS,
            move || Ok((records, true, 500)),
            move |_limit| Ok((requeried_over_budget_but_truncated.clone(), true)),
        );

        assert_eq!(
            check,
            BudgetCheck::Known { spend_usd: 9.0, budget_usd: 5.0 },
            "an over-budget visible sum on the follow-up is Known by arithmetic, \
             regardless of whether the follow-up itself is complete"
        );
        assert!(budget_exceeded(&check), "9.0 visible against a 5.0 budget must block");
    }

    #[test]
    fn budget_requery_failure_is_unknown_query_error() {
        // The re-query is itself a `query-nodes` call and can fail like any other.
        // A failed follow-up is not evidence of zero (or any) spend, same as a
        // failed first read — it must land in `Unknown(QueryError)`, not invent a
        // third meaning for "the second read didn't work either".
        let records = vec![usage_record("anthropic", 10 * DAY_NS, 1.0)];
        let now = 30 * DAY_NS;

        let check = resolve_budget_check(
            "anthropic",
            5.0,
            now,
            WINDOW_30D_NS,
            move || Ok((records, true, 500)),
            |_limit| Err(()),
        );

        assert_eq!(
            check,
            BudgetCheck::Unknown(BudgetUnknownReason::QueryError),
            "a follow-up query that fails outright must resolve to Unknown(QueryError)"
        );
        assert!(
            !budget_exceeded(&check),
            "policy is FAIL OPEN but LOUD: Unknown still proceeds"
        );
    }

    #[test]
    fn budget_first_query_error_is_unknown_query_error() {
        let check = resolve_budget_check(
            "anthropic",
            5.0,
            30 * DAY_NS,
            WINDOW_30D_NS,
            || Err(()),
            never_requeried,
        );

        assert_eq!(
            check,
            BudgetCheck::Unknown(BudgetUnknownReason::QueryError),
            "a failed first query is not evidence of zero spend — must resolve to Unknown, \
             never to Known{{spend_usd: 0.0, ..}}"
        );
        assert!(
            !budget_exceeded(&check),
            "policy is FAIL OPEN but LOUD: Unknown still proceeds"
        );
    }

    #[test]
    fn budget_zero_or_negative_blocks_without_any_query() {
        // The other half of the same arithmetic move as the truncated-and-over
        // case: a budget of `<= 0.0` means "spend nothing", and every real spend
        // is >= 0.0, so this is provable with NO data at all. `never_queried` and
        // `never_requeried` both panic if invoked — proving neither the first
        // query nor the follow-up ever fires for a non-positive budget. This is
        // the `MODEL_BUDGET_<PROVIDER>_USD=0` hard stop the pre-Task-3 code
        // produced by accident (an empty sum meeting a zero budget) and round 2
        // silently dropped; round 3 restores it on purpose.
        let zero = resolve_budget_check(
            "anthropic",
            0.0,
            30 * DAY_NS,
            WINDOW_30D_NS,
            never_queried,
            never_requeried,
        );
        assert_eq!(zero, BudgetCheck::Known { spend_usd: 0.0, budget_usd: 0.0 });
        assert!(budget_exceeded(&zero), "a budget of exactly 0.0 must block, no query needed");

        let negative = resolve_budget_check(
            "anthropic",
            -5.0,
            30 * DAY_NS,
            WINDOW_30D_NS,
            never_queried,
            never_requeried,
        );
        assert_eq!(negative, BudgetCheck::Known { spend_usd: 0.0, budget_usd: -5.0 });
        assert!(budget_exceeded(&negative), "a negative budget must also block, no query needed");
    }

    // ---- Workspace attribution: one decision, formerly three halves (ISS-057/059/063).

    fn present_with(source: &str) -> StoredSession {
        StoredSession::Present(Some(("rcdc5".into(), source.into())))
    }

    /// ISS-063. `get_node` returning `Internal` is "could not ask", and the old `.is_err()` read
    /// it as "not there" and created — over a live session that may already carry a human
    /// declaration. Failing shut here costs one uncreated node; failing open costs an
    /// attribution, which is what decides the budget.
    #[test]
    fn an_unreadable_store_changes_nothing_even_with_a_human_declaration() {
        assert_eq!(
            workspace_stamp_action(&StoredSession::Unreadable, Some(("rcdc5", "declared"))),
            WorkspaceStamp::Leave
        );
        assert_eq!(
            workspace_stamp_action(&StoredSession::Unreadable, None),
            WorkspaceStamp::Leave
        );
    }

    #[test]
    fn an_absent_node_is_created_with_whatever_this_call_declared() {
        assert_eq!(
            workspace_stamp_action(&StoredSession::Absent, Some(("rcdc5", "seeded-from-cwd"))),
            WorkspaceStamp::Create
        );
    }

    /// ISS-059. Every session created before attribution existed sits here. Without the stamp,
    /// degree 3 re-seeds from the current directory on every run for the rest of its life.
    #[test]
    fn a_session_with_no_attribution_is_stamped_by_a_seed_as_well_as_a_declaration() {
        assert_eq!(
            workspace_stamp_action(&StoredSession::Present(None), Some(("rcdc5", "seeded-from-cwd"))),
            WorkspaceStamp::Stamp
        );
        assert_eq!(
            workspace_stamp_action(&StoredSession::Present(None), Some(("rcdc5", "declared"))),
            WorkspaceStamp::Stamp
        );
    }

    /// ISS-057. `--workspace` is the operator speaking, and a session seeded from the wrong
    /// directory stayed wrong for life because nothing could correct it.
    #[test]
    fn a_human_declaration_corrects_a_session_that_was_seeded_wrongly() {
        assert_eq!(
            workspace_stamp_action(&present_with("seeded-from-cwd"), Some(("notes", "declared"))),
            WorkspaceStamp::Stamp
        );
    }

    /// The other half of ISS-057, and the fear the original comment recorded: a later run from
    /// another directory must NOT silently re-attribute a conversation already under way. True of
    /// seeds, which is what that comment was really about.
    #[test]
    fn a_seed_never_re_attributes_a_session_that_already_has_one() {
        assert_eq!(
            workspace_stamp_action(&present_with("seeded-from-cwd"), Some(("notes", "seeded-from-cwd"))),
            WorkspaceStamp::Leave
        );
        assert_eq!(
            workspace_stamp_action(&present_with("declared"), Some(("notes", "seeded-from-cwd"))),
            WorkspaceStamp::Leave
        );
    }

    #[test]
    fn nothing_declared_this_call_changes_nothing() {
        assert_eq!(workspace_stamp_action(&present_with("declared"), None), WorkspaceStamp::Leave);
        assert_eq!(workspace_stamp_action(&StoredSession::Present(None), None), WorkspaceStamp::Leave);
    }

    #[test]
    fn stored_workspace_needs_both_keys_and_neither_may_be_blank() {
        let both = serde_json::json!({"workspace_id": "rcdc5", "workspace_source": "declared"});
        assert_eq!(
            stored_workspace_of(&both),
            Some(("rcdc5".to_string(), "declared".to_string()))
        );
        assert_eq!(stored_workspace_of(&serde_json::json!({"workspace_id": "rcdc5"})), None);
        assert_eq!(
            stored_workspace_of(&serde_json::json!({"workspace_id": "  ", "workspace_source": "declared"})),
            None
        );
    }


    /// ISS-060. `dispatch.rs` trims and rejects empty; the two sites downstream of it did not,
    /// so a non-CLI caller could stamp `"  rcdc5  "` onto a Session node — an attribution that
    /// exists, reads as declared, and matches nothing.
    #[test]
    fn a_declaration_is_trimmed_and_an_empty_one_is_no_declaration() {
        assert_eq!(normalize_declaration(Some("  rcdc5  ")), Some("rcdc5".to_string()));
        assert_eq!(normalize_declaration(Some("rcdc5")), Some("rcdc5".to_string()));
        assert_eq!(normalize_declaration(Some("   ")), None);
        assert_eq!(normalize_declaration(Some("")), None);
        assert_eq!(normalize_declaration(None), None);
        assert_eq!(normalize_declaration(Some("\t\nrcdc5\n")), Some("rcdc5".to_string()));
    }

}
