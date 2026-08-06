//! NativeStorage — rusqlite-backed sovereign node store.
//!
//! Uses the same physical schema as `OPFSSQLiteAdapter` in
//! packages/storage-sqlite/src/index.ts — a database file written by the
//! TypeScript implementation is directly readable here, and vice versa.
//!
//! # Schema (PHYSICAL_SCHEMA_V1)
//!
//! ```sql
//! CREATE TABLE nodes      -- Materialised sovereign graph
//! CREATE TABLE crdt_log   -- Triple-based Op-Log (ADR-028)
//! ```
//!
//! Database file path:
//!   Linux/macOS: ~/.local/share/refarm/{namespace}.db
//!   Windows:     %APPDATA%\refarm\{namespace}.db
//!   Ephemeral:   :memory:

use anyhow::{Context, Result};
use rusqlite::{params, Connection};
use serde_json::Value;
use std::sync::{Arc, Mutex};

/// Schema identical to packages/storage-sqlite/src/index.ts PHYSICAL_SCHEMA_V1
const SCHEMA_SQL: &str = r#"
CREATE TABLE IF NOT EXISTS nodes (
    id            TEXT PRIMARY KEY,
    type          TEXT NOT NULL,
    context       TEXT,
    payload       TEXT NOT NULL,
    source_plugin TEXT,
    updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS crdt_log (
    id         TEXT PRIMARY KEY,
    node_id    TEXT NOT NULL,
    field      TEXT NOT NULL,
    value      TEXT,
    peer_id    TEXT NOT NULL,
    hlc_time   TEXT NOT NULL,
    applied_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY(node_id) REFERENCES nodes(id)
);

CREATE INDEX IF NOT EXISTS idx_nodes_type ON nodes(type);
CREATE INDEX IF NOT EXISTS idx_crdt_node  ON crdt_log(node_id);
"#;

/// A sovereign node row as returned by queryNodes.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct NodeRow {
    pub id: String,
    #[serde(rename = "type")]
    pub type_: String,
    pub context: Option<String>,
    pub payload: String,
    pub source_plugin: Option<String>,
    pub updated_at: String,
}

/// rusqlite-backed storage adapter — same schema as packages/storage-sqlite.
///
/// `Clone` is O(1) — shares the underlying connection via `Arc<Mutex<Connection>>`.
#[derive(Clone, Debug)]
pub struct NativeStorage {
    conn: Arc<Mutex<Connection>>,
}

impl NativeStorage {
    /// Open (or create) a database at an explicit file path.
    ///
    /// Useful for conformance tests that need to open a pre-existing `.db` file
    /// created by the TypeScript implementation without going through namespace
    /// resolution.
    pub fn open_at(path: &std::path::Path) -> Result<Self> {
        let conn = Connection::open(path).with_context(|| format!("open SQLite at {path:?}"))?;
        let storage = Self {
            conn: Arc::new(Mutex::new(conn)),
        };
        storage.ensure_schema()?;
        Ok(storage)
    }

    /// Open (or create) a storage database.
    ///
    /// - `:memory:` → ephemeral in-process database
    /// - any other string → `~/.local/share/refarm/{namespace}.db`
    pub fn open(namespace: &str) -> Result<Self> {
        let conn = if namespace == ":memory:" {
            Connection::open_in_memory().context("open in-memory SQLite")?
        } else {
            let dir = db_dir()?;
            std::fs::create_dir_all(&dir).with_context(|| format!("create db dir {dir:?}"))?;
            let path = dir.join(format!("{namespace}.db"));
            tracing::debug!(path = %path.display(), "Opening SQLite database");
            Connection::open(&path).with_context(|| format!("open SQLite at {path:?}"))?
        };

        let storage = Self {
            conn: Arc::new(Mutex::new(conn)),
        };
        storage.ensure_schema()?;
        Ok(storage)
    }

