//! GC/TTL reaper for streaming graph nodes.
//!
//! The respond path writes one permanent `nodes` row PER STREAMED CHUNK
//! (AgentResponse, StreamChunk) plus one StreamSession per stream — ids are
//! unique per chunk, so the ON CONFLICT upsert never collides and the rows
//! accumulate forever. This reaps the streaming family by age.
//!
//! Two safety pillars, both proven by the recon and enforced here:
//!
//!  1. ALLOWLIST, never denylist. Only the three streaming types are ever
//!     reapable (REAPABLE_TYPES). Every durable domain node — Session, Task,
//!     RefarmConfig, imported skills, any plugin @type, the `Unknown` fallback —
//!     defaults to KEEP. A new node type introduced later is safe automatically.
//!
//!  2. Delete from BOTH models. Deleting only sqlite is not durable: the node
//!     still lives in the Loro doc map, and the next apply_update/import_snapshot
//!     re-projects it back into sqlite (resurrection). So the reaper goes through
//!     NativeSync, which tombstones the Loro key too.
//!
//! The retention decision is a PURE fn — plan_node_reap(rows, now, ttls) — with
//! no clock/db/env, so every safety guarantee is a deterministic unit test.
//!
//! DispatchResult is deliberately NOT reapable: its id is deterministic (one
//! upsert per replyRef, tiny volume) and its consumer is unwired, so its safe
//! read window is unknown. It enters the allowlist only alongside a live
//! consumer, sized to that consumer's poll horizon.

use std::sync::Weak;
use std::time::Duration;

use crate::storage::NodeRow;
use crate::sync::NativeSync;

/// The ONLY node types the reaper may delete. Everything else is kept.
pub(crate) const REAPABLE_TYPES: &[&str] = &[
    crate::sidecar::AGENT_RESPONSE_NODE_TYPE,
    "StreamChunk",
    "StreamSession",
];

/// A StreamSession is only reapable once it reached a terminal status — an
/// `active` (still-streaming) session is never swept mid-flight.
const STREAM_SESSION_TERMINAL: &[&str] = &["completed", "failed"];

/// Default node TTL (6h). Far larger than the respond watch window
/// (respond_watch_timeout_ms default 45s) and the CLI stream-follow window, so
/// no in-flight or just-finished reader can race a delete.
const DEFAULT_NODE_TTL_MS: u64 = 21_600_000;
const DEFAULT_INTERVAL_MS: u64 = 3_600_000; // 1h, same cadence as the fs reaper
const DEFAULT_INITIAL_DELAY_MS: u64 = 60_000;

fn env_ms(var: &str, default: u64) -> u64 {
    std::env::var(var)
        .ok()
        .and_then(|raw| raw.parse::<u64>().ok())
        .filter(|ms| *ms > 0)
        .unwrap_or(default)
}

/// Per-type TTLs (ms). Separate env vars so an operator can tune one family
/// without the others, but all default to the same generous window.
#[derive(Debug, Clone, Copy)]
pub(crate) struct NodeTtls {
    pub(crate) agent_response_ms: u64,
    pub(crate) stream_chunk_ms: u64,
    pub(crate) stream_session_ms: u64,
}

impl NodeTtls {
    pub(crate) fn from_env() -> Self {
        Self {
            agent_response_ms: env_ms("REFARM_NODE_AGENT_RESPONSE_TTL_MS", DEFAULT_NODE_TTL_MS),
            stream_chunk_ms: env_ms("REFARM_NODE_STREAM_CHUNK_TTL_MS", DEFAULT_NODE_TTL_MS),
            stream_session_ms: env_ms("REFARM_NODE_STREAM_SESSION_TTL_MS", DEFAULT_NODE_TTL_MS),
        }
    }

    fn ttl_ms_for(&self, type_: &str) -> Option<u64> {
        match type_ {
            crate::sidecar::AGENT_RESPONSE_NODE_TYPE => Some(self.agent_response_ms),
            "StreamChunk" => Some(self.stream_chunk_ms),
            "StreamSession" => Some(self.stream_session_ms),
            _ => None, // not reapable
        }
    }
}

/// Cadence + TTL knobs for the streaming-node reaper. Resolved from env ONCE at
/// boot (`NodeReaperConfig::from_env`) and passed into `spawn_node_reaper`, so the
/// reaper reads a value, not process env — and tests construct it directly.
#[derive(Debug, Clone, Copy)]
pub struct NodeReaperConfig {
    pub(crate) ttls: NodeTtls,
    pub(crate) interval_ms: u64,
    pub(crate) initial_delay_ms: u64,
}

