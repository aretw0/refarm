#[cfg(target_arch = "wasm32")]
use crate::refarm::plugin::tractor_bridge;

#[cfg(target_arch = "wasm32")]
use crate::now_ns;

// ── Provider resolution ───────────────────────────────────────────────────────

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

// ── History (pure — testable on native) ──────────────────────────────────────

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

// ── Session primitives (pure — testable on native) ───────────────────────────

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

// ── WASM-only session ops ─────────────────────────────────────────────────────

/// Create and persist a new Session. Returns the session `@id`.
#[cfg(target_arch = "wasm32")]
fn store_new_session(name: Option<&str>) -> Option<String> {
    let session_id = crate::new_pi_urn("session");
    let node = session_node(&session_id, name, None, None, now_ns());
    tractor_bridge::store_node(&node.to_string()).ok()?;
    Some(session_id)
}

/// Append a SessionEntry under `session_id`, wiring `parent_entry_id` from the
/// current `leaf_entry_id` read from the stored Session node. Updates the session
/// leaf pointer after successful store. Returns the new entry `@id`.
#[cfg(target_arch = "wasm32")]
pub(crate) fn append_to_session(session_id: &str, kind: &str, content: &str) -> Option<String> {
    let current_leaf = tractor_bridge::get_node(&session_id.to_string())
        .ok()
        .and_then(|raw| {
            serde_json::from_str::<serde_json::Value>(&raw)
                .ok()?
                .get("leaf_entry_id")
                .and_then(|v| v.as_str())
                .map(|s| s.to_owned())
        });

    let entry_id = crate::new_pi_urn("entry");
    let entry = session_entry_node(
        &entry_id,
        session_id,
        current_leaf.as_deref(),
        kind,
        content,
        now_ns(),
    );
    tractor_bridge::store_node(&entry.to_string()).ok()?;

    // Update session leaf pointer (read-modify-write: preserve other fields).
    if let Ok(raw) = tractor_bridge::get_node(&session_id.to_string()) {
        if let Ok(mut v) = serde_json::from_str::<serde_json::Value>(&raw) {
            v["leaf_entry_id"] = serde_json::Value::String(entry_id.clone());
            let _ = tractor_bridge::store_node(&v.to_string());
        }
    }

    Some(entry_id)
}

/// Fork `session_id` at `entry_id`: create a new Session with `parent_session_id`
/// pointing to the original and `leaf_entry_id` set to `entry_id`. The original
/// session is not modified. Returns the new session `@id`.
#[cfg(target_arch = "wasm32")]
pub(crate) fn fork_session(session_id: &str, entry_id: &str, name: Option<&str>) -> Option<String> {
    let new_id_ = crate::new_pi_urn("session");
    let node = session_node(&new_id_, name, Some(entry_id), Some(session_id), now_ns());
    tractor_bridge::store_node(&node.to_string()).ok()?;
    Some(new_id_)
}

/// Navigate to `entry_id` within `session_id`: moves `leaf_entry_id` without
/// touching any SessionEntry nodes. Returns Err if session not found.
#[cfg(target_arch = "wasm32")]
pub(crate) fn navigate_session(session_id: &str, entry_id: &str) -> Result<(), String> {
    let raw = tractor_bridge::get_node(&session_id.to_string())
        .map_err(|e| format!("navigate: session not found: {e:?}"))?;
    let mut v = serde_json::from_str::<serde_json::Value>(&raw)
        .map_err(|e| format!("navigate: parse error: {e}"))?;
    v["leaf_entry_id"] = serde_json::Value::String(entry_id.to_owned());
    tractor_bridge::store_node(&v.to_string())
        .map(|_| ())
        .map_err(|e| format!("navigate: store error: {e:?}"))
}

/// Read-only version of active session ID — never creates a new session.
/// Used for display purposes (e.g., list_sessions showing which is active).
#[cfg(target_arch = "wasm32")]
pub(crate) fn get_or_create_session_id_readonly() -> String {
    if let Ok(id) = std::env::var("LLM_SESSION_ID") {
        if !id.is_empty() {
            return id;
        }
    }
    tractor_bridge::query_nodes("Session", 20)
        .unwrap_or_default()
        .iter()
        .filter_map(|raw| serde_json::from_str::<serde_json::Value>(raw).ok())
        .max_by_key(|v| v["created_at_ns"].as_u64().unwrap_or(0))
        .and_then(|v| v["@id"].as_str().map(|s| s.to_owned()))
        .unwrap_or_default()
}

