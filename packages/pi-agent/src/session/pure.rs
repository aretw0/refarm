/// Resolves the active provider name with full user control:
///   LLM_PROVIDER          — explicit choice for this run
///   LLM_DEFAULT_PROVIDER  — user's personal sovereign default (fallback when LLM_PROVIDER unset)
///   hardcoded "ollama"    — last resort: local, free, no key needed
pub(crate) fn provider_name_from_env() -> String {
    std::env::var("LLM_PROVIDER")
        .or_else(|_| std::env::var("LLM_DEFAULT_PROVIDER"))
        .unwrap_or_else(|_| "ollama".into())
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
                "AgentResponse" => "assistant",
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
