//! NativeSync — Loro CRDT engine + CQRS read model.
//!
//! Mirrors `LoroCRDTStorage` from packages/sync-loro/src/loro-crdt-storage.ts.
//!
//! # Architecture
//! - **Write model**: `loro::LoroDoc` (conflict-free binary delta sync)
//! - **Read model**: `NativeStorage` (rusqlite, SQL-queryable)
//! - **Projector**: subscribes to LoroDoc changes → writes to read model
//!
//! The binary format produced by `get_update()` / consumed by `apply_update()`
//! is **binary-compatible** with `loro-crdt` JS (`loro-crdt@1.10.7`).
//! A snapshot exported here can be imported by BrowserSyncClient and vice versa.
//!
//! # Phase 5 — TODO
//! This is a stub. Full implementation in Phase 5.

use anyhow::Result;
use crate::storage::NativeStorage;

/// Loro CRDT storage with CQRS read model.
///
/// `Clone` is O(1) — shares the underlying LoroDoc via `Arc`.
#[derive(Clone, Debug)]
pub struct NativeSync {
    storage: NativeStorage,
    // Phase 5: loro::LoroDoc wrapped in Arc<Mutex<>>
}

impl NativeSync {
    /// Create a new NativeSync backed by the given storage.
    pub fn new(storage: NativeStorage) -> Result<Self> {
        Ok(Self { storage })
    }

    /// Store a node — writes to LoroDoc (write model), which triggers
    /// projection to rusqlite (read model) via the Projector subscription.
    ///
    /// Phase 5: write to LoroDoc; currently delegates directly to storage.
    pub fn store_node(
        &self,
        id: &str,
        type_: &str,
        context: Option<&str>,
        payload: &str,
        source_plugin: Option<&str>,
    ) -> Result<()> {
        self.storage.store_node(id, type_, context, payload, source_plugin)
    }

    /// Retrieve a single node by ID from the read model (rusqlite).
    pub fn get_node(&self, id: &str) -> Result<Option<String>> {
        self.storage.get_node(id)
    }

    /// Query nodes by @type from the read model (rusqlite).
    pub fn query_nodes(&self, type_: &str) -> Result<Vec<crate::storage::NodeRow>> {
        self.storage.query_nodes(type_)
    }

    /// Apply a binary Loro update received from a remote peer / browser.
    ///
    /// Phase 5: `doc.import(bytes)` → trigger projector.
    pub fn apply_update(&self, _bytes: &[u8]) -> Result<()> {
        tracing::warn!("apply_update: Loro CRDT not yet wired (Phase 5 stub)");
        Ok(())
    }

    /// Export local state as binary Loro update bytes.
    ///
    /// Phase 5: `doc.export(ExportMode::Updates)`.
    pub fn get_update(&self) -> Result<Vec<u8>> {
        tracing::warn!("get_update: Loro CRDT not yet wired (Phase 5 stub)");
        Ok(vec![])
    }

    /// Subscribe to local CRDT changes.
    ///
    /// Phase 5: `doc.subscribe_local_updates(cb)`.
    pub fn on_update(&self, _cb: impl Fn(Vec<u8>) + Send + 'static) {
        tracing::warn!("on_update: Loro CRDT not yet wired (Phase 5 stub)");
    }

    /// Export full snapshot bytes.
    pub fn export_snapshot(&self) -> Result<Vec<u8>> {
        tracing::warn!("export_snapshot: stub");
        Ok(vec![])
    }

    /// Import a full snapshot.
    pub fn import_snapshot(&self, _bytes: &[u8]) -> Result<()> {
        tracing::warn!("import_snapshot: stub");
        Ok(())
    }
}
