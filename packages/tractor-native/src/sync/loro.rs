//! NativeSync — Loro CRDT engine + CQRS read model.
//!
//! Write model:  loro::LoroDoc (conflict-free binary delta sync)
//! Read model:   NativeStorage (rusqlite, SQL-queryable)
//! Projection:   store_node → eager mirror; apply_update → project_all()
//!
//! Binary-compatible with loro-crdt JS (loro-crdt@1.10.7).

use anyhow::{anyhow, Result};
use loro::{ExportMode, LoroDoc, LoroValue, Subscription, ValueOrContainer};
use std::sync::{Arc, Mutex};
use crate::storage::NativeStorage;

/// Peer ID derived from namespace — stable across restarts.
/// Uses first 8 bytes of SHA-256(namespace).
/// NOTE: TypeScript peerIdFromString() uses a multiply-hash — cross-stack peer IDs will differ.
/// Cross-stack binary compatibility is a Phase 8 (Conformance Tests) concern.
fn peer_id_from_namespace(namespace: &str) -> u64 {
    use sha2::{Digest, Sha256};
    let hash = Sha256::digest(namespace.as_bytes());
    u64::from_be_bytes(hash[..8].try_into().expect("SHA-256 is 32 bytes"))
}

/// Loro CRDT storage with CQRS read model.
///
/// Clone is O(1): all fields are `Arc<T>`.
#[derive(Clone)]
pub struct NativeSync {
    storage: NativeStorage,
    doc: Arc<LoroDoc>,
    /// Subscriptions kept alive for the lifetime of NativeSync.
    update_subs: Arc<Mutex<Vec<Subscription>>>,
    /// Single broadcast subscription slot used by WsServer.
    /// Replacing this drops the previous Subscription, cancelling it.
    ws_broadcast_sub: Arc<Mutex<Option<Subscription>>>,
}

impl std::fmt::Debug for NativeSync {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("NativeSync")
            .field("storage", &self.storage)
            .finish_non_exhaustive()
    }
}

impl NativeSync {
    /// Create a new NativeSync.
    /// `namespace` is used to derive a stable uint64 peer ID (sha2 of the string).
    pub fn new(storage: NativeStorage, namespace: &str) -> Result<Self> {
        let doc = LoroDoc::new();
        doc.set_peer_id(peer_id_from_namespace(namespace))
            .map_err(|e| anyhow!("set_peer_id: {e:?}"))?;
        Ok(Self {
            storage,
            doc: Arc::new(doc),
            update_subs: Arc::new(Mutex::new(Vec::new())),
            ws_broadcast_sub: Arc::new(Mutex::new(None)),
        })
    }

    pub fn store_node(
        &self,
        id: &str,
        type_: &str,
        context: Option<&str>,
        payload: &str,
        source_plugin: Option<&str>,
    ) -> Result<()> {
        // Write model: serialize node to JSON and insert into LoroDoc map "nodes"
        let json = serde_json::json!({
            "id": id,
            "type": type_,
            "context": context,
            "payload": payload,
            "sourcePlugin": source_plugin,
        });
        let nodes_map = self.doc.get_map("nodes");
        let s = json.to_string();
        nodes_map
            .insert(id, s.as_str())
            .map_err(|e| anyhow!("loro map insert: {e:?}"))?;
        self.doc.commit();

        // Eager projection to read model (CQRS)
        self.storage.store_node(id, type_, context, payload, source_plugin)?;
        Ok(())
    }

    pub fn get_node(&self, id: &str) -> Result<Option<String>> {
        self.storage.get_node(id)
    }

    pub fn query_nodes(&self, type_: &str) -> Result<Vec<crate::storage::NodeRow>> {
        self.storage.query_nodes(type_)
    }

