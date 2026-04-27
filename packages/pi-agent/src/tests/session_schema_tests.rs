use super::*;

#[test]
fn session_node_has_required_fields() {
    let ts = 1_700_000_000_000_000_000_u64;
    let node = session_node("urn:pi-agent:session-abc", Some("test"), None, None, ts);
    assert_eq!(node["@type"], "Session");
    assert_eq!(node["@id"], "urn:pi-agent:session-abc");
    assert_eq!(node["name"], "test");
    assert!(
        node["leaf_entry_id"].is_null(),
        "new session has no leaf yet"
    );
    assert!(
        node["parent_session_id"].is_null(),
        "root session has no parent"
    );
    assert_eq!(node["created_at_ns"], ts);
}

#[test]
fn session_node_with_leaf_and_parent() {
    let node = session_node(
        "urn:pi-agent:session-fork",
        Some("fork"),
        Some("urn:pi-agent:entry-42"),
        Some("urn:pi-agent:session-root"),
        42,
    );
    assert_eq!(node["leaf_entry_id"], "urn:pi-agent:entry-42");
    assert_eq!(node["parent_session_id"], "urn:pi-agent:session-root");
}

#[test]
fn session_entry_node_root_has_null_parent() {
    let entry = session_entry_node(
        "urn:pi-agent:entry-001",
        "urn:pi-agent:session-s1",
        None,
        "user",
        "hello",
        100,
    );
    assert_eq!(entry["@type"], "SessionEntry");
    assert_eq!(entry["@id"], "urn:pi-agent:entry-001");
    assert_eq!(entry["session_id"], "urn:pi-agent:session-s1");
    assert!(
        entry["parent_entry_id"].is_null(),
        "root entry has no parent"
    );
    assert_eq!(entry["kind"], "user");
    assert_eq!(entry["content"], "hello");
    assert_eq!(entry["timestamp_ns"], 100);
}

#[test]
fn session_entry_chain_has_correct_parents() {
    let e1 = session_entry_node(
        "urn:pi-agent:entry-001",
        "urn:pi-agent:session-s1",
        None,
        "user",
        "hi",
        10,
    );
    let e2 = session_entry_node(
        "urn:pi-agent:entry-002",
        "urn:pi-agent:session-s1",
        Some("urn:pi-agent:entry-001"),
        "agent",
        "hello",
        20,
    );
    let e3 = session_entry_node(
        "urn:pi-agent:entry-003",
        "urn:pi-agent:session-s1",
        Some("urn:pi-agent:entry-002"),
        "user",
        "more",
        30,
    );

    assert!(e1["parent_entry_id"].is_null());
    assert_eq!(e2["parent_entry_id"], "urn:pi-agent:entry-001");
    assert_eq!(e3["parent_entry_id"], "urn:pi-agent:entry-002");
}

#[test]
fn session_entry_branch_shares_ancestor() {
    // Two branches from the same parent — simulates navigate-back + new message
    let root = session_entry_node(
        "urn:pi-agent:entry-root",
        "urn:pi-agent:session-s1",
        None,
        "user",
        "start",
        1,
    );
    let branch_a = session_entry_node(
        "urn:pi-agent:entry-a",
        "urn:pi-agent:session-s1",
        Some("urn:pi-agent:entry-root"),
        "agent",
        "path A",
        2,
    );
    let branch_b = session_entry_node(
        "urn:pi-agent:entry-b",
        "urn:pi-agent:session-s1",
        Some("urn:pi-agent:entry-root"),
        "agent",
        "path B",
        3,
    );

    // Both branches reference the same root parent
    assert_eq!(branch_a["parent_entry_id"], root["@id"]);
    assert_eq!(branch_b["parent_entry_id"], root["@id"]);
    // But have different identities
    assert_ne!(branch_a["@id"], branch_b["@id"]);
}

#[test]
fn fork_session_node_has_correct_fields() {
    // Simulate fork: new session pointing to ancestor entry
    let forked = session_node(
        "urn:pi-agent:session-fork",
        Some("my fork"),
        Some("urn:pi-agent:entry-ancestor"),
        Some("urn:pi-agent:session-origin"),
        999,
    );
    assert_eq!(forked["@type"], "Session");
    assert_eq!(forked["parent_session_id"], "urn:pi-agent:session-origin");
    assert_eq!(forked["leaf_entry_id"], "urn:pi-agent:entry-ancestor");
    assert_eq!(forked["name"], "my fork");
}

#[test]
fn navigate_updates_leaf_in_node() {
    // Navigate is a pure JSON patch — verify field semantics
    let mut session = session_node("urn:pi-agent:session-s1", None, None, None, 1);
    assert!(session["leaf_entry_id"].is_null());

    // Simulate navigate by patching leaf_entry_id (as navigate_session does)
    session["leaf_entry_id"] = serde_json::Value::String("urn:pi-agent:entry-42".into());
    assert_eq!(session["leaf_entry_id"], "urn:pi-agent:entry-42");

    // Navigate is idempotent: same entry twice is fine
    session["leaf_entry_id"] = serde_json::Value::String("urn:pi-agent:entry-42".into());
    assert_eq!(session["leaf_entry_id"], "urn:pi-agent:entry-42");
}

