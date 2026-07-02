use super::*;

fn make_entry(id: &str, sid: &str, parent: Option<&str>, kind: &str, content: &str) -> String {
    session_entry_node(id, sid, parent, kind, content, 0).to_string()
}

#[test]
fn tree_walk_linear_chain() {
    let nodes = vec![
        make_entry("urn:e1", "urn:s1", None, "user", "hello"),
        make_entry("urn:e2", "urn:s1", Some("urn:e1"), "agent", "world"),
        make_entry("urn:e3", "urn:s1", Some("urn:e2"), "user", "more"),
    ];
    let history = history_from_tree(&nodes, "urn:e3", 10);
    assert_eq!(history.len(), 3);
    assert_eq!(history[0], ("user".into(), "hello".into())); // oldest first
    assert_eq!(history[1], ("assistant".into(), "world".into()));
    assert_eq!(history[2], ("user".into(), "more".into()));
}

#[test]
fn tree_walk_caps_at_max_turns() {
    let nodes: Vec<String> = (1..=10_u8)
        .map(|i| {
            let id = format!("urn:e{i:02}");
            let parent = if i == 1 {
                None
            } else {
                Some(format!("urn:e{:02}", i - 1))
            };
            make_entry(&id, "urn:s1", parent.as_deref(), "user", &format!("msg{i}"))
        })
        .collect();
    let history = history_from_tree(&nodes, "urn:e10", 4);
    assert_eq!(history.len(), 4);
    assert_eq!(history[0].1, "msg7"); // oldest of the last 4
    assert_eq!(history[3].1, "msg10");
}

#[test]
fn tree_walk_skips_tool_entries() {
    let nodes = vec![
        make_entry("urn:e1", "urn:s1", None, "user", "q"),
        make_entry("urn:e2", "urn:s1", Some("urn:e1"), "tool_call", "tool"),
        make_entry("urn:e3", "urn:s1", Some("urn:e2"), "agent", "answer"),
    ];
    let history = history_from_tree(&nodes, "urn:e3", 10);
    assert_eq!(history.len(), 2, "tool_call must be skipped");
    assert_eq!(history[0].0, "user");
    assert_eq!(history[1].0, "assistant");
}

#[test]
fn tree_walk_only_active_branch() {
    // Branch A: e1 → e2a; Branch B: e1 → e2b (navigate back, new msg)
    let nodes = vec![
        make_entry("urn:e1", "urn:s1", None, "user", "start"),
        make_entry("urn:e2a", "urn:s1", Some("urn:e1"), "agent", "path A"),
        make_entry("urn:e2b", "urn:s1", Some("urn:e1"), "agent", "path B"),
    ];
    // leaf = e2b (user navigated back and chose path B)
    let history = history_from_tree(&nodes, "urn:e2b", 10);
    assert_eq!(history.len(), 2);
    assert_eq!(history[0].1, "start");
    assert_eq!(history[1].1, "path B"); // e2a NOT included
}