    /// Create all tables and indexes if they do not already exist.
    pub fn ensure_schema(&self) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute_batch(SCHEMA_SQL)
            .context("apply PHYSICAL_SCHEMA_V1")?;
        Ok(())
    }

    /// Upsert a sovereign node.
    ///
    /// Mirrors `storeNode()` from OPFSSQLiteAdapter (TypeScript).
    pub fn store_node(
        &self,
        id: &str,
        type_: &str,
        context: Option<&str>,
        payload: &str,
        source_plugin: Option<&str>,
    ) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            r#"
            INSERT INTO nodes (id, type, context, payload, source_plugin, updated_at)
            VALUES (?1, ?2, ?3, ?4, ?5, datetime('now'))
            ON CONFLICT(id) DO UPDATE SET
                type          = excluded.type,
                context       = excluded.context,
                payload       = excluded.payload,
                source_plugin = excluded.source_plugin,
                updated_at    = datetime('now')
            "#,
            params![id, type_, context, payload, source_plugin],
        )
        .context("store_node")?;
        Ok(())
    }

    /// Retrieve a single node by ID. Returns `None` if not found.
    pub fn get_node(&self, id: &str) -> Result<Option<String>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn
            .prepare("SELECT payload FROM nodes WHERE id = ?1")
            .context("prepare get_node")?;
        let mut rows = stmt
            .query_map(params![id], |row| row.get::<_, String>(0))
            .context("get_node")?;
        match rows.next() {
            Some(row) => Ok(Some(row.context("get_node row")?)),
            None => Ok(None),
        }
    }

    /// Retrieve a single node row by ID. Returns `None` if not found.
    pub fn get_node_row(&self, id: &str) -> Result<Option<NodeRow>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn
            .prepare(
                "SELECT id, type, context, payload, source_plugin, updated_at FROM nodes WHERE id = ?1",
            )
            .context("prepare get_node_row")?;
        let mut rows = stmt
            .query_map(params![id], |row| {
                Ok(NodeRow {
                    id: row.get(0)?,
                    type_: row.get(1)?,
                    context: row.get(2)?,
                    payload: row.get(3)?,
                    source_plugin: row.get(4)?,
                    updated_at: row.get(5)?,
                })
            })
            .context("get_node_row")?;
        match rows.next() {
            Some(row) => Ok(Some(row.context("get_node_row row")?)),
            None => Ok(None),
        }
    }

    /// Query nodes by `@type`, NEWEST FIRST.
    ///
    /// The ordering is not a nicety. Before 2026-08-06 this statement had no `ORDER BY` at
    /// all, so it returned rows in whatever order SQLite chose — in practice insertion
    /// order, oldest first. Every caller in this repository then took from the FRONT:
    /// `refarm budget observations` (`sidecar/mod.rs`), the WASM bridge
    /// (`host/wasi_bridge/core.rs`), `latest_session_id` and `latest_session_leaf_id`
    /// (`agent/src/session/wasm_ops.rs`). All of them meant "the most recent N" and all of
    /// them got the oldest N. Measured on the operator's node: `--limit 1` over 29
    /// observations returned the one from 2026-08-03, when the newest was from 2026-08-05.
    ///
    /// `id DESC` is the tiebreak, and it is load bearing: `updated_at` has second or
    /// millisecond granularity, so rows written in one tick would otherwise come back in an
    /// arbitrary order that could differ between two identical reads. A total order means a
    /// reader can page without records shifting underneath it.
    ///
    /// Mirrors `queryNodes(type)` from OPFSSQLiteAdapter (TypeScript).
    pub fn query_nodes(&self, type_: &str) -> Result<Vec<NodeRow>> {
        self.query_nodes_inner(type_, None)
    }

    /// Same order as [`Self::query_nodes`], with the limit applied IN SQL.
    ///
    /// Prefer this wherever a caller only wants the newest few: `query_nodes` materialises
    /// every row of that type before the caller discards most of them, which is affordable
    /// at 29 observations and is not at 29,000.
    pub fn query_nodes_limited(&self, type_: &str, limit: usize) -> Result<Vec<NodeRow>> {
        self.query_nodes_inner(type_, Some(limit))
    }

    fn query_nodes_inner(&self, type_: &str, limit: Option<usize>) -> Result<Vec<NodeRow>> {
        let conn = self.conn.lock().unwrap();
        let sql = match limit {
            Some(_) => "SELECT id, type, context, payload, source_plugin, updated_at \
                        FROM nodes WHERE type = ?1 ORDER BY updated_at DESC, id DESC LIMIT ?2",
            None => "SELECT id, type, context, payload, source_plugin, updated_at \
                     FROM nodes WHERE type = ?1 ORDER BY updated_at DESC, id DESC",
        };
        let mut stmt = conn.prepare(sql).context("prepare query_nodes")?;

        let map_row = |row: &rusqlite::Row<'_>| {
            Ok(NodeRow {
                id: row.get(0)?,
                type_: row.get(1)?,
                context: row.get(2)?,
                payload: row.get(3)?,
                source_plugin: row.get(4)?,
                updated_at: row.get(5)?,
            })
        };

        let rows = match limit {
            Some(n) => stmt
                .query_map(params![type_, n as i64], map_row)
                .context("query_nodes")?
                .collect::<Result<Vec<_>, _>>()
                .context("collect nodes")?,
            None => stmt
                .query_map(params![type_], map_row)
                .context("query_nodes")?
                .collect::<Result<Vec<_>, _>>()
                .context("collect nodes")?,
        };

        Ok(rows)
    }

    /// Delete the given node ids, returning the number of rows removed. Used by
    /// the graph-node reaper, which decides WHICH ids to reap in a pure planner
    /// (allowlisted streaming types + age + terminal-session gate) and deletes
    /// them by exact id here — the same key the Loro tombstone uses, so sqlite
    /// and the CRDT doc stay in step. No-op for an empty slice.
    pub fn delete_nodes_by_ids(&self, ids: &[String]) -> Result<usize> {
        if ids.is_empty() {
            return Ok(0);
        }
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn
            .prepare("DELETE FROM nodes WHERE id = ?1")
            .context("prepare delete_nodes_by_ids")?;
        let mut deleted = 0usize;
        for id in ids {
            deleted += stmt.execute(params![id]).context("delete_nodes_by_ids")?;
        }
        Ok(deleted)
    }

    /// Execute a raw SQL statement (no result rows).
    pub fn execute(&self, sql: &str, params: &[&dyn rusqlite::ToSql]) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(sql, params).context("execute")?;
        Ok(())
    }

    /// Query with result rows returned as JSON Values.
    pub fn query_json(&self, sql: &str) -> Result<Vec<Value>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(sql).context("prepare query")?;
        let col_names: Vec<String> = stmt
            .column_names()
            .into_iter()
            .map(|s| s.to_string())
            .collect();

        let rows = stmt
            .query_map([], |row| {
                let mut map = serde_json::Map::new();
                for (i, name) in col_names.iter().enumerate() {
                    let val: Value = match row.get_ref(i)? {
                        rusqlite::types::ValueRef::Null => Value::Null,
                        rusqlite::types::ValueRef::Integer(n) => Value::from(n),
                        rusqlite::types::ValueRef::Real(f) => {
                            Value::from(serde_json::Number::from_f64(f).unwrap_or(0.into()))
                        }
                        rusqlite::types::ValueRef::Text(s) => {
                            Value::String(String::from_utf8_lossy(s).into_owned())
                        }
                        rusqlite::types::ValueRef::Blob(b) => Value::String(hex::encode(b)),
                    };
                    map.insert(name.clone(), val);
                }
                Ok(Value::Object(map))
            })
            .context("query_json rows")?
            .collect::<Result<Vec<_>, _>>()
            .context("collect query_json")?;

        Ok(rows)
    }

    /// Close the database connection.
    pub fn close(&self) -> Result<()> {
        // Connection is shared — actual close happens when Arc drops.
        // This is a no-op placeholder matching the TS StorageAdapter contract.
        Ok(())
    }
}

