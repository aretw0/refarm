use crate::now_ns;
use crate::plugin::host::tractor_bridge;

use super::{
    history_from_nodes, pick_latest_session_id, pick_latest_session_leaf_id, session_entry_node,
    session_node, sum_provider_spend_usd,
};

const SESSION_PREFIX_V1: &str = "urn:sovereign:session:v1:";
const ENTRY_PREFIX_V1: &str = "urn:sovereign:session-entry:v1:";

fn new_session_id() -> String {
    format!("{SESSION_PREFIX_V1}{}", crate::new_id())
}

fn new_entry_id_for_session(_session_id: &str) -> String {
    format!("{ENTRY_PREFIX_V1}{}", crate::new_id())
}

/// Select the current session id from the Session rows the storage layer returned.
///
/// NO SORT HERE, DELIBERATELY: `tractor_bridge::query_nodes` rides on
/// `NativeStorage::query_nodes`'s `ORDER BY updated_at DESC, id DESC` guarantee
/// (`docs/SOVEREIGN_RECORD_ORDERING.md`) — `sessions` below already arrives
/// newest-TOUCHED-first. Session rows are UPSERTED on append, so `updated_at`
/// (newest-touched) and a row's own `created_at_ns` field (newest-created) are
/// different facts; "which session was I last in" wants the former, and SQL
/// already gave it. Re-deriving "newest" here via a `max_by_key` on
/// `created_at_ns` — the previous shape of this function — would be exactly the
/// SECOND, disagreeing sort order that document forbids: it both duplicates the
/// ordering work and answers a different question, and its top-N window could
/// exclude a session that was created recently but never touched again. Do not
/// add a sort/max_by_key back; if a future reader needs different semantics,
/// change the storage layer's ORDER BY, not this caller.
///
/// The v1-id preference below is a SELECTION, not a re-sort: both
/// `urn:sovereign:session:v1:`-prefixed and legacy unprefixed session ids are
/// live in the same table, and a v1 id is preferred over a legacy one when both
/// are present. `pick_latest_session_id` implements this as first-match scans
/// over the order already given (first v1-prefixed row, else the first row of
/// any shape) — never "take the first row" outright, and never a fold/max over
/// the whole list. It lives in `pure.rs` so it is natively unit-tested; this
/// module is wasm32-only and cannot host a `#[cfg(test)]` that runs on `cargo
/// test --lib`.
fn latest_session_id_with_v1_preference(limit: u32) -> Option<String> {
    let sessions: Vec<serde_json::Value> = tractor_bridge::query_nodes("Session", limit)
        .ok()?
        .nodes
        .iter()
        .filter_map(|raw| serde_json::from_str::<serde_json::Value>(raw).ok())
        .collect();

    pick_latest_session_id(&sessions, SESSION_PREFIX_V1)
}

/// Create and persist a new Session. Returns the session `@id`.
fn store_new_session(name: Option<&str>) -> Option<String> {
    let session_id = new_session_id();
    let node = session_node(&session_id, name, None, None, now_ns(), None);
    tractor_bridge::store_node(&node.to_string()).ok()?;
    Some(session_id)
}

fn latest_session_id(limit: u32) -> Option<String> {
    latest_session_id_with_v1_preference(limit)
}

/// Select the current session's leaf entry id from the Session rows the storage
/// layer returned.
///
/// NO SORT HERE, DELIBERATELY, for the same reason as
/// `latest_session_id_with_v1_preference` above: `sessions` already arrives
/// newest-TOUCHED-first (`ORDER BY updated_at DESC, id DESC`,
/// `docs/SOVEREIGN_RECORD_ORDERING.md`), and the previous shape of this function
/// re-derived "newest" via `max_by_key(created_at_ns)` — a second, disagreeing sort
/// order over the same rows this sibling function reads. Two functions answering
/// adjacent questions about the same table must not each invent their own notion
/// of "latest"; both now trust the one order SQL already gave.
///
/// `pick_latest_session_leaf_id` implements the corrected shape: the
/// `leaf_entry_id` of the FIRST row in that order that actually has one (a
/// freshly-created session with no entries yet is skipped in favour of the next
/// most-recently-touched session that has a leaf — unchanged from before). Unlike
/// `pick_latest_session_id`, there is no v1-prefix preference to apply here: this
/// never compares session ids, it only reads a field off whichever row is first
/// among the ones that have it. Lives in `pure.rs` for the same native-testability
/// reason as its sibling.
fn latest_session_leaf_id(limit: u32) -> Option<String> {
    let sessions: Vec<serde_json::Value> = tractor_bridge::query_nodes("Session", limit)
        .ok()?
        .nodes
        .iter()
        .filter_map(|raw| serde_json::from_str::<serde_json::Value>(raw).ok())
        .collect();

    pick_latest_session_leaf_id(&sessions)
}

