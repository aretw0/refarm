/// Phase 5 integration tests — Loro CRDT convergence.
///
/// Tests two-peer CRDT sync scenarios:
///   peer-a stores nodes → get_update() → peer-b apply_update() → converge
///
/// Also exercises: on_update subscription, snapshot roundtrip, multi-node convergence.

use tractor_native::{NativeStorage, NativeSync};

fn make_sync(peer: &str) -> NativeSync {
    let storage = NativeStorage::open(":memory:").unwrap();
    NativeSync::new(storage, peer).unwrap()
}

// ── Basic export/import ───────────────────────────────────────────────────────

#[test]
fn get_update_is_nonempty_after_store() {
    let sync = make_sync("t1");
    sync.store_node("urn:test:n1", "Note", None, "{}", None).unwrap();
    let bytes = sync.get_update().unwrap();
    assert!(!bytes.is_empty(), "LoroDoc must produce bytes after storing a node");
}

#[test]
fn get_update_bytes_are_importable_by_fresh_doc() {
    // Verify binary compatibility at the loro crate level
    let sync = make_sync("t2");
    sync.store_node("urn:test:n2", "Note", None, "{}", None).unwrap();
    let bytes = sync.get_update().unwrap();

    // Fresh LoroDoc from the loro crate must accept these bytes
    let fresh = loro::LoroDoc::new();
    fresh.import(&bytes).expect("bytes must be importable by a raw LoroDoc");
}

// ── Two-peer convergence ──────────────────────────────────────────────────────

#[test]
fn two_peers_converge_via_update() {
    let peer_a = make_sync("peer-a");
    let peer_b = make_sync("peer-b");

    peer_a.store_node("urn:test:shared-1", "Task", None, r#"{"done":false}"#, None).unwrap();

    // B starts empty
    assert!(peer_b.get_node("urn:test:shared-1").unwrap().is_none());

    // Exchange A → B
    let bytes = peer_a.get_update().unwrap();
    peer_b.apply_update(&bytes).unwrap();

    // B read model converges
    let node = peer_b.get_node("urn:test:shared-1").unwrap();
    assert!(node.is_some(), "peer-b must have node after apply_update");
    assert_eq!(peer_b.query_nodes("Task").unwrap().len(), 1);
}

#[test]
fn multi_node_convergence() {
    let peer_a = make_sync("peer-a2");
    let peer_b = make_sync("peer-b2");

    for i in 0..5 {
        peer_a.store_node(
            &format!("urn:test:node-{i}"),
            "Article",
            None,
            "{}",
            None,
        ).unwrap();
    }

    let bytes = peer_a.get_update().unwrap();
    peer_b.apply_update(&bytes).unwrap();

    let rows = peer_b.query_nodes("Article").unwrap();
    assert_eq!(rows.len(), 5, "all 5 articles must converge to peer-b");
}

// ── on_update subscription ────────────────────────────────────────────────────

#[test]
fn on_update_callback_fires_with_bytes() {
    use std::sync::{Arc, Mutex};

    let sync = make_sync("sub-test");
    let captured: Arc<Mutex<Vec<Vec<u8>>>> = Arc::new(Mutex::new(Vec::new()));
    let cap2 = captured.clone();

    sync.on_update(move |b| { cap2.lock().unwrap().push(b); });
    sync.store_node("urn:test:ev-1", "Event", None, "{}", None).unwrap();

    let calls = captured.lock().unwrap();
    assert!(!calls.is_empty(), "on_update must fire at least once");
    assert!(!calls[0].is_empty(), "callback must receive non-empty bytes");
}

// ── Snapshot roundtrip ────────────────────────────────────────────────────────

#[test]
fn snapshot_export_import_roundtrip() {
    let peer_a = make_sync("snap-src");
    peer_a.store_node("urn:test:s1", "Doc", None, r#"{"v":1}"#, None).unwrap();
    peer_a.store_node("urn:test:s2", "Doc", None, r#"{"v":2}"#, None).unwrap();

    let snapshot = peer_a.export_snapshot().unwrap();
    assert!(!snapshot.is_empty());

    let peer_b = make_sync("snap-dst");
    peer_b.import_snapshot(&snapshot).unwrap();

    assert!(peer_b.get_node("urn:test:s1").unwrap().is_some());
    assert!(peer_b.get_node("urn:test:s2").unwrap().is_some());
    assert_eq!(peer_b.query_nodes("Doc").unwrap().len(), 2);
}

// ── Idempotency ───────────────────────────────────────────────────────────────

#[test]
fn apply_update_is_idempotent() {
    let peer_a = make_sync("idem-a");
    let peer_b = make_sync("idem-b");

    peer_a.store_node("urn:test:id-1", "Note", None, "{}", None).unwrap();
    let bytes = peer_a.get_update().unwrap();

    peer_b.apply_update(&bytes).unwrap();
    peer_b.apply_update(&bytes).unwrap(); // second application — must not duplicate

    let rows = peer_b.query_nodes("Note").unwrap();
    assert_eq!(rows.len(), 1, "idempotent: second apply must not duplicate the node");
}