/// Resolve (or lazily create) the stable per-device CRDT peer ID for a namespace.
///
/// The peer ID seeds Loro's LWW tie-break, so two devices that write concurrently
/// MUST hold distinct peer IDs — otherwise the tie-break is undefined and "whose
/// write wins" is a timing accident. Deriving it from the namespace string alone
/// collides: two devices both on the default namespace derive the same ID.
///
/// This persists a random `u64` once, next to `{namespace}.db`, so a device keeps a
/// stable, distinct pseudonym across restarts. It is a device pseudonym — deliberately
/// decoupled from the per-*user* ed25519/silo account identities (those are engineered
/// to be recovered onto a *new* device, which is the opposite of what a peer ID needs).
///
/// Returns:
/// - `Ok(Some(id))` when `REFARM_PEER_ID` pins an explicit valid id (any namespace),
///   or for an on-disk namespace (read-or-create `{namespace}.peer`).
/// - `Ok(None)` for the `:memory:` namespace with no override — no persistent home, so
///   the caller falls back to namespace-derivation (correct: in-process/test docs stay
///   distinct by their distinct namespace strings and never share a peer file).
///
/// `REFARM_PEER_ID` lets an operator pin a peer without touching the file — e.g. a
/// deterministic id for reproducible CI or convergence debugging. An unset or invalid
/// value falls through to the persisted path (never the default-namespace collision).
pub(crate) fn peer_id_for_namespace(namespace: &str) -> Result<Option<u64>> {
    if let Some(id) = peer_id_env_override() {
        return Ok(Some(id));
    }
    if namespace == ":memory:" {
        return Ok(None);
    }
    let dir = db_dir()?;
    std::fs::create_dir_all(&dir).with_context(|| format!("create db dir {dir:?}"))?;
    peer_id_at(&dir, namespace).map(Some)
}