impl NodeReaperConfig {
    /// Resolve the node-reaper knobs from the process env. Called ONCE at boot.
    pub fn from_env() -> Self {
        Self {
            ttls: NodeTtls::from_env(),
            interval_ms: env_ms("REFARM_REAP_INTERVAL_MS", DEFAULT_INTERVAL_MS),
            initial_delay_ms: env_ms("REFARM_REAP_INITIAL_DELAY_MS", DEFAULT_INITIAL_DELAY_MS),
        }
    }
}

/// PURE retention decision: given the streaming-node rows, `now` (unix secs), and
/// the per-type TTLs, return the ids to reap. Only allowlisted types, only rows
/// whose updated_at is older than the type's TTL, and — for StreamSession — only
/// terminal sessions. An unparseable updated_at is fail-safe kept.
pub(crate) fn plan_node_reap(rows: &[NodeRow], now_secs: u64, ttls: &NodeTtls) -> Vec<String> {
    let mut ids = Vec::new();
    for row in rows {
        let Some(ttl_ms) = ttls.ttl_ms_for(&row.type_) else {
            continue; // not an allowlisted reapable type => keep.
        };
        // StreamSession: never sweep an active (non-terminal) session.
        if row.type_ == "StreamSession" && !stream_session_is_terminal(row) {
            continue;
        }
        let Some(updated_secs) = parse_sql_datetime_to_epoch_secs(&row.updated_at) else {
            continue; // unparseable timestamp => keep (never age 0).
        };
        let age_secs = now_secs.saturating_sub(updated_secs);
        if age_secs >= ttl_ms / 1000 {
            ids.push(row.id.clone());
        }
    }
    ids
}

/// Is a StreamSession row's payload status terminal (completed/failed)?
fn stream_session_is_terminal(row: &NodeRow) -> bool {
    let Ok(value) = serde_json::from_str::<serde_json::Value>(&row.payload) else {
        return false; // unreadable payload => treat as non-terminal => keep.
    };
    value
        .get("status")
        .and_then(|s| s.as_str())
        .map(|s| STREAM_SESSION_TERMINAL.contains(&s))
        .unwrap_or(false)
}

/// Fetch the reapable rows, plan, and delete through NativeSync (both models).
/// Returns the number of rows reaped.
pub(crate) fn run_node_reap(sync: &NativeSync, now_secs: u64, ttls: &NodeTtls) -> usize {
    let mut rows: Vec<NodeRow> = Vec::new();
    for type_ in REAPABLE_TYPES {
        match sync.query_nodes(type_) {
            Ok(mut r) => rows.append(&mut r),
            Err(error) => {
                tracing::warn!(%type_, %error, "node reaper: query failed");
            }
        }
    }
    let ids = plan_node_reap(&rows, now_secs, ttls);
    if ids.is_empty() {
        return 0;
    }
    match sync.delete_nodes_by_ids(&ids) {
        Ok(n) => {
            tracing::info!(reaped_nodes = n, "node reaper reclaimed streaming nodes");
            n
        }
        Err(error) => {
            tracing::warn!(%error, "node reaper: delete failed");
            0
        }
    }
}

/// Spawn the self-terminating streaming-node reaper. Holds a Weak to the Loro
/// doc so it exits once the NativeSync is dropped (mirrors the epoch ticker /
/// fs reaper teardown contract — no leaked task).
pub fn spawn_node_reaper(sync: &NativeSync, cfg: NodeReaperConfig) {
    let NodeReaperConfig {
        ttls,
        interval_ms,
        initial_delay_ms,
    } = cfg;

    let weak: Weak<_> = sync.weak_doc();
    let sync = sync.clone();

    tokio::spawn(async move {
        tokio::time::sleep(Duration::from_millis(initial_delay_ms)).await;
        loop {
            // Self-terminate once every other holder of the doc is gone. `sync`
            // here holds one strong ref to the doc; when the original owner
            // drops, the strong count falls to just ours, which is the teardown
            // signal (the fs reaper uses the same "we are the last owner" check).
            if weak.strong_count() <= 1 {
                break;
            }
            let now_secs = now_unix_secs();
            run_node_reap(&sync, now_secs, &ttls);
            tokio::time::sleep(Duration::from_millis(interval_ms)).await;
        }
        tracing::debug!("node reaper exiting (sync dropped)");
    });
}

fn now_unix_secs() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

/// Parse a SQL `datetime('now')` string — `YYYY-MM-DD HH:MM:SS` (space, no T/Z, UTC) — to unix seconds,
/// via the shared `time`-backed `timefmt` module. `None` on any malformed input => keep.
pub(crate) fn parse_sql_datetime_to_epoch_secs(s: &str) -> Option<u64> {
    crate::timefmt::sql_datetime_to_epoch_secs(s)
}

#[cfg(test)]
#[path = "node_reap_tests.rs"]
mod tests;
