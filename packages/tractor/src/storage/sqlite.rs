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
//! Database file path — THE GRAPH FOLLOWS THE DECLARED NODE (see `graph_base`):
//!   Declared:    <XDG_DATA_HOME | REFARM_HOME/data | SOVEREIGN_BASE/SOVEREIGN_DIR/data>/refarm/{namespace}.db
//!   Undeclared:  ~/.local/share/refarm/{namespace}.db  (unix) — logged, not silent
//!                %APPDATA%\refarm\{namespace}.db      (windows)
//!   Ephemeral:   :memory:
//!
//! This header used to name ONLY the undeclared path, and ISS-123 records the consequence: a
//! backup guided by this doc saved the wrong `default.db` and reported success.

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

/// What a page of nodes is being asked for.
///
/// Every field here describes work SQLite does. The reason that matters is `GET /tasks`: it
/// filtered, re-sorted and truncated in Rust, over every row of the type, and each of those
/// three passes was a place where the answer could stop agreeing with the count beside it.
#[derive(Debug, Clone)]
pub struct NodePageSpec<'a> {
    pub type_: &'a str,
    /// `(top-level field of the JSON payload, required value)`, ANDed. Field names are code
    /// constants at every call site today; [`Self::sql_fragments`] rejects anything outside
    /// `[A-Za-z0-9_]` anyway, because a name cannot be a bound parameter and the day someone
    /// threads a query string into one is the day that stops being a formality.
    pub json_filters: &'a [(&'a str, &'a str)],
    /// A top-level payload field to order by, DESC, AHEAD of the store's own order.
    ///
    /// `GET /tasks` needs `created_at_ns` — and needs it HERE rather than as a re-sort of the
    /// page, because a limit taken in one order and presented in another is neither order. It
    /// answers "the newest N by updated_at, shuffled by created_at", which is not a question
    /// anybody asked.
    pub order_by_json_field: Option<&'a str>,
    /// `None` means no ceiling. A ceiling belongs to the caller who can justify one.
    pub limit: Option<usize>,
    pub offset: usize,
}

impl<'a> NodePageSpec<'a> {
    /// The unfiltered, unordered-beyond-the-store, uncapped page — what `query_nodes` has
    /// always meant.
    pub fn of(type_: &'a str) -> Self {
        Self {
            type_,
            json_filters: &[],
            order_by_json_field: None,
            limit: None,
            offset: 0,
        }
    }

    /// PURE. `(where_suffix, order_by)`, with placeholders numbered to match the bind order
    /// both callers use: type, then limit+offset when present, then one per filter.
    ///
    /// THE `json_valid` GUARD appears only when this spec actually reads the payload as JSON.
    /// `json_extract` on malformed text raises, which would turn one bad row into a 500 for
    /// the whole endpoint; the Rust code being replaced dropped such rows silently via
    /// `from_str(..).ok()`, so the guard reproduces the behaviour the endpoint already had
    /// rather than inventing a new one. `GET /nodes` touches no JSON and is left exactly as
    /// it was — its malformed-row handling is a separate question nobody has asked yet.
    ///
    /// ORDERING COUNTS AS READING. A spec that orders by a payload field excludes malformed
    /// rows even with no filters at all, because `json_extract` in an ORDER BY raises just as
    /// readily as one in a WHERE. That is why [`NativeStorage::count_nodes_matching`] takes the
    /// whole spec: the guard follows from the ordering as much as from the filters, and a count
    /// copying only the filters would silently disagree with the page it describes.
    pub fn sql_fragments(&self) -> Result<(String, String)> {
        let reads_json = !self.json_filters.is_empty() || self.order_by_json_field.is_some();
        let mut where_sql = String::new();
        if reads_json {
            where_sql.push_str(" AND json_valid(payload)");
        }

        let first_filter_index = if self.limit.is_some() || self.offset > 0 { 4 } else { 2 };
        for (index, (field, _)) in self.json_filters.iter().enumerate() {
            let field = validated_json_field(field)?;
            where_sql.push_str(&format!(
                " AND json_extract(payload, '$.{field}') = ?{}",
                first_filter_index + index
            ));
        }

        let order_sql = match self.order_by_json_field {
            Some(field) => {
                let field = validated_json_field(field)?;
                // NULLs — a payload with no such key — sort last under DESC in SQLite, which
                // is where `unwrap_or(0)` put them in the Rust sort this replaces.
                format!("json_extract(payload, '$.{field}') DESC, updated_at DESC, id DESC")
            }
            None => "updated_at DESC, id DESC".to_string(),
        };

        Ok((where_sql, order_sql))
    }
}

