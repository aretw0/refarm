use crate::plugin::host::tractor_bridge;
use crate::session::describe_event_completeness;

/// How many TaskEvents one `task_status` read asks for. The query limits GLOBALLY and the
/// per-task filter runs afterwards, so this is a ceiling on what the filter can even SEE, not on
/// what it returns — which is why the read reports its own completeness (ISS-045).
const TASK_EVENT_QUERY_LIMIT: u32 = 500;



pub(crate) fn list_tasks(input: &serde_json::Value) -> String {
    let limit = input["limit"].as_u64().unwrap_or(20).min(100) as u32;
    let status_filter = input["status"].as_str();
    let context_filter = input["context_id"].as_str();

    let nodes = tractor_bridge::query_nodes("Task", limit)
        .map(|page| page.nodes)
        .unwrap_or_default();
    let items: Vec<serde_json::Value> = nodes
        .iter()
        .filter_map(|raw| serde_json::from_str::<serde_json::Value>(raw).ok())
        .filter(|v| status_filter.map_or(true, |s| v["status"].as_str() == Some(s)))
        .filter(|v| context_filter.map_or(true, |c| v["context_id"].as_str() == Some(c)))
        .map(|v| {
            serde_json::json!({
                "id":            v["@id"],
                "title":         v["title"],
                "status":        v["status"],
                "created_at_ns": v["created_at_ns"],
                "updated_at_ns": v["updated_at_ns"],
                "context_id":    v["context_id"],
                "assigned_to":   v["assigned_to"],
            })
        })
        .collect();
    serde_json::to_string_pretty(&items).unwrap_or_else(|_| "[]".into())
}

pub(crate) fn task_status(input: &serde_json::Value) -> String {
    let id = match input["task_id"].as_str() {
        Some(id) if !id.is_empty() => id,
        _ => return "[error] task_status requires task_id".into(),
    };

    let id_owned = id.to_string();
    let raw = match tractor_bridge::get_node(&id_owned) {
        Ok(r) => r,
        Err(e) => return format!("[error] task not found: {e:?}"),
    };

    let task: serde_json::Value = serde_json::from_str(&raw).unwrap_or_default();

    // TaskEvents for this task — and WHETHER THAT LIST IS THE WHOLE TRUTH.
    //
    // The query limits GLOBALLY and the filter runs afterwards, so "the newest 50 TaskEvents in
    // the store" is not "the newest 50 events of this task". An older task whose events sit past
    // that window came back with `events: []` — reported as a FACT, and indistinguishable from a
    // task that genuinely has none, while the sidecar reported all of them (ISS-045).
    //
    // Three states, never two. The page already says whether it was truncated; nothing read it.
    // An empty list from a truncated page is "not in the window I could see", which is a
    // different answer from "there are none", and the caller here is a model — the one reader
    // most likely to state an absence as a finding.
    let page = tractor_bridge::query_nodes("TaskEvent", TASK_EVENT_QUERY_LIMIT).ok();
    let truncated = page.as_ref().map(|p| p.truncated).unwrap_or(false);
    let events: Vec<serde_json::Value> = page
        .map(|p| p.nodes)
        .unwrap_or_default()
        .iter()
        .filter_map(|r| serde_json::from_str::<serde_json::Value>(r).ok())
        .filter(|e| e["task_id"].as_str() == Some(id))
        .collect();
    let events_complete = describe_event_completeness(events.len(), truncated);

    serde_json::to_string_pretty(&serde_json::json!({
        "id":            task["@id"],
        "title":         task["title"],
        "status":        task["status"],
        "created_at_ns": task["created_at_ns"],
        "updated_at_ns": task["updated_at_ns"],
        "context_id":    task["context_id"],
        "assigned_to":   task["assigned_to"],
        // Absent when the read was complete; present and explicit when it was not. A key that
        // only appears on an incomplete answer cannot be mistaken for decoration.
        "events_complete": events_complete,
        "events":        events.iter().map(|e| serde_json::json!({
            "event":        e["event"],
            "actor":        e["actor"],
            "timestamp_ns": e["timestamp_ns"],
            "payload":      e["payload"],
        })).collect::<Vec<_>>(),
    }))
    .unwrap_or_default()
}