/// A valid `u64` pinned via `REFARM_PEER_ID`, or `None` if unset/malformed/reserved.
fn peer_id_env_override() -> Option<u64> {
    let raw = std::env::var("REFARM_PEER_ID").ok()?;
    match raw.trim().parse::<u64>() {
        Ok(id) if is_valid_peer_id(id) => Some(id),
        _ => {
            tracing::warn!(value = %raw, "invalid REFARM_PEER_ID; ignoring");
            None
        }
    }
}

/// Read-or-create the persisted peer ID for `{namespace}.peer` inside `dir`.
///
/// Testable core of [`peer_id_for_namespace`]: production passes [`db_dir`]; tests
/// pass a tempdir so they never touch the developer's real device identity.
pub(crate) fn peer_id_at(dir: &std::path::Path, namespace: &str) -> Result<u64> {
    let path = dir.join(format!("{namespace}.peer"));
    if let Ok(raw) = std::fs::read_to_string(&path) {
        if let Ok(id) = raw.trim().parse::<u64>() {
            if is_valid_peer_id(id) {
                return Ok(id);
            }
        }
        // Malformed or reserved value on disk — regenerate rather than trust it.
        tracing::warn!(path = %path.display(), "invalid persisted peer id; regenerating");
    }
    let id = generate_peer_id();
    // Atomic write: temp + rename, matching the storage layer's durability posture.
    let tmp = dir.join(format!("{namespace}.peer.tmp"));
    std::fs::write(&tmp, id.to_string()).with_context(|| format!("write peer id {tmp:?}"))?;
    std::fs::rename(&tmp, &path).with_context(|| format!("rename peer id into {path:?}"))?;
    Ok(id)
}

/// Loro reserves `0` and rejects `u64::MAX`; any other value is a valid peer ID.
fn is_valid_peer_id(id: u64) -> bool {
    id != 0 && id != u64::MAX
}

/// Generate a random, valid CRDT peer ID via the OS RNG.
fn generate_peer_id() -> u64 {
    use rand_core::{OsRng, RngCore};
    loop {
        let id = OsRng.next_u64();
        if is_valid_peer_id(id) {
            return id;
        }
    }
}