/// Append a SessionEntry under `session_id`, wiring `parent_entry_id` from the
/// current `leaf_entry_id` read from the stored Session node. Updates the session
/// leaf pointer after successful store. Returns the new entry `@id`.
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

    let entry_id = new_entry_id_for_session(session_id);
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

// fork_session / navigate_session / get_or_create_session_id_readonly were removed
// with the agent's session-tree model tools (list/current/navigate/fork): inspecting
// and reparenting the conversation tree is an OPERATOR action (the CLI's `refarm tree`
// / `sessions` commands own it), never a model-invokable one. The runtime keeps only
// the session bookkeeping it needs to append turns (get_or_create_session below).

/// Return the active session ID for this agent instance.
///
/// Priority:
///   1. `MODEL_SESSION_ID` env var — explicit override (e.g. tractor passes it per-call)
///   2. Most recently created Session node in the CRDT — resume across restarts
///   3. Create a fresh Session — first run in this namespace
///
/// When `MODEL_SESSION_ID` names a session not yet in the CRDT (first call on a
/// CLI-generated ID), the Session node is created here so `append_to_session`
/// can maintain the `leaf_entry_id` chain.
pub(crate) fn get_or_create_session() -> String {
    if let Ok(id) = std::env::var("MODEL_SESSION_ID") {
        if !id.is_empty() {
            if tractor_bridge::get_node(&id).is_err() {
                // Bound first: `declared_workspace()` returns owned Strings, and
                // `session_node` borrows. Inlining the call would drop the temporary
                // while the borrow is still live.
                let declared = declared_workspace();
                let workspace = declared
                    .as_ref()
                    .map(|(id, source)| (id.as_str(), source.as_str()));
                let node = session_node(&id, None, None, None, now_ns(), workspace);
                let _ = tractor_bridge::store_node(&node.to_string());
            }
            return id;
        }
    }

    if let Some(latest_id) = latest_session_id(20) {
        return latest_id;
    }

    store_new_session(None).unwrap_or_else(new_session_id)
}

/// The workspace attribution declared for THIS call, or `None`.
///
/// Read only where a Session node is CREATED. An existing session keeps whatever it was
/// created with: the declaration is the session's, not the dispatch's, so a later run from
/// another directory cannot silently re-attribute a conversation already under way.
///
/// Both or neither: `workspace_id` and `workspace_source` are a pair, exactly like the two
/// keys `session_node` inserts together (see `pure.rs`). An id arriving with no provenance
/// is not defaulted to `"declared"` — that would fail toward the STRONGER claim on a
/// distinction the design treats as load-bearing (ADR-094 H2: cwd-seeded is not policy
/// truth). The CLI always sends both, so this changes no working path; it only closes a
/// way for a non-CLI caller to get a mislabelled human declaration.
fn declared_workspace() -> Option<(String, String)> {
    let id = std::env::var("MODEL_WORKSPACE_ID")
        .ok()
        .filter(|v| !v.trim().is_empty())?;
    let source = std::env::var("MODEL_WORKSPACE_SOURCE")
        .ok()
        .filter(|v| !v.trim().is_empty())?;
    Some((id, source))
}

