//! NativeSync — Loro CRDT engine + CQRS read model.
//!
//! Write model:  loro::LoroDoc (conflict-free binary delta sync)
//! Read model:   NativeStorage (rusqlite, SQL-queryable)
//! Projection:   store_node → eager mirror; apply_update → project_all()
//!
//! Binary-compatible with loro-crdt JS (loro-crdt@1.10.7).

use crate::storage::NativeStorage;
use anyhow::{anyhow, Result};
use loro::{ExportMode, LoroDoc, LoroValue, Subscription, ValueOrContainer};
use std::sync::{Arc, Mutex};

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
    ///
    /// The Loro peer ID is resolved for `namespace` as:
    /// - an on-disk namespace → the **persisted per-device** id (`{namespace}.peer`),
    ///   so two devices are distinct peers even on the same (default) namespace;
    /// - `:memory:` (and any namespace with no persistent home) → derived from the
    ///   namespace string, so in-process/test docs stay distinct by their distinct
    ///   namespace strings without sharing a persisted peer file.
    pub fn new(storage: NativeStorage, namespace: &str) -> Result<Self> {
        // A PEER ID IS THE IDENTITY OF A PERSISTED REPLICA. Storage that does not survive the
        // process has none, whatever its namespace is called — and asking for one wrote a
        // `{namespace}.peer` file under the declared graph base for every in-memory sync built with
        // a name. Derivation from the namespace keeps in-process replicas distinct without it.
        let peer_id = match storage.is_persistent() {
            true => match crate::storage::peer_id_for_namespace(namespace)? {
                Some(persisted) => persisted,
                None => peer_id_from_namespace(namespace),
            },
            false => peer_id_from_namespace(namespace),
        };
        Self::new_with_peer(storage, peer_id)
    }

    /// Create a new NativeSync seeded with an explicit Loro peer ID.
    ///
    /// The construction seam that [`new`] delegates to once the peer ID is resolved.
    /// Tests use it to inject distinct ids without touching a shared device-id file.
    pub fn new_with_peer(storage: NativeStorage, peer_id: u64) -> Result<Self> {
        let doc = LoroDoc::new();
        doc.set_peer_id(peer_id)
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
        self.storage
            .store_node(id, type_, context, payload, source_plugin)?;
        Ok(())
    }

    /// Delete the given node ids from BOTH models (CQRS-symmetric to store_node).
    /// Deleting from sqlite alone is not durable: the node still lives in the
    /// Loro doc map, and the next apply_update/import_snapshot would re-project it
    /// (project_all treats a present key as store_node), resurrecting the reaped
    /// row. So we tombstone the Loro key too — project_all skips a deleted key,
    /// and the CRDT delete op propagates the reap to peers. This is the durable
    /// entry point the graph-node reaper must call (not NativeStorage directly).
    pub fn delete_nodes_by_ids(&self, ids: &[String]) -> Result<usize> {
        if ids.is_empty() {
            return Ok(0);
        }
        let nodes_map = self.doc.get_map("nodes");
        for id in ids {
            nodes_map
                .delete(id)
                .map_err(|e| anyhow!("loro map delete: {e:?}"))?;
        }
        self.doc.commit();
        // Eager projection to read model (CQRS) — mirror store_node's ordering.
        self.storage.delete_nodes_by_ids(ids)
    }

    /// A Weak handle to the shared Loro doc, so a background task (the node
    /// reaper) can detect teardown and self-terminate without keeping this
    /// NativeSync alive.
    pub fn weak_doc(&self) -> std::sync::Weak<LoroDoc> {
        Arc::downgrade(&self.doc)
    }

    pub fn get_node(&self, id: &str) -> Result<Option<String>> {
        self.storage.get_node(id)
    }

    pub fn query_nodes(&self, type_: &str) -> Result<Vec<crate::storage::NodeRow>> {
        self.storage.query_nodes(type_)
    }

    /// Same order as [`Self::query_nodes`] (newest first), with the limit applied IN
    /// SQL rather than by the caller slicing an unlimited result. Passthrough to
    /// `NativeStorage::query_nodes_limited` — prefer this wherever only the newest
    /// few rows of a type are wanted; see `docs/SOVEREIGN_RECORD_ORDERING.md`.
    pub fn query_nodes_limited(
        &self,
        type_: &str,
        limit: usize,
    ) -> Result<Vec<crate::storage::NodeRow>> {
        self.storage.query_nodes_limited(type_, limit)
    }

    /// True count of nodes of `type_`, independent of any limit a caller applies via
    /// [`Self::query_nodes_limited`]. Passthrough to `NativeStorage::count_nodes` — a
    /// `SELECT COUNT(*)` that never materialises the rows it counts; see
    /// `docs/SOVEREIGN_RECORD_ORDERING.md`.
    pub fn count_nodes(&self, type_: &str) -> Result<usize> {
        self.storage.count_nodes(type_)
    }

    /// Rebuild SQLite read model from current LoroDoc state.
    /// Called after apply_update() or import_snapshot() to sync the read model.
    /// Mirrors Projector.rebuildAll() from packages/sync-loro/src/projector.ts.
    /// Never panics — logs errors and continues (CRDT must not crash) — but
    /// returns the count of nodes that FAILED to project so the caller can
    /// surface read/write-model divergence instead of reporting a silent `Ok`.
    /// A node in the authoritative CRDT that never lands in SQLite is invisible
    /// to every read-model consumer (dispatch watcher, node reaper, refarm watch).
    pub(crate) fn project_all(&self) -> Result<usize> {
        let nodes_map = self.doc.get_map("nodes");

        // Collect keys first to avoid borrow checker issues with simultaneous
        // keys() iterator and get() calls on the same LoroMap.
        let keys: Vec<String> = nodes_map.keys().map(|k| k.as_str().to_owned()).collect();

        let mut failed = 0usize;
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

            let id = node["id"].as_str().unwrap_or(&key);
            let type_ = node["type"].as_str().unwrap_or("");
            let context = node["context"].as_str();
            let payload = node["payload"].as_str().unwrap_or("{}");
            let source = node["sourcePlugin"].as_str();

            // Must never crash the CRDT engine — mirror TypeScript's try/catch —
            // but count the drop so it isn't silently swallowed.
            if let Err(e) = self.storage.store_node(id, type_, context, payload, source) {
                tracing::error!("project_all: failed to project node {key}: {e}");
                failed += 1;
            }
        }
        Ok(failed)
    }

    pub fn apply_update(&self, bytes: &[u8]) -> Result<()> {
        self.doc
            .import(bytes)
            .map_err(|e| anyhow!("loro import: {e:?}"))?;
        let failed = self.project_all()?;
        if failed > 0 {
            // The CRDT imported fine, but N nodes never reached the SQLite read
            // model — a read/write-model divergence. Don't crash (the CRDT is
            // authoritative and a later re-projection may recover), but surface it
            // loudly (an aggregate line above the per-node errors) instead of
            // returning a silent Ok.
            tracing::warn!(
                failed_nodes = failed,
                "apply_update: read model diverged — {failed} node(s) in the CRDT \
                 failed to project into SQLite; read-model consumers will not see them"
            );
        }
        Ok(())
    }

    pub fn get_update(&self) -> Result<Vec<u8>> {
        self.doc
            .export(ExportMode::all_updates())
            .map_err(|e| anyhow!("export failed: {e:?}"))
    }

    /// Subscribe to local CRDT updates (for WsServer broadcasting in Phase 6).
    /// The callback fires synchronously on each doc.commit().
    /// The subscription is kept alive for the lifetime of this NativeSync instance.
    pub fn on_update(&self, cb: impl Fn(Vec<u8>) + Send + Sync + 'static) {
        // NOTE: subscribe_local_update callback must return bool (true = stay subscribed)
        let sub = self
            .doc
            .subscribe_local_update(Box::new(move |bytes: &Vec<u8>| {
                cb(bytes.clone());
                true // always stay subscribed
            }));
        self.update_subs
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .push(sub);
    }

    /// Register the WsServer broadcast callback (replaces any previous one).
    /// Called by WsServer::run() — cancels the stale subscription before installing a new one.
    pub fn set_broadcast_callback(&self, cb: impl Fn(Vec<u8>) + Send + Sync + 'static) {
        let sub = self
            .doc
            .subscribe_local_update(Box::new(move |bytes: &Vec<u8>| {
                cb(bytes.clone());
                true
            }));
        let mut slot = self
            .ws_broadcast_sub
            .lock()
            .unwrap_or_else(|p| p.into_inner());
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
        let failed = self.project_all()?;
        if failed > 0 {
            tracing::warn!(
                failed_nodes = failed,
                "import_snapshot: read model diverged — {failed} node(s) in the CRDT \
                 failed to project into SQLite; read-model consumers will not see them"
            );
        }
        Ok(())
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
        assert!(
            !bytes.is_empty(),
            "LoroDoc should export non-empty bytes even when empty"
        );
        sync.store_node("urn:test:1", "Note", None, "{}", None)
            .unwrap();
    }

    #[test]
    fn store_node_writes_to_loro_doc() {
        let sync = make_sync();
        sync.store_node("urn:test:node-1", "Note", None, r#"{"text":"hello"}"#, None)
            .unwrap();

        // After store_node, the LoroDoc has content → export is non-empty
        let bytes = sync.get_update().unwrap();
        assert!(
            !bytes.is_empty(),
            "LoroDoc should have exported bytes after store_node"
        );
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

        sync.store_node("urn:test:sub-1", "Note", None, "{}", None)
            .unwrap();

        let calls = fired.lock().unwrap();
        assert!(
            !calls.is_empty(),
            "on_update callback must fire after store_node"
        );
        assert!(!calls[0].is_empty(), "callback bytes must be non-empty");
    }

    #[test]
    fn apply_update_converges_read_model() {
        // Peer A stores a node
        let sync_a = {
            let st = NativeStorage::open(":memory:").unwrap();
            NativeSync::new(st, "peer-a").unwrap()
        };
        sync_a
            .store_node("urn:test:conv-1", "Task", None, r#"{"done":false}"#, None)
            .unwrap();

        // Peer B starts empty
        let sync_b = {
            let st = NativeStorage::open(":memory:").unwrap();
            NativeSync::new(st, "peer-b").unwrap()
        };
        assert!(
            sync_b.get_node("urn:test:conv-1").unwrap().is_none(),
            "peer-b should start without the node"
        );

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
    fn lww_tiebreak_is_deterministic_between_distinct_peers() {
        // Two devices with DISTINCT peer ids concurrently write the SAME node id with
        // different payloads, then exchange updates both directions. Loro's LWW breaks
        // the tie by peer id, so both must converge to the SAME winning payload. With a
        // shared peer id (the default-namespace collision) this tie-break is undefined —
        // this test is the proof the collision is gone.
        let sync_a =
            NativeSync::new_with_peer(NativeStorage::open(":memory:").unwrap(), 111).unwrap();
        let sync_b =
            NativeSync::new_with_peer(NativeStorage::open(":memory:").unwrap(), 222).unwrap();

        sync_a
            .store_node("urn:test:tie", "Note", None, r#"{"from":"a"}"#, None)
            .unwrap();
        sync_b
            .store_node("urn:test:tie", "Note", None, r#"{"from":"b"}"#, None)
            .unwrap();

        // Exchange both directions.
        let from_a = sync_a.get_update().unwrap();
        let from_b = sync_b.get_update().unwrap();
        sync_a.apply_update(&from_b).unwrap();
        sync_b.apply_update(&from_a).unwrap();

        // Both converge to an identical, deterministic winner.
        let a = sync_a.get_node("urn:test:tie").unwrap();
        let b = sync_b.get_node("urn:test:tie").unwrap();
        assert!(a.is_some() && b.is_some());
        assert_eq!(a, b, "distinct peers must converge to the same LWW winner");
    }

    #[test]
    fn project_all_reports_zero_failures_on_clean_projection() {
        // project_all now returns the count of nodes that failed to reach SQLite,
        // so read/write-model divergence can be surfaced instead of a silent Ok.
        // A clean projection must report 0.
        let sync = {
            let st = NativeStorage::open(":memory:").unwrap();
            NativeSync::new(st, "proj-count").unwrap()
        };
        sync.store_node("urn:test:pc-1", "Note", None, "{}", None)
            .unwrap();
        sync.store_node("urn:test:pc-2", "Note", None, r#"{"a":1}"#, None)
            .unwrap();

        let failed = sync.project_all().unwrap();
        assert_eq!(failed, 0, "a clean projection must report zero failures");
    }

    #[test]
    fn snapshot_roundtrip() {
        let sync_a = {
            let st = NativeStorage::open(":memory:").unwrap();
            NativeSync::new(st, "snap-a").unwrap()
        };
        sync_a
            .store_node(
                "urn:test:snap-1",
                "Article",
                None,
                r#"{"title":"test"}"#,
                None,
            )
            .unwrap();

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
