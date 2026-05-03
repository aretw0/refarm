use crate::refarm::plugin::tractor_bridge;

pub(crate) fn list_tasks(input: &serde_json::Value) -> String {
    let limit = input["limit"].as_u64().unwrap_or(20).min(100) as u32;
    let status_filter = input["status"].as_str();
    let context_filter = input["context_id"].as_str();

    let nodes = tractor_bridge::query_nodes("Task", limit).unwrap_or_default();
    let items: Vec<serde_json::Value> = nodes
        .iter()
        .filter_map(|raw| serde_json::from_str::<serde_json::Value>(raw).ok())
        .filter(|v| status_filter.map_or(true, |s| v["status"].as_str() == Some(s)))
        .filter(|v| context_filter.map_or(true, |c| v["context_id"].as_str() == Some(c)))
        .map(|v| serde_json::json!({
            "id":            v["@id"],
            "title":         v["title"],
            "status":        v["status"],
            "created_at_ns": v["created_at_ns"],
            "updated_at_ns": v["updated_at_ns"],
            "context_id":    v["context_id"],
            "assigned_to":   v["assigned_to"],
        }))
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

    // Fetch TaskEvents for this task.
    let events: Vec<serde_json::Value> = tractor_bridge::query_nodes("TaskEvent", 50)
        .unwrap_or_default()
        .iter()
        .filter_map(|r| serde_json::from_str::<serde_json::Value>(r).ok())
        .filter(|e| e["task_id"].as_str() == Some(id))
        .collect();

    serde_json::to_string_pretty(&serde_json::json!({
        "id":            task["@id"],
        "title":         task["title"],
        "status":        task["status"],
        "created_at_ns": task["created_at_ns"],
        "updated_at_ns": task["updated_at_ns"],
        "context_id":    task["context_id"],
        "assigned_to":   task["assigned_to"],
        "events":        events.iter().map(|e| serde_json::json!({
            "event":        e["event"],
            "actor":        e["actor"],
            "timestamp_ns": e["timestamp_ns"],
            "payload":      e["payload"],
        })).collect::<Vec<_>>(),
    }))
    .unwrap_or_default()
}