/// Try to build history by walking the active Session's entry tree.
/// Returns None when no Session exists (falls back to timestamp-sort).
fn query_history_from_session(max_turns: usize) -> Option<Vec<(String, String)>> {
    let leaf_id = latest_session_leaf_id(10)?;

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
/// Controlled by MODEL_HISTORY_TURNS env var (default: 0 = disabled).
/// Returns up to that many (role, content) pairs, oldest first.
pub(crate) fn query_history() -> Vec<(String, String)> {
    let max_turns = std::env::var("MODEL_HISTORY_TURNS")
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
    let mut nodes = tractor_bridge::query_nodes("UserPrompt", limit)
        .map(|page| page.nodes)
        .unwrap_or_default();
    nodes.extend(
        tractor_bridge::query_nodes("Response", limit)
            .map(|page| page.nodes)
            .unwrap_or_default(),
    );
    history_from_nodes(&nodes, max_turns)
}

/// Walk the current session chain returning the raw SessionEntry JSONs, oldest-first,
/// up to `max_turns` user/agent entries. This is the entry-preserving twin of
/// `query_history_from_session` (which throws away everything but role+content) — the
/// fold record needs the ids/timestamps/parentage, so it reads the full entries.
fn session_entries_oldest_first(max_turns: usize) -> Vec<serde_json::Value> {
    let Some(leaf_id) = latest_session_leaf_id(10) else {
        return vec![];
    };
    let mut chain: Vec<serde_json::Value> = Vec::new();
    let mut current = Some(leaf_id);
    while let Some(id) = current.take() {
        if chain.len() >= max_turns {
            break;
        }
        let Ok(raw) = tractor_bridge::get_node(&id) else {
            break;
        };
        let Ok(v) = serde_json::from_str::<serde_json::Value>(&raw) else {
            break;
        };
        let kind = v["kind"].as_str().unwrap_or("");
        current = v["parent_entry_id"].as_str().map(|s| s.to_owned());
        if kind == "user" || kind == "agent" {
            chain.push(v);
        }
    }
    chain.reverse();
    chain
}

/// Record a reversible `SessionContextFold` for the turns a compaction folded, so the
/// dropped-from-prompt turns remain reconstructable (a TS `unfoldSessionContextFold`
/// can rebuild them from the CRDT and verify their digests). Called from the context
/// seam AFTER it decides a fold happened; `folded_pair_count` is how many of the
/// oldest role/content pairs were folded away (the split `compact_history` chose).
///
/// No-op (returns None) when nothing was folded or the session can't be read — the
/// fold is a durable side-record, never a hard dependency of the turn.
pub(crate) fn record_context_fold(
    folded_pair_count: usize,
    summary: Option<&str>,
) -> Option<String> {
    if folded_pair_count == 0 {
        return None;
    }
    let max_turns = std::env::var("MODEL_HISTORY_TURNS")
        .ok()
        .and_then(|v| v.parse::<usize>().ok())
        .unwrap_or(0);
    if max_turns == 0 {
        return None;
    }
    let entries = session_entries_oldest_first(max_turns);
    if entries.len() < folded_pair_count {
        return None; // can't map the pair split onto entries — skip silently
    }
    let (folded, tail) = entries.split_at(folded_pair_count);
    let tail_ids: Vec<String> = tail
        .iter()
        .filter_map(|e| e.get("@id").and_then(|v| v.as_str()).map(|s| s.to_string()))
        .collect();
    let fold = super::build_session_context_fold(folded, &tail_ids, summary, now_ns())?;
    let fold_id = fold.get("@id").and_then(|v| v.as_str()).map(|s| s.to_string());
    let _ = tractor_bridge::store_node(&fold.to_string());
    fold_id
}

/// Returns true when `MODEL_BUDGET_<PROVIDER>_USD` is set and the rolling 30-day
/// spend for `provider_name` (read from CRDT UsageRecord nodes) meets or exceeds it.
pub(crate) fn budget_exceeded_for_provider(provider_name: &str) -> bool {
    let budget_key = format!("MODEL_BUDGET_{}_USD", provider_name.to_uppercase());
    let Ok(budget_str) = std::env::var(&budget_key) else {
        return false;
    };
    let Ok(budget) = budget_str.parse::<f64>() else {
        return false;
    };
    let records = tractor_bridge::query_nodes("UsageRecord", 10_000)
        .map(|page| page.nodes)
        .unwrap_or_default();
    const WINDOW_30D_NS: u64 = 30 * 24 * 3600 * 1_000_000_000;
    sum_provider_spend_usd(&records, provider_name, now_ns(), WINDOW_30D_NS) >= budget
}