/// Return the active session ID for this agent instance.
///
/// Priority:
///   1. `LLM_SESSION_ID` env var — explicit override (e.g. tractor passes it per-call)
///   2. Most recently created Session node in the CRDT — resume across restarts
///   3. Create a fresh Session — first run in this namespace
#[cfg(target_arch = "wasm32")]
pub(crate) fn get_or_create_session() -> String {
    if let Ok(id) = std::env::var("LLM_SESSION_ID") {
        if !id.is_empty() {
            return id;
        }
    }

    if let Ok(sessions) = tractor_bridge::query_nodes("Session", 20) {
        if let Some(latest_id) = sessions
            .iter()
            .filter_map(|raw| serde_json::from_str::<serde_json::Value>(raw).ok())
            .max_by_key(|v| v["created_at_ns"].as_u64().unwrap_or(0))
            .and_then(|v| v["@id"].as_str().map(|s| s.to_owned()))
        {
            return latest_id;
        }
    }

    store_new_session(None).unwrap_or_else(|| crate::new_pi_urn("session"))
}

// ── WASM-only history + budget ────────────────────────────────────────────────

/// Try to build history by walking the active Session's entry tree.
/// Returns None when no Session exists (falls back to timestamp-sort).
#[cfg(target_arch = "wasm32")]
fn query_history_from_session(max_turns: usize) -> Option<Vec<(String, String)>> {
    let sessions = tractor_bridge::query_nodes("Session", 10).ok()?;
    let leaf_id = sessions
        .iter()
        .filter_map(|raw| serde_json::from_str::<serde_json::Value>(raw).ok())
        .filter_map(|v| {
            let ts = v["created_at_ns"].as_u64().unwrap_or(0);
            let lid = v["leaf_entry_id"].as_str()?.to_owned();
            Some((ts, lid))
        })
        .max_by_key(|(ts, _)| *ts)
        .map(|(_, lid)| lid)?;

    // Walk the chain via get_node to avoid pagination limits on query_nodes.
    let mut chain: Vec<(String, String)> = Vec::new();
    let mut current = Some(leaf_id);
    while let Some(id) = current.take() {
        if chain.len() >= max_turns {
            break;
        }
        let raw = tractor_bridge::get_node(&id).ok()?;
        let v = serde_json::from_str::<serde_json::Value>(&raw).ok()?;
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
    if chain.is_empty() {
        return None;
    }
    chain.reverse();
    Some(chain)
}

/// Fetch conversation history from the CRDT store.
/// Controlled by LLM_HISTORY_TURNS env var (default: 0 = disabled).
/// Returns up to that many (role, content) pairs, oldest first.
#[cfg(target_arch = "wasm32")]
pub(crate) fn query_history() -> Vec<(String, String)> {
    let max_turns = std::env::var("LLM_HISTORY_TURNS")
        .ok()
        .and_then(|v| v.parse::<usize>().ok())
        .unwrap_or(0);
    if max_turns == 0 {
        return vec![];
    }

    // Tree-walk via Session.leaf_entry_id → parent_entry_id chain (preferred).
    if let Some(history) = query_history_from_session(max_turns) {
        return history;
    }

    // Legacy fallback: timestamp-sort for pre-session UserPrompt/AgentResponse nodes.
    let limit = (max_turns * 2) as u32;
    let mut nodes = tractor_bridge::query_nodes("UserPrompt", limit).unwrap_or_default();
    nodes.extend(tractor_bridge::query_nodes("AgentResponse", limit).unwrap_or_default());
    history_from_nodes(&nodes, max_turns)
}

/// Returns true when `LLM_BUDGET_<PROVIDER>_USD` is set and the rolling 30-day
/// spend for `provider_name` (read from CRDT UsageRecord nodes) meets or exceeds it.
#[cfg(target_arch = "wasm32")]
pub(crate) fn budget_exceeded_for_provider(provider_name: &str) -> bool {
    let budget_key = format!("LLM_BUDGET_{}_USD", provider_name.to_uppercase());
    let Ok(budget_str) = std::env::var(&budget_key) else {
        return false;
    };
    let Ok(budget) = budget_str.parse::<f64>() else {
        return false;
    };
    let records = tractor_bridge::query_nodes("UsageRecord", 10_000).unwrap_or_default();
    const WINDOW_30D_NS: u64 = 30 * 24 * 3600 * 1_000_000_000;
    sum_provider_spend_usd(&records, provider_name, now_ns(), WINDOW_30D_NS) >= budget
}
