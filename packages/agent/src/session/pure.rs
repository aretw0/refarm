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
}