/// Resolve the platform-appropriate database directory.
fn db_dir() -> Result<std::path::PathBuf> {
    let base = if cfg!(windows) {
        std::env::var("APPDATA")
            .map(std::path::PathBuf::from)
            .unwrap_or_else(|_| std::path::PathBuf::from("."))
    } else {
        // XDG_DATA_HOME takes precedence; fall back to ~/.local/share
        std::env::var("XDG_DATA_HOME")
            .map(std::path::PathBuf::from)
            .unwrap_or_else(|_| {
                std::env::var("HOME")
                    .map(|h| std::path::PathBuf::from(h).join(".local/share"))
                    .unwrap_or_else(|_| std::path::PathBuf::from("."))
            })
    };
    Ok(base.join("refarm"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn memory_storage() -> NativeStorage {
        NativeStorage::open(":memory:").unwrap()
    }

    #[test]
    fn schema_created() {
        let s = memory_storage();
        // Verify tables exist by querying them (execute rejects result-returning statements)
        let nodes = s.query_nodes("__nonexistent__").unwrap();
        assert_eq!(nodes.len(), 0);
        // Verify crdt_log index exists via schema query
        let rows = s
            .query_json("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
            .unwrap();
        let names: Vec<_> = rows
            .iter()
            .filter_map(|r| r["name"].as_str().map(|s| s.to_string()))
            .collect();
        assert!(names.contains(&"nodes".to_string()));
        assert!(names.contains(&"crdt_log".to_string()));
    }

    #[test]
    fn store_and_query_node() {
        let s = memory_storage();
        s.store_node(
            "urn:test:1",
            "Message",
            Some("https://schema.org"),
            r#"{"@type":"Message","text":"hello"}"#,
            Some("test-plugin"),
        )
        .unwrap();

        let rows = s.query_nodes("Message").unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].id, "urn:test:1");
        assert_eq!(rows[0].type_, "Message");
    }

    #[test]
    fn upsert_updates_payload() {
        let s = memory_storage();
        s.store_node("urn:test:1", "Note", None, r#"{"v":1}"#, None)
            .unwrap();
        s.store_node("urn:test:1", "Note", None, r#"{"v":2}"#, None)
            .unwrap();
        let rows = s.query_nodes("Note").unwrap();
        assert_eq!(rows.len(), 1);
        assert!(rows[0].payload.contains("\"v\":2"));
    }

    #[test]
    fn query_by_type_filters() {
        let s = memory_storage();
        s.store_node("urn:a:1", "A", None, "{}", None).unwrap();
        s.store_node("urn:b:1", "B", None, "{}", None).unwrap();
        assert_eq!(s.query_nodes("A").unwrap().len(), 1);
        assert_eq!(s.query_nodes("B").unwrap().len(), 1);
        assert_eq!(s.query_nodes("C").unwrap().len(), 0);
    }

    #[test]
    fn query_nodes_returns_newest_first() {
        let storage = memory_storage();
        // Insert oldest first, so insertion order is the WRONG answer.
        storage.store_node("a", "Thing", None, r#"{"n":1}"#, None).unwrap();
        storage.store_node("b", "Thing", None, r#"{"n":2}"#, None).unwrap();
        storage.store_node("c", "Thing", None, r#"{"n":3}"#, None).unwrap();

        let rows = storage.query_nodes("Thing").unwrap();
        let ids: Vec<&str> = rows.iter().map(|r| r.id.as_str()).collect();
        assert_eq!(
            ids[0], "c",
            "the newest row must come first: a reader taking N wants the N most recent, \
             and every caller in this repo does exactly that"
        );
    }

    #[test]
    fn query_nodes_limited_takes_the_newest_n_not_the_oldest() {
        let storage = memory_storage();
        storage.store_node("a", "Thing", None, r#"{"n":1}"#, None).unwrap();
        storage.store_node("b", "Thing", None, r#"{"n":2}"#, None).unwrap();
        storage.store_node("c", "Thing", None, r#"{"n":3}"#, None).unwrap();

        let rows = storage.query_nodes_limited("Thing", 1).unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(
            rows[0].id, "c",
            "limit 1 must be the NEWEST record. On the operator's own machine this returned the \
             oldest of 29 observations, so an audit with --limit 1 read the wrong record entirely."
        );
    }

    #[test]
    fn query_nodes_order_is_total_so_equal_timestamps_do_not_shuffle() {
        let storage = memory_storage();
        storage.store_node("a", "Thing", None, r#"{}"#, None).unwrap();
        storage.store_node("b", "Thing", None, r#"{}"#, None).unwrap();

        // `store_node` derives `updated_at` internally via `datetime('now')` — it cannot be
        // passed a fixed value. Force both rows to the SAME `updated_at` deterministically,
        // through the same connection, rather than hoping two inserts land in the same clock
        // tick: a test whose outcome depends on timing is flaky, and a flaky test guarding a
        // correctness invariant is the same false-confidence problem in a slower form.
        storage
            .execute("UPDATE nodes SET updated_at = '2026-01-01T00:00:00Z'", &[])
            .unwrap();

        let rows = storage.query_nodes("Thing").unwrap();
        let ids: Vec<&str> = rows.iter().map(|r| r.id.as_str()).collect();
        assert_eq!(
            ids,
            vec!["b", "a"],
            "with equal updated_at, id DESC is the tiebreak that decides order: 'b' must \
             sort before 'a'. Deleting or reversing that tiebreak must fail this assertion \
             — a test that only checks two reads agree with each other would pass even \
             without a secondary sort key, since SQLite is deterministic on unchanged data \
             regardless of whether a tiebreak column exists."
        );
    }

    #[test]
    fn file_storage_survives_reopen() {
        let dir = tempfile::tempdir().unwrap();
        let db_path = dir.path().join("restart-proof.db");

        {
            let s = NativeStorage::open_at(&db_path).unwrap();
            s.store_node(
                "urn:test:restart-task",
                "Task",
                Some("daily-driver"),
                r#"{"@type":"Task","status":"active"}"#,
                Some("restart-proof"),
            )
            .unwrap();
        }

        let reopened = NativeStorage::open_at(&db_path).unwrap();
        let rows = reopened.query_nodes("Task").unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].id, "urn:test:restart-task");
        assert_eq!(rows[0].context.as_deref(), Some("daily-driver"));
        assert!(rows[0].payload.contains("\"status\":\"active\""));
        assert_eq!(rows[0].source_plugin.as_deref(), Some("restart-proof"));
    }

    #[test]
    fn peer_id_memory_namespace_has_no_persistent_home() {
        // `:memory:` returns None → the caller falls back to namespace-derivation,
        // so in-process/test docs never share a persisted peer file.
        assert_eq!(peer_id_for_namespace(":memory:").unwrap(), None);
    }

    #[test]
    fn peer_id_persists_across_reopen() {
        // Same persisted file → same id (a "restart" reads, does not regenerate).
        let dir = tempfile::tempdir().unwrap();
        let first = peer_id_at(dir.path(), "device-a").unwrap();
        let second = peer_id_at(dir.path(), "device-a").unwrap();
        assert_eq!(
            first, second,
            "persisted peer id must be stable across reopen"
        );
        assert!(is_valid_peer_id(first));
    }

    #[test]
    fn peer_id_distinct_per_device() {
        // Two devices (two separate homes) minting the SAME namespace get DISTINCT
        // ids — this is exactly the "default namespace collision" the persisted id fixes.
        let home_a = tempfile::tempdir().unwrap();
        let home_b = tempfile::tempdir().unwrap();
        let id_a = peer_id_at(home_a.path(), "default").unwrap();
        let id_b = peer_id_at(home_b.path(), "default").unwrap();
        assert_ne!(
            id_a, id_b,
            "two devices on the same namespace must be distinct peers"
        );
    }

    #[test]
    fn peer_id_regenerates_on_corrupt_file() {
        // A malformed persisted value must not seed an invalid peer id.
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("device-x.peer");
        std::fs::write(&path, "not-a-number").unwrap();
        let id = peer_id_at(dir.path(), "device-x").unwrap();
        assert!(is_valid_peer_id(id));
        // And the corrupt content is replaced with the regenerated id.
        let persisted: u64 = std::fs::read_to_string(&path)
            .unwrap()
            .trim()
            .parse()
            .unwrap();
        assert_eq!(persisted, id);
    }

    #[test]
    fn peer_id_regenerates_on_reserved_value() {
        // Loro reserves 0 and rejects u64::MAX — a persisted reserved value is rejected.
        let dir = tempfile::tempdir().unwrap();
        for reserved in [0u64, u64::MAX] {
            let path = dir.path().join("device-r.peer");
            std::fs::write(&path, reserved.to_string()).unwrap();
            let id = peer_id_at(dir.path(), "device-r").unwrap();
            assert!(
                is_valid_peer_id(id),
                "reserved {reserved} must be regenerated"
            );
        }
    }

    #[test]
    fn peer_id_env_override_pins_id() {
        // REFARM_PEER_ID pins the peer without touching the file — an operator escape
        // hatch for deterministic CI/convergence debugging. It wins even for :memory:
        // (which otherwise returns None). Invalid/reserved values are ignored.
        let _guard = crate::test_support::env_lock();
        let saved = std::env::var("REFARM_PEER_ID").ok();

        std::env::set_var("REFARM_PEER_ID", "424242");
        assert_eq!(peer_id_for_namespace(":memory:").unwrap(), Some(424242));

        std::env::set_var("REFARM_PEER_ID", "not-a-number");
        assert_eq!(
            peer_id_for_namespace(":memory:").unwrap(),
            None,
            "malformed override ignored"
        );

        std::env::set_var("REFARM_PEER_ID", "0");
        assert_eq!(
            peer_id_for_namespace(":memory:").unwrap(),
            None,
            "reserved override ignored"
        );

        match saved {
            Some(v) => std::env::set_var("REFARM_PEER_ID", v),
            None => std::env::remove_var("REFARM_PEER_ID"),
        }
    }
}