    /// Rebuild SQLite read model from current LoroDoc state.
    /// Called after apply_update() or import_snapshot() to sync the read model.
    /// Mirrors Projector.rebuildAll() from packages/sync-loro/src/projector.ts.
    /// Never panics — logs errors and continues (CRDT must not crash).
    fn project_all(&self) -> Result<()> {
        let nodes_map = self.doc.get_map("nodes");

        // Collect keys first to avoid borrow checker issues with simultaneous
        // keys() iterator and get() calls on the same LoroMap.
        let keys: Vec<String> = nodes_map.keys()
            .map(|k| k.as_str().to_owned())
            .collect();

        for key in keys {
            let raw_json = match nodes_map.get(&key) {
                Some(ValueOrContainer::Value(LoroValue::String(s))) => s.to_string(),
                Some(_) => {
                    tracing::warn!("project_all: unexpected value type for key {key}");
                    continue;
                }
                None => continue, // deleted
            };

            let node: serde_json::Value = match serde_json::from_str(&raw_json) {
                Ok(v) => v,
                Err(e) => {
                    tracing::error!("project_all: invalid JSON for node {key}: {e}");
                    continue;
                }
            };

            let id      = node["id"].as_str().unwrap_or(&key);
            let type_   = node["type"].as_str().unwrap_or("");
            let context = node["context"].as_str();
            let payload = node["payload"].as_str().unwrap_or("{}");
            let source  = node["sourcePlugin"].as_str();

            // Must never crash the CRDT engine — mirror TypeScript's try/catch
            if let Err(e) = self.storage.store_node(id, type_, context, payload, source) {
                tracing::error!("project_all: failed to project node {key}: {e}");
            }
        }
        Ok(())
    }

    pub fn apply_update(&self, bytes: &[u8]) -> Result<()> {
        self.doc
            .import(bytes)
            .map_err(|e| anyhow!("loro import: {e:?}"))?;
        self.project_all()
    }

    pub fn get_update(&self) -> Result<Vec<u8>> {
        self.doc.export(ExportMode::all_updates())
            .map_err(|e| anyhow!("export failed: {e:?}"))
    }

    /// Subscribe to local CRDT updates (for WsServer broadcasting in Phase 6).
    /// The callback fires synchronously on each doc.commit().
    /// The subscription is kept alive for the lifetime of this NativeSync instance.
    pub fn on_update(&self, cb: impl Fn(Vec<u8>) + Send + Sync + 'static) {
        // NOTE: subscribe_local_update callback must return bool (true = stay subscribed)
        let sub = self.doc.subscribe_local_update(Box::new(move |bytes: &Vec<u8>| {
            cb(bytes.clone());
            true // always stay subscribed
        }));
        self.update_subs.lock().unwrap_or_else(|p| p.into_inner()).push(sub);
    }

    /// Register the WsServer broadcast callback (replaces any previous one).
    /// Called by WsServer::run() — cancels the stale subscription before installing a new one.
    pub fn set_broadcast_callback(&self, cb: impl Fn(Vec<u8>) + Send + Sync + 'static) {
        let sub = self.doc.subscribe_local_update(Box::new(move |bytes: &Vec<u8>| {
            cb(bytes.clone());
            true
        }));
        let mut slot = self.ws_broadcast_sub.lock().unwrap_or_else(|p| p.into_inner());
        *slot = Some(sub); // drops the previous Subscription, cancelling it
    }

    pub fn export_snapshot(&self) -> Result<Vec<u8>> {
        self.doc
            .export(ExportMode::Snapshot)
            .map_err(|e| anyhow!("snapshot export: {e:?}"))
    }