/// A JSON field name is spliced into SQL because a placeholder cannot name a column or a path.
/// So it is checked rather than trusted — the one place in this file where a string reaches the
/// statement without going through a bound parameter.
fn validated_json_field(field: &str) -> Result<&str> {
    if field.is_empty() || !field.chars().all(|c| c.is_ascii_alphanumeric() || c == '_') {
        anyhow::bail!("json field name must be [A-Za-z0-9_]+, got {field:?}");
    }
    Ok(field)
}

/// Whether this spec needs SQLite's `LIMIT ?/OFFSET ?` clause at all — the two travel together
/// because SQLite has no OFFSET without a LIMIT.
fn limit_or_offset(spec: &NodePageSpec<'_>) -> bool {
    spec.limit.is_some() || spec.offset > 0
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
    /// - any other string → `<graph base>/refarm/{namespace}.db`, where the graph base comes
    ///   from the node's declaration rather than the OS — see [`graph_base`]
    pub fn open(namespace: &str) -> Result<Self> {
        let conn = if namespace == ":memory:" {
            Connection::open_in_memory().context("open in-memory SQLite")?
        } else {
            let dir = db_dir()?;
            std::fs::create_dir_all(&dir).with_context(|| format!("create db dir {dir:?}"))?;
            if let Some(orphan) = legacy_graph_dir()
                .and_then(|legacy| orphaned_legacy_graph(&dir, namespace, &legacy, |p| p.exists()))
            {
                tracing::warn!(
                    orphan = %orphan.display(),
                    graph = %dir.display(),
                    "a database for this namespace also exists at the legacy graph location; \
                     nothing merges the two, and `refarm backup plan` carries both because it \
                     cannot tell which is live",
                );
            }
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

    /// True count of nodes of `type_`, independent of any limit a caller might apply
    /// elsewhere. Exists so a capped response (`query_nodes_limited` plus
    /// `sidecar/mod.rs`'s `MAX_NODES_PER_RESPONSE`) can state how many rows exist WITHOUT
    /// materialising every row just to count them — `SELECT COUNT(*)` never leaves SQLite,
    /// unlike `query_nodes(type_).len()`, which is exactly the cost `query_nodes_limited`
    /// exists to avoid reintroducing one line below the fix.
    pub fn count_nodes(&self, type_: &str) -> Result<usize> {
        self.count_nodes_matching(&NodePageSpec::of(type_))
    }

    fn query_nodes_inner(&self, type_: &str, limit: Option<usize>) -> Result<Vec<NodeRow>> {
        self.query_nodes_page(&NodePageSpec {
            limit,
            ..NodePageSpec::of(type_)
        })
    }

    /// A page of nodes, with the FILTERING AND THE ORDERING BOTH IN SQL.
    ///
    /// That pairing is the point, not a convenience. `GET /tasks` used to read every `Task`
    /// row, filter by `status`/`session_id` in Rust, re-sort by `created_at_ns`, and only
    /// then truncate — three passes over a set the database could have cut once. Moving only
    /// the limit into SQL would have been WORSE than leaving it alone: the limit would apply
    /// to the unfiltered set, so `?status=done` would answer out of the newest 100 rows of
    /// any status and could report zero while hundreds of done tasks existed. That is the
    /// global-limit-then-filter shape ISS-045 was filed for. Filter and limit travel
    /// together or neither moves.
    ///
    /// `stored` counts are taken with [`Self::count_nodes_matching`] and THE SAME filters, so
    /// `truncated` compares two numbers that were measured over the same set.
    pub fn query_nodes_page(&self, spec: &NodePageSpec<'_>) -> Result<Vec<NodeRow>> {
        let (where_sql, order_sql) = spec.sql_fragments()?;
        let mut sql = format!(
            "SELECT id, type, context, payload, source_plugin, updated_at \
             FROM nodes WHERE type = ?1{where_sql} ORDER BY {order_sql}"
        );
        // SQLite has no OFFSET without a LIMIT. A caller that wants to skip rows and take the
        // rest gets -1, which SQLite reads as "no ceiling" — the alternative is inventing a
        // ceiling here and calling it the caller's.
        if limit_or_offset(spec) {
            sql.push_str(" LIMIT ?2 OFFSET ?3");
        }

        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(&sql).context("prepare query_nodes")?;

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

        let mut bound: Vec<Box<dyn rusqlite::ToSql>> = vec![Box::new(spec.type_.to_string())];
        if limit_or_offset(spec) {
            bound.push(Box::new(spec.limit.map(|n| n as i64).unwrap_or(-1)));
            bound.push(Box::new(spec.offset as i64));
        }
        for (_, value) in spec.json_filters {
            bound.push(Box::new((*value).to_string()));
        }
        let refs: Vec<&dyn rusqlite::ToSql> = bound.iter().map(|b| b.as_ref()).collect();

        let rows = stmt
            .query_map(refs.as_slice(), map_row)
            .context("query_nodes")?
            .collect::<Result<Vec<_>, _>>()
            .context("collect nodes")?;

        Ok(rows)
    }

    /// `SELECT COUNT(*)` over the SAME predicate [`Self::query_nodes_page`] would apply.
    ///
    /// It exists so `truncated` is a comparison between two numbers measured over one set. A
    /// count taken without the filters, beside a page taken with them, produces a `truncated:
    /// true` on an endpoint that already returned everything the caller asked for — a lie in
    /// the direction the whole page contract exists to prevent.
    pub fn count_nodes_matching(&self, spec: &NodePageSpec<'_>) -> Result<usize> {
        // IT TAKES THE PAGE'S OWN SPEC, not a repeat of its filters, and that is the fix for a
        // defect this signature had in its first draft: `order_by_json_field` also pulls in the
        // `json_valid` guard, so a count that kept only the filters agreed with the page
        // whenever a filter was present and disagreed the moment one was not. `GET /tasks` with
        // no `?status` and one malformed row would then have reported `truncated: true`
        // permanently, about a row it could never return. Passing the spec makes the two
        // predicates one object instead of two copies somebody has to keep in step.
        let counting = NodePageSpec {
            limit: None,
            offset: 0,
            ..spec.clone()
        };
        let (where_sql, _) = counting.sql_fragments()?;
        let sql = format!("SELECT COUNT(*) FROM nodes WHERE type = ?1{where_sql}");

        let conn = self.conn.lock().unwrap();
        let mut bound: Vec<Box<dyn rusqlite::ToSql>> = vec![Box::new(counting.type_.to_string())];
        for (_, value) in counting.json_filters {
            bound.push(Box::new((*value).to_string()));
        }
        let refs: Vec<&dyn rusqlite::ToSql> = bound.iter().map(|b| b.as_ref()).collect();
        let count: i64 = conn
            .query_row(&sql, refs.as_slice(), |row| row.get(0))
            .context("count_nodes_matching")?;
        Ok(count as usize)
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

/// A trimmed, non-empty environment variable, or `None`. An empty string is an ABSENT
/// declaration, not a declaration of the empty path — the same reading `dirs_sovereign_base`
/// (main.rs:769) applies to REFARM_HOME.
fn declared_env(key: &str) -> Option<std::path::PathBuf> {
    let value = std::env::var(key).ok()?;
    let trimmed = value.trim();
    (!trimmed.is_empty()).then(|| std::path::PathBuf::from(trimmed))
}

/// Resolve the database directory FROM THE NODE'S DECLARATION.
///
/// This used to read `XDG_DATA_HOME` and fall back to `~/.local/share`, which meant the graph
/// never once consulted the node it belongs to. The daemon is TOLD where its node lives —
/// `--refarm-dir` arrives on its own argv and main.rs:431 resolves it — and the graph ignored
/// that entirely. Whenever `XDG_DATA_HOME` happened to be unset, a SECOND database appeared for
/// the same namespace, silently, with nothing reporting the split.
///
/// It is not hypothetical. On 2026-08-05 the operator's machine grew
/// `~/.local/share/refarm/default.db` beside its live `~/.refarm/data/refarm/default.db`: 21
/// nodes, two dispatches with their own budget observations, invisible to the node that believed
/// it held the record. `refarm backup plan` carried BOTH and could not say which was live.
///
/// Same family as ISS-023 (`config_node.rs` declared_base) and ISS-050 (storage-fs scopeRoot),
/// both closed: a resolver asking the OS instead of reading the declaration.
fn db_dir() -> Result<std::path::PathBuf> {
    Ok(graph_base()?.join("refarm"))
}

/// The graph location this node used before its graph followed the declaration — `~/.local/share`
/// on unix, `%APPDATA%` on windows — or `None` when the OS reports no home.
fn legacy_graph_dir() -> Option<std::path::PathBuf> {
    let base = if cfg!(windows) {
        declared_env("APPDATA")
    } else {
        dirs::home_dir().map(|home| home.join(".local/share"))
    };
    base.map(|base| base.join("refarm"))
}

/// PURE. The same-namespace database left at the legacy location, when this node's graph
/// resolved somewhere else. `exists` is injected so the judgement is testable without a
/// filesystem; [`NativeStorage::open`] supplies the real probe.
///
/// It WARNS rather than refuses, and that is ISS-072's rule rather than timidity: a gate blocks
/// only what the agent can fix. The declaration defect is fixed in [`graph_base`] and cannot
/// recur; what remains is a FILE, and whether to carry, merge or discard it is the operator's
/// call — not a reason to refuse to start his node.
fn orphaned_legacy_graph(
    resolved_dir: &std::path::Path,
    namespace: &str,
    legacy_dir: &std::path::Path,
    exists: impl Fn(&std::path::Path) -> bool,
) -> Option<std::path::PathBuf> {
    if resolved_dir == legacy_dir {
        return None;
    }
    let candidate = legacy_dir.join(format!("{namespace}.db"));
    exists(&candidate).then_some(candidate)
}

fn graph_base() -> Result<std::path::PathBuf> {
    // 1. XDG_DATA_HOME — an EXPLICIT declaration, and it still wins. `scripts/refarm-sandbox.mjs`
    //    points the graph at a SIBLING of its REFARM_HOME on purpose (`<base>/share` beside
    //    `<base>/refarm`); that is one of the seven axes that make the sandbox a real second
    //    node, and `refarm parity` reads declared divergence as healthy. Forcing the graph under
    //    REFARM_HOME here would silently collapse the lab into the node it exists to isolate.
    if let Some(path) = declared_env("XDG_DATA_HOME") {
        return Ok(path);
    }

    // 2. REFARM_HOME — the node's own directory. `scripts/tractor-start.sh:85` derives
    //    XDG_DATA_HOME as `$REFARM_HOME/data`, so this reproduces the launcher's own answer for
    //    every caller the launcher did not start. That gap is where the orphan came from.
    if let Some(path) = declared_env("REFARM_HOME") {
        return Ok(path.join("data"));
    }

    // 3. SOVEREIGN_BASE + SOVEREIGN_DIR — the same chain the other half of the node walks, so
    //    both halves answer alike rather than merely happening to agree today.
    if let Some(dir) = declared_env("SOVEREIGN_DIR") {
        if let Some(base) = declared_env("SOVEREIGN_BASE").or_else(dirs::home_dir) {
            return Ok(base.join(dir).join("data"));
        }
    }

    // 4. NOTHING DECLARES A NODE. The platform default is legitimate for a standalone binary —
    //    it is the XDG location, not an invention — but it is also exactly the state that
    //    produced the orphan, so it names itself instead of happening quietly.
    let platform_default = if cfg!(windows) {
        declared_env("APPDATA")
    } else {
        dirs::home_dir().map(|home| home.join(".local/share"))
    };

    match platform_default {
        Some(base) => {
            tracing::warn!(
                base = %base.display(),
                "no node declared (XDG_DATA_HOME, REFARM_HOME, SOVEREIGN_DIR all unset); \
                 opening the graph at the platform default — a node started later with a \
                 declaration will NOT see anything written here",
            );
            Ok(base)
        }
        // 5. REFUSE. The previous code answered `PathBuf::from(".")` here, which opened the
        //    node's graph relative to whatever directory a shell last cd-ed to — the
        //    node-vs-directory defect in its purest form. A graph that cannot say where it
        //    belongs must not invent a home; refusing is the behaviour ISS-023 settled on for
        //    the same question one resolver over.
        None => anyhow::bail!(
            "cannot resolve where this node's graph lives: XDG_DATA_HOME, REFARM_HOME and \
             SOVEREIGN_DIR are all unset and the OS reports no home directory. Declare one \
             rather than letting the graph open relative to the current directory."
        ),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn seeded_things() -> NativeStorage {
        let storage = memory_storage();
        // `n` descends while `id` ascends, so a query that fell back to the store's own order
        // returns the opposite of one ordered by the payload field.
        for (id, n, status) in [("a", 3, "done"), ("b", 2, "active"), ("c", 1, "done")] {
            storage
                .store_node(id, "Thing", None, &format!(r#"{{"n":{n},"status":"{status}"}}"#), None)
                .unwrap();
        }
        storage
    }

    #[test]
    fn query_nodes_page_offset_reaches_rows_a_limit_left_behind() {
        // ISS-042: before this, rows past the ceiling were unreachable AT ANY LIMIT, so a
        // `truncated: true` pointed at nothing the caller could do about it.
        let storage = seeded_things();
        let first = storage
            .query_nodes_page(&NodePageSpec { limit: Some(2), ..NodePageSpec::of("Thing") })
            .unwrap();
        let second = storage
            .query_nodes_page(&NodePageSpec {
                limit: Some(2),
                offset: 2,
                ..NodePageSpec::of("Thing")
            })
            .unwrap();

        assert_eq!(first.len(), 2);
        assert_eq!(second.len(), 1);
        let seen: Vec<&str> = first.iter().chain(second.iter()).map(|r| r.id.as_str()).collect();
        assert_eq!(seen.len(), 3, "the two pages together are the whole set");
        assert!(!seen[..2].contains(&seen[2]), "no row appears on both pages");
    }

    #[test]
    fn offset_without_a_limit_does_not_invent_a_ceiling() {
        // SQLite has no OFFSET without a LIMIT, so the implementation passes -1. If it had
        // invented a number instead, this would silently cap a caller who asked for no cap.
        let storage = seeded_things();
        let rows = storage
            .query_nodes_page(&NodePageSpec { offset: 1, ..NodePageSpec::of("Thing") })
            .unwrap();
        assert_eq!(rows.len(), 2);
    }

    #[test]
    fn json_filters_and_count_are_measured_over_the_same_set() {
        // The pairing `truncated` depends on: a count taken without the filters, beside a page
        // taken with them, reports "there is more" to a caller already given everything.
        let storage = seeded_things();
        let filters = [("status", "done")];
        let rows = storage
            .query_nodes_page(&NodePageSpec { json_filters: &filters, ..NodePageSpec::of("Thing") })
            .unwrap();
        assert_eq!(rows.len(), 2);
        assert_eq!(
            storage
                .count_nodes_matching(&NodePageSpec {
                    json_filters: &filters,
                    ..NodePageSpec::of("Thing")
                })
                .unwrap(),
            2
        );
        assert_eq!(storage.count_nodes("Thing").unwrap(), 3, "unfiltered count is unchanged");
    }

    #[test]
    fn order_by_json_field_beats_the_stores_own_order() {
        let storage = seeded_things();
        let by_store = storage.query_nodes("Thing").unwrap();
        let by_payload = storage
            .query_nodes_page(&NodePageSpec {
                order_by_json_field: Some("n"),
                ..NodePageSpec::of("Thing")
            })
            .unwrap();
        assert_eq!(by_payload[0].id, "a", "n=3 first");
        assert_eq!(by_payload[2].id, "c", "n=1 last");
        assert_ne!(
            by_store.iter().map(|r| &r.id).collect::<Vec<_>>(),
            by_payload.iter().map(|r| &r.id).collect::<Vec<_>>(),
            "the two orders must actually differ, or this test proves nothing"
        );
    }

    #[test]
    fn malformed_payload_is_excluded_from_both_the_page_and_the_count() {
        // `json_extract` RAISES on malformed text — one bad row would 500 the whole endpoint.
        // The `json_valid` guard drops it instead, which is what the Rust `from_str(..).ok()`
        // being replaced already did. Both sides must agree, or `truncated` claims a row the
        // caller can never be given.
        let storage = seeded_things();
        storage.store_node("broken", "Thing", None, "not json", None).unwrap();
        let filters = [("status", "done")];

        let filtered = NodePageSpec { json_filters: &filters, ..NodePageSpec::of("Thing") };
        assert_eq!(storage.query_nodes_page(&filtered).unwrap().len(), 2);
        assert_eq!(storage.count_nodes_matching(&filtered).unwrap(), 2);

        // ORDERING COUNTS AS READING: `json_extract` in an ORDER BY raises on malformed text
        // just as readily as one in a WHERE, so a spec that orders by a payload field carries
        // the same guard and drops the row even with NO filters. The page and the count must
        // still agree — this is the case whose first draft did not, and which would have made
        // `GET /tasks` report `truncated: true` forever about a row nothing could return.
        let ordered = NodePageSpec {
            order_by_json_field: Some("n"),
            ..NodePageSpec::of("Thing")
        };
        assert_eq!(storage.query_nodes_page(&ordered).unwrap().len(), 3);
        assert_eq!(storage.count_nodes_matching(&ordered).unwrap(), 3);

        // The unordered, unfiltered read still sees everything — the guard follows from reading
        // the payload, and is never a blanket policy about what counts as a row.
        assert_eq!(storage.query_nodes("Thing").unwrap().len(), 4);
        assert_eq!(storage.count_nodes("Thing").unwrap(), 4);
    }

    #[test]
    fn a_json_field_name_that_is_not_a_name_is_refused_rather_than_spliced() {
        // A field name cannot be a bound parameter, so it is the one string in this file that
        // reaches the statement by concatenation. Today every call site passes a constant;
        // this is what makes that a checked fact instead of a habit.
        let storage = seeded_things();
        let hostile = [("status'; DROP TABLE nodes; --", "done")];
        assert!(storage
            .query_nodes_page(&NodePageSpec {
                json_filters: &hostile,
                ..NodePageSpec::of("Thing")
            })
            .is_err());
        assert!(storage
            .count_nodes_matching(&NodePageSpec {
                json_filters: &hostile,
                ..NodePageSpec::of("Thing")
            })
            .is_err());
        assert!(storage
            .query_nodes_page(&NodePageSpec {
                order_by_json_field: Some("n DESC, id"),
                ..NodePageSpec::of("Thing")
            })
            .is_err());
        // and the table is still there
        assert_eq!(storage.count_nodes("Thing").unwrap(), 3);
    }

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
        // Insert in an order that, if left alone, would make `id DESC` ALONE produce
        // the right-looking answer ("c" is both last-inserted and highest id) — exactly
        // the shape that let the old version of this test pass without `updated_at DESC`
        // doing any work. Stamp DISTINCT `updated_at` values, deliberately INVERTED
        // against id order (lowest id "a" gets the newest timestamp), through the
        // storage type's own public `execute` — `store_node` derives `updated_at`
        // internally via `datetime('now')` and cannot be handed a fixed value. If the
        // primary sort key were dropped, `id DESC` alone would return "c" first instead.
        storage.store_node("a", "Thing", None, r#"{"n":1}"#, None).unwrap();
        storage.store_node("b", "Thing", None, r#"{"n":2}"#, None).unwrap();
        storage.store_node("c", "Thing", None, r#"{"n":3}"#, None).unwrap();
        storage
            .execute("UPDATE nodes SET updated_at = '2026-01-01T00:00:03Z' WHERE id = 'a'", &[])
            .unwrap();
        storage
            .execute("UPDATE nodes SET updated_at = '2026-01-01T00:00:02Z' WHERE id = 'b'", &[])
            .unwrap();
        storage
            .execute("UPDATE nodes SET updated_at = '2026-01-01T00:00:01Z' WHERE id = 'c'", &[])
            .unwrap();

        let rows = storage.query_nodes("Thing").unwrap();
        let ids: Vec<&str> = rows.iter().map(|r| r.id.as_str()).collect();
        assert_eq!(
            ids,
            vec!["a", "b", "c"],
            "the newest row BY updated_at must come first — 'a' — even though 'c' has the \
             highest id and was inserted last: a reader taking N wants the N most recent, \
             and every caller in this repo does exactly that. If `id DESC` alone decided \
             this (updated_at dropped from the ORDER BY), 'c' would sort first instead."
        );
    }

    #[test]
    fn query_nodes_limited_takes_the_newest_n_not_the_oldest() {
        let storage = memory_storage();
        // Same id-inverted stamping as `query_nodes_returns_newest_first`: 'a' has the
        // lowest id but the newest `updated_at`, so a `LIMIT 1` that silently fell back
        // to `id DESC` alone (updated_at dropped from THIS statement's own ORDER BY —
        // it is a separate SQL string from the unlimited query) would return 'c' instead.
        storage.store_node("a", "Thing", None, r#"{"n":1}"#, None).unwrap();
        storage.store_node("b", "Thing", None, r#"{"n":2}"#, None).unwrap();
        storage.store_node("c", "Thing", None, r#"{"n":3}"#, None).unwrap();
        storage
            .execute("UPDATE nodes SET updated_at = '2026-01-01T00:00:03Z' WHERE id = 'a'", &[])
            .unwrap();
        storage
            .execute("UPDATE nodes SET updated_at = '2026-01-01T00:00:02Z' WHERE id = 'b'", &[])
            .unwrap();
        storage
            .execute("UPDATE nodes SET updated_at = '2026-01-01T00:00:01Z' WHERE id = 'c'", &[])
            .unwrap();

        let rows = storage.query_nodes_limited("Thing", 1).unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(
            rows[0].id, "a",
            "limit 1 must be the NEWEST record BY updated_at, not the row with the highest \
             id. On the operator's own machine this returned the oldest of 29 observations, \
             so an audit with --limit 1 read the wrong record entirely."
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

        // Repeat through `query_nodes_limited`'s OWN SQL statement (a separate string
        // literal in `query_nodes_inner`, not merely the unlimited query plus a `.take`).
        // Without this, a tiebreak regression scoped to only the `LIMIT` arm would pass
        // the assertion above and go uncaught.
        let limited_rows = storage.query_nodes_limited("Thing", 2).unwrap();
        let limited_ids: Vec<&str> = limited_rows.iter().map(|r| r.id.as_str()).collect();
        assert_eq!(
            limited_ids,
            vec!["b", "a"],
            "the same id DESC tiebreak must hold through query_nodes_limited's SQL, not \
             just query_nodes's — the two are separate ORDER BY clauses in query_nodes_inner"
        );
    }

    #[test]
    fn count_nodes_counts_the_true_total_not_a_capped_page() {
        let storage = memory_storage();
        for i in 0..5 {
            storage
                .store_node(&format!("thing-{i}"), "Thing", None, "{}", None)
                .unwrap();
        }
        storage
            .store_node("other-1", "Other", None, "{}", None)
            .unwrap();

        assert_eq!(
            storage.count_nodes("Thing").unwrap(),
            5,
            "count_nodes must report every stored row of the type, independent of any \
             limit a caller separately applies to query_nodes_limited"
        );
        assert_eq!(
            storage.count_nodes("Other").unwrap(),
            1,
            "count_nodes must filter by type, same as query_nodes"
        );
        assert_eq!(
            storage.count_nodes("__nonexistent__").unwrap(),
            0,
            "a type with no rows counts as zero, not an error"
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
        // TAKES THE LOCK because `peer_id_for_namespace` reads `REFARM_PEER_ID`, and since
        // `graph_base` this module also has tests that REMOVE the graph-declaration variables.
        // Without it this raced them and failed only in a full run — green alone, red in the
        // suite, which is the worst shape a test can have.
        let _guard = crate::test_support::env_lock();
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

    /// Restores every graph-declaration variable this module reads, so one test's
    /// environment cannot leak into the next. Paired with `env_lock`.
    struct GraphEnvGuard {
        saved: Vec<(&'static str, Option<String>)>,
    }

    impl GraphEnvGuard {
        fn take() -> Self {
            let keys = ["XDG_DATA_HOME", "REFARM_HOME", "SOVEREIGN_BASE", "SOVEREIGN_DIR"];
            let saved = keys.iter().map(|k| (*k, std::env::var(k).ok())).collect();
            for key in keys {
                std::env::remove_var(key);
            }
            Self { saved }
        }
    }

    impl Drop for GraphEnvGuard {
        fn drop(&mut self) {
            for (key, value) in &self.saved {
                match value {
                    Some(v) => std::env::set_var(key, v),
                    None => std::env::remove_var(key),
                }
            }
        }
    }

    #[test]
    fn a_same_namespace_graph_at_the_legacy_default_is_named_not_swallowed() {
        // THE TRIPWIRE, and it WARNS rather than refuses on purpose. ISS-072 settled the rule on
        // 2026-08-08: a gate blocks only what the agent can fix. The declaration defect is fixed
        // above and cannot recur; a database already sitting at the old location is a FILE, and
        // what to do with it — carry it, merge it, discard it — is the operator's call, not a
        // reason to refuse to start his node.
        let legacy = std::path::PathBuf::from("/home/op/.local/share/refarm");
        let declared = std::path::PathBuf::from("/home/op/.refarm/data/refarm");

        assert_eq!(
            orphaned_legacy_graph(&declared, "default", &legacy, |_| true),
            Some(legacy.join("default.db")),
            "a same-namespace database outside the resolved graph is reported",
        );

        assert_eq!(
            orphaned_legacy_graph(&declared, "default", &legacy, |_| false),
            None,
            "no file, nothing to report",
        );

        // The node whose graph ALREADY resolves to the legacy location is not diverging from
        // anything — it is simply an undeclared node, which step 4 of `graph_base` already names.
        assert_eq!(
            orphaned_legacy_graph(&legacy, "default", &legacy, |_| true),
            None,
            "the legacy path IS this node's graph; there is no second copy",
        );
    }

    #[test]
    fn db_dir_follows_the_declared_node_when_xdg_is_unset() {
        // THE DEFECT THIS PINS. The daemon is TOLD where its node lives — `--refarm-dir` is on
        // its own argv and main.rs:431 resolves it — and this function used to ignore that
        // entirely, reading XDG_DATA_HOME or falling back to ~/.local/share. On 2026-08-05 that
        // produced a SECOND database for the `default` namespace on the operator's machine: 21
        // nodes including two dispatches with their own budget observations, invisible to the
        // node that believed it held the record.
        //
        // `scripts/tractor-start.sh:85` derives XDG_DATA_HOME as `$REFARM_HOME/data`, so this is
        // the launcher's own answer, reproduced for every caller the launcher did not start.
        let _guard = crate::test_support::env_lock();
        let _env = GraphEnvGuard::take();

        std::env::set_var("REFARM_HOME", "/declared/node/.refarm");

        assert_eq!(
            db_dir().unwrap(),
            std::path::PathBuf::from("/declared/node/.refarm/data/refarm"),
        );
    }

    #[test]
    fn db_dir_honours_an_explicitly_declared_xdg_data_home() {
        // DECLARED DIVERGENCE STAYS LEGAL. `scripts/refarm-sandbox.mjs` points the graph at a
        // SIBLING of its REFARM_HOME (`<base>/share` beside `<base>/refarm`) on purpose — that
        // is one of the seven axes that make the sandbox a real second node, and `refarm parity`
        // treats declared divergence as healthy rather than broken. A resolver that forced the
        // graph under REFARM_HOME would silently collapse the lab into the node it isolates.
        let _guard = crate::test_support::env_lock();
        let _env = GraphEnvGuard::take();

        std::env::set_var("REFARM_HOME", "/sandbox/refarm");
        std::env::set_var("XDG_DATA_HOME", "/sandbox/share");

        assert_eq!(
            db_dir().unwrap(),
            std::path::PathBuf::from("/sandbox/share/refarm"),
            "an explicit XDG_DATA_HOME outranks the derivation",
        );
    }

    #[test]
    fn db_dir_walks_the_same_sovereign_chain_as_the_other_half_of_the_node() {
        // Both halves of one node must answer alike. This mirrors `dirs_sovereign_base`
        // (main.rs:769) step for step — SOVEREIGN_BASE joined with SOVEREIGN_DIR — so a node
        // declared through those variables does not get a graph somewhere else.
        let _guard = crate::test_support::env_lock();
        let _env = GraphEnvGuard::take();

        std::env::set_var("SOVEREIGN_BASE", "/srv/operator");
        std::env::set_var("SOVEREIGN_DIR", ".refarm");

        assert_eq!(
            db_dir().unwrap(),
            std::path::PathBuf::from("/srv/operator/.refarm/data/refarm"),
        );
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
