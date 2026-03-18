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
    created_at    TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS crdt_log (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    node_id    TEXT NOT NULL,
    field      TEXT NOT NULL,
    value      TEXT,
    peer_id    TEXT NOT NULL,
    hlc_time   TEXT NOT NULL,
    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
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
    pub created_at: String,
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
    /// Open (or create) a storage database.
    ///
    /// - `:memory:` → ephemeral in-process database
    /// - any other string → `~/.local/share/refarm/{namespace}.db`
    pub fn open(namespace: &str) -> Result<Self> {
        let conn = if namespace == ":memory:" {
            Connection::open_in_memory().context("open in-memory SQLite")?
        } else {
            let dir = db_dir()?;
            std::fs::create_dir_all(&dir)
                .with_context(|| format!("create db dir {dir:?}"))?;
            let path = dir.join(format!("{namespace}.db"));
            tracing::debug!(path = %path.display(), "Opening SQLite database");
            Connection::open(&path)
                .with_context(|| format!("open SQLite at {path:?}"))?
        };

        let storage = Self { conn: Arc::new(Mutex::new(conn)) };
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
            INSERT INTO nodes (id, type, context, payload, source_plugin, created_at, updated_at)
            VALUES (?1, ?2, ?3, ?4, ?5, datetime('now'), datetime('now'))
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

    /// Query nodes by `@type`.
    ///
    /// Mirrors `queryNodes(type)` from OPFSSQLiteAdapter (TypeScript).
    pub fn query_nodes(&self, type_: &str) -> Result<Vec<NodeRow>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn
            .prepare("SELECT id, type, context, payload, source_plugin, created_at, updated_at FROM nodes WHERE type = ?1")
            .context("prepare query_nodes")?;

        let rows = stmt
            .query_map(params![type_], |row| {
                Ok(NodeRow {
                    id: row.get(0)?,
                    type_: row.get(1)?,
                    context: row.get(2)?,
                    payload: row.get(3)?,
                    source_plugin: row.get(4)?,
                    created_at: row.get(5)?,
                    updated_at: row.get(6)?,
                })
            })
            .context("query_nodes")?
            .collect::<Result<Vec<_>, _>>()
            .context("collect nodes")?;

        Ok(rows)
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
                        rusqlite::types::ValueRef::Blob(b) => {
                            Value::String(hex::encode(b))
                        }
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
        s.store_node("urn:test:1", "Note", None, r#"{"v":1}"#, None).unwrap();
        s.store_node("urn:test:1", "Note", None, r#"{"v":2}"#, None).unwrap();
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
}
