use crate::refarm::plugin::tractor_bridge;

pub(crate) fn list_sessions() -> String {
    let sessions = tractor_bridge::query_nodes("Session", 50).unwrap_or_default();
    let active_id = crate::get_or_create_session_id_readonly();
    let items: Vec<serde_json::Value> = sessions
        .iter()
        .filter_map(|raw| serde_json::from_str::<serde_json::Value>(raw).ok())
        .map(|v| {
            serde_json::json!({
                "id":            v["@id"],
                "name":          v["name"],
                "leaf_entry_id": v["leaf_entry_id"],
                "created_at_ns": v["created_at_ns"],
                "is_active":     v["@id"].as_str() == Some(&active_id),
            })
        })
        .collect();
    serde_json::to_string_pretty(&items).unwrap_or_else(|_| "[]".into())
}

pub(crate) fn current_session() -> String {
    let session_id = crate::get_or_create_session();
    match tractor_bridge::get_node(&session_id) {
        Ok(raw) => {
            let v: serde_json::Value = serde_json::from_str(&raw).unwrap_or_default();
            serde_json::to_string_pretty(&serde_json::json!({
                "id":            v["@id"],
                "name":          v["name"],
                "leaf_entry_id": v["leaf_entry_id"],
                "created_at_ns": v["created_at_ns"],
            }))
            .unwrap_or_default()
        }
        Err(e) => format!("[error] current_session: {e:?}"),
    }
}

pub(crate) fn navigate(input: &serde_json::Value) -> String {
    let session_id = input["session_id"].as_str().unwrap_or("");
    let entry_id = input["entry_id"].as_str().unwrap_or("");
    if session_id.is_empty() || entry_id.is_empty() {
        return "[error] navigate requires session_id and entry_id".into();
    }
    match crate::navigate_session(session_id, entry_id) {
        Ok(()) => format!("navigated session {session_id} to entry {entry_id}"),
        Err(e) => format!("[error] {e}"),
    }
}

pub(crate) fn fork(input: &serde_json::Value) -> String {
    let session_id = input["session_id"].as_str().unwrap_or("");
    let entry_id = input["entry_id"].as_str().unwrap_or("");
    let name = input["name"].as_str();
    if session_id.is_empty() || entry_id.is_empty() {
        return "[error] fork requires session_id and entry_id".into();
    }
    match crate::fork_session(session_id, entry_id, name) {
        Some(new_id) => format!("forked → new session {new_id}"),
        None => "[error] fork: failed to create session".into(),
    }
}
