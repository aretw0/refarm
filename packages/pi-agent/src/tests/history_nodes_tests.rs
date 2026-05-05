use super::*;

#[test]
fn history_from_nodes_sorts_by_timestamp_and_caps_turns() {
    let now = now_ns();
    let nodes = vec![
        serde_json::json!({"@type":"AgentResponse","content":"resp1","timestamp_ns":now+200})
            .to_string(),
        serde_json::json!({"@type":"UserPrompt",   "content":"q2",   "timestamp_ns":now+100})
            .to_string(),
        serde_json::json!({"@type":"UserPrompt",   "content":"q1",   "timestamp_ns":now+10 })
            .to_string(),
    ];
    let h = history_from_nodes(&nodes, 10);
    assert_eq!(h.len(), 3);
    assert_eq!(h[0], ("user".into(), "q1".into()));
    assert_eq!(h[1], ("user".into(), "q2".into()));
    assert_eq!(h[2], ("assistant".into(), "resp1".into()));
}

#[test]
fn history_from_nodes_caps_at_max_turns() {
    let now = now_ns();
    let nodes: Vec<String> = (0..8u64)
        .map(|i| {
            serde_json::json!({"@type":"UserPrompt","content":format!("q{i}"),"timestamp_ns":now+i})
                .to_string()
        })
        .collect();
    let h = history_from_nodes(&nodes, 3);
    assert_eq!(h.len(), 3);
    assert_eq!(h[2].1, "q7"); // most recent
}

#[test]
fn history_from_nodes_skips_unknown_types() {
    let now = now_ns();
    let nodes = vec![
        serde_json::json!({"@type":"UsageRecord","content":"ignored","timestamp_ns":now})
            .to_string(),
        serde_json::json!({"@type":"UserPrompt", "content":"ok",     "timestamp_ns":now+1})
            .to_string(),
    ];
    let h = history_from_nodes(&nodes, 10);
    assert_eq!(h.len(), 1);
    assert_eq!(h[0].1, "ok");
}

#[test]
fn history_from_nodes_returns_empty_for_empty_input() {
    let h = history_from_nodes(&[], 10);
    assert!(h.is_empty());
}

#[test]
fn history_disabled_by_default_when_env_unset() {
    // LLM_HISTORY_TURNS defaults to 0 — no history injected without opt-in.
    // history_from_nodes with max_turns=0 must return empty regardless of records.
    let now = now_ns();
    let nodes = vec![
        serde_json::json!({"@type":"UserPrompt","content":"q","timestamp_ns":now}).to_string(),
    ];
    let h = history_from_nodes(&nodes, 0);
    assert!(h.is_empty(), "max_turns=0 must produce empty history");
}
