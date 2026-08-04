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

pub(crate) fn session_node(
    id: &str,
    name: Option<&str>,
    leaf_entry_id: Option<&str>,
    parent_session_id: Option<&str>,
    created_at_ns: u64,
) -> serde_json::Value {
    serde_json::json!({
        "@type":             "Session",
        "@id":               id,
        "participants":      [default_session_participant()],
        "context_id":        serde_json::Value::Null,
        "name":              name,
        "leaf_entry_id":     leaf_entry_id,
        "parent_session_id": parent_session_id,
        "created_at_ns":     created_at_ns,
    })
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