    /// Import a full snapshot exported via `export_snapshot()`.
    /// Note: `loro::LoroDoc::import()` accepts both delta and snapshot bytes — the format
    /// is self-describing. This method is semantically equivalent to `apply_update()` at
    /// the loro API level; the distinction is for API clarity only.
    pub fn import_snapshot(&self, bytes: &[u8]) -> Result<()> {
        self.doc
            .import(bytes)
            .map_err(|e| anyhow!("snapshot import: {e:?}"))?;
        self.project_all()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::NativeStorage;

    fn make_sync() -> NativeSync {
        let storage = NativeStorage::open(":memory:").unwrap();
        NativeSync::new(storage, ":memory:").unwrap()
    }

    #[test]
    fn sync_creates_with_loro_doc() {
        let sync = make_sync();
        let bytes = sync.get_update().expect("get_update");
        assert!(!bytes.is_empty(), "LoroDoc should export non-empty bytes even when empty");
        sync.store_node("urn:test:1", "Note", None, "{}", None).unwrap();
    }

    #[test]
    fn store_node_writes_to_loro_doc() {
        let sync = make_sync();
        sync.store_node("urn:test:node-1", "Note", None, r#"{"text":"hello"}"#, None).unwrap();

        // After store_node, the LoroDoc has content → export is non-empty
        let bytes = sync.get_update().unwrap();
        assert!(!bytes.is_empty(), "LoroDoc should have exported bytes after store_node");
    }

    #[test]
    fn on_update_fires_on_store() {
        use std::sync::{Arc, Mutex};

        let sync = make_sync();
        let fired: Arc<Mutex<Vec<Vec<u8>>>> = Arc::new(Mutex::new(Vec::new()));
        let fired_clone = fired.clone();

        sync.on_update(move |bytes| {
            fired_clone.lock().unwrap().push(bytes);
        });

        sync.store_node("urn:test:sub-1", "Note", None, "{}", None).unwrap();

        let calls = fired.lock().unwrap();
        assert!(!calls.is_empty(), "on_update callback must fire after store_node");
        assert!(!calls[0].is_empty(), "callback bytes must be non-empty");
    }

    #[test]
    fn apply_update_converges_read_model() {
        // Peer A stores a node
        let sync_a = {
            let st = NativeStorage::open(":memory:").unwrap();
            NativeSync::new(st, "peer-a").unwrap()
        };
        sync_a.store_node("urn:test:conv-1", "Task", None, r#"{"done":false}"#, None).unwrap();

        // Peer B starts empty
        let sync_b = {
            let st = NativeStorage::open(":memory:").unwrap();
            NativeSync::new(st, "peer-b").unwrap()
        };
        assert!(sync_b.get_node("urn:test:conv-1").unwrap().is_none(),
            "peer-b should start without the node");

        // Exchange: A → B
        let bytes = sync_a.get_update().unwrap();
        sync_b.apply_update(&bytes).unwrap();

        // Peer B read model must now have the node
        let node = sync_b.get_node("urn:test:conv-1").unwrap();
        assert!(node.is_some(), "peer-b should have node after apply_update");

        // Query by type must also work
        let rows = sync_b.query_nodes("Task").unwrap();
        assert_eq!(rows.len(), 1, "queryNodes should return 1 Task");
        assert_eq!(rows[0].id, "urn:test:conv-1");
    }

    #[test]
    fn snapshot_roundtrip() {
        let sync_a = {
            let st = NativeStorage::open(":memory:").unwrap();
            NativeSync::new(st, "snap-a").unwrap()
        };
        sync_a.store_node("urn:test:snap-1", "Article", None, r#"{"title":"test"}"#, None).unwrap();

        // Export snapshot from A
        let snap = sync_a.export_snapshot().unwrap();
        assert!(!snap.is_empty(), "snapshot must be non-empty");

        // Import into fresh B instance
        let sync_b = {
            let st = NativeStorage::open(":memory:").unwrap();
            NativeSync::new(st, "snap-b").unwrap()
        };
        sync_b.import_snapshot(&snap).unwrap();

        // Read model on B must have the node
        let node = sync_b.get_node("urn:test:snap-1").unwrap();
        assert!(node.is_some(), "node must be present after import_snapshot");

        // Query by type must also work
        let rows = sync_b.query_nodes("Article").unwrap();
        assert_eq!(rows.len(), 1);
    }
}
