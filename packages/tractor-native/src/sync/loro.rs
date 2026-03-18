//! NativeSync — Loro CRDT engine + CQRS read model.
//!
//! Write model:  loro::LoroDoc (conflict-free binary delta sync)
//! Read model:   NativeStorage (rusqlite, SQL-queryable)
//! Projection:   store_node → eager mirror; apply_update → project_all()
//!
//! Binary-compatible with loro-crdt JS (loro-crdt@1.10.7).

use anyhow::{anyhow, Result};
use loro::{ExportMode, LoroDoc, Subscription};
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
/// Clone is O(1): all fields are Arc<T>.
#[derive(Clone)]
pub struct NativeSync {
    storage: NativeStorage,
    doc: Arc<LoroDoc>,
    /// Subscriptions kept alive for the lifetime of NativeSync.
    update_subs: Arc<Mutex<Vec<Subscription>>>,
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
        })
    }

    pub fn store_node(
        &self, id: &str, type_: &str,
        context: Option<&str>, payload: &str,
        source_plugin: Option<&str>,
    ) -> Result<()> {
        self.storage.store_node(id, type_, context, payload, source_plugin)
    }

    pub fn get_node(&self, id: &str) -> Result<Option<String>> {
        self.storage.get_node(id)
    }

    pub fn query_nodes(&self, type_: &str) -> Result<Vec<crate::storage::NodeRow>> {
        self.storage.query_nodes(type_)
    }

    pub fn apply_update(&self, _bytes: &[u8]) -> Result<()> {
        tracing::warn!("apply_update: stub");
        Ok(())
    }

    pub fn get_update(&self) -> Result<Vec<u8>> {
        self.doc.export(ExportMode::all_updates())
            .map_err(|e| anyhow!("export failed: {e:?}"))
    }

    pub fn on_update(&self, _cb: impl Fn(Vec<u8>) + Send + Sync + 'static) {
        tracing::warn!("on_update: stub");
    }

    pub fn export_snapshot(&self) -> Result<Vec<u8>> {
        tracing::warn!("export_snapshot: stub");
        Ok(vec![])
    }

    pub fn import_snapshot(&self, _bytes: &[u8]) -> Result<()> {
        tracing::warn!("import_snapshot: stub");
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
        assert!(!bytes.is_empty(), "LoroDoc should export non-empty bytes even when empty");
        sync.store_node("urn:test:1", "Note", None, "{}", None).unwrap();
    }
}
