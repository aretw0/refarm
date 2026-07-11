// Streaming-node reaper safety suite. plan_node_reap is a pure fn (rows, now,
// ttls) -> ids, so most tests are deterministic with no db/clock. The
// integration tests (run_node_reap + loro resurrection) use a :memory: sync.
// The invariant: the reaper is an ALLOWLIST — it only ever deletes the three
// streaming types, never a durable domain node, and it deletes from BOTH models.

use super::*;
use crate::storage::{NativeStorage, NodeRow};
use crate::sync::NativeSync;

const HOUR_MS: u64 = 3_600_000;
const NOW: u64 = 2_000_000_000; // fixed unix secs

fn ttls(ms: u64) -> NodeTtls {
    NodeTtls {
        agent_response_ms: ms,
        stream_chunk_ms: ms,
        stream_session_ms: ms,
    }
}

/// A NodeRow of `type_` whose updated_at is `age_secs` before NOW, in the SQL
/// datetime format the nodes column uses.
fn row(id: &str, type_: &str, age_secs: u64, payload: &str) -> NodeRow {
    let secs = NOW - age_secs;
    let (y, mo, d, h, mi, s) = crate::sidecar::epoch_to_parts(secs);
    NodeRow {
        id: id.to_string(),
        type_: type_.to_string(),
        context: None,
        payload: payload.to_string(),
        source_plugin: None,
        updated_at: format!("{y:04}-{mo:02}-{d:02} {h:02}:{mi:02}:{s:02}"),
    }
}

// ── parse_sql_datetime_to_epoch_secs ─────────────────────────────────────────

#[test]
fn sql_datetime_round_trips() {
    for secs in [0u64, 1_000_000, NOW, 4_000_000_000] {
        let (y, mo, d, h, mi, s) = crate::sidecar::epoch_to_parts(secs);
        let sql = format!("{y:04}-{mo:02}-{d:02} {h:02}:{mi:02}:{s:02}");
        assert_eq!(parse_sql_datetime_to_epoch_secs(&sql), Some(secs), "{sql}");
    }
}

#[test]
fn malformed_sql_datetime_is_none() {
    for bad in [
        "",
        "2033-05-18T03:33:20Z", // ISO, wrong format (T/Z)
        "2033-05-18T03:33:20",  // T not space
        "2033-13-18 03:33:20",  // month 13
        "not-a-date",
    ] {
        assert_eq!(parse_sql_datetime_to_epoch_secs(bad), None, "{bad}");
    }
}

// ── plan_node_reap (pure) ────────────────────────────────────────────────────

/// THE most important test: given rows of every NEVER-REAP type, even far older
/// than any TTL, the plan is EMPTY. An allowlist must prove it never touches an
/// unlisted type (a denylist would sweep a new durable type).
#[test]
fn allowlist_only_never_reaps_durable_types() {
    let never = [
        "Session",
        "SessionEntry",
        "Task",
        "TaskEvent",
        "RefarmConfig",
        "Message",
        "Note",
        "Article",
        "Unknown",
        "DispatchResult",
    ];
    let rows: Vec<NodeRow> = never
        .iter()
        .enumerate()
        .map(|(i, t)| row(&format!("n{i}"), t, 365 * 86_400, "{}"))
        .collect();
    let plan = plan_node_reap(&rows, NOW, &ttls(HOUR_MS));
    assert!(
        plan.is_empty(),
        "no durable/unlisted type may ever be reaped: {plan:?}"
    );
}

/// A newly introduced node type defaults to KEEP (guards the allowlist invariant
/// against future types).
#[test]
fn new_type_is_kept() {
    let rows = vec![row("x", "FutureDurableThing", 365 * 86_400, "{}")];
    assert!(plan_node_reap(&rows, NOW, &ttls(0)).is_empty());
}

#[test]
fn dispatch_result_excluded_even_when_old() {
    // Locks in the defer decision: DispatchResult is never reaped here, so a
    // later edit can't silently start reaping it without breaking this test.
    let rows = vec![row("dr", "DispatchResult", 365 * 86_400, "{}")];
    assert!(plan_node_reap(&rows, NOW, &ttls(0)).is_empty());
}

#[test]
fn reaps_old_streaming_nodes() {
    let rows = vec![
        row("a", "Response", 12 * 3600, "{}"), // 12h old
        row("c", "StreamChunk", 12 * 3600, "{}"),
    ];
    // TTL 6h => both are old enough.
    let plan = plan_node_reap(&rows, NOW, &ttls(6 * HOUR_MS));
    assert_eq!(plan.len(), 2);
    assert!(plan.contains(&"a".to_string()) && plan.contains(&"c".to_string()));
}

/// WATCH-WINDOW GUARD: a fresh AgentResponse (well within the reader window) is
/// never reaped — only rows older than the full TTL are.
#[test]
fn fresh_streaming_node_within_watch_window_survives() {
    let rows = vec![row("a", "Response", 45, "{}")]; // 45s old (the watch window)
    let plan = plan_node_reap(&rows, NOW, &ttls(6 * HOUR_MS));
    assert!(plan.is_empty(), "a just-written AgentResponse must survive");
}

#[test]
fn unparseable_updated_at_kept() {
    let mut r = row("a", "Response", 12 * 3600, "{}");
    r.updated_at = "garbage".to_string();
    assert!(
        plan_node_reap(&[r], NOW, &ttls(0)).is_empty(),
        "bad timestamp => keep"
    );
}

/// An active (non-terminal) StreamSession is never swept, regardless of age.
#[test]
fn active_stream_session_never_reaped() {
    let rows = vec![row(
        "s",
        "StreamSession",
        365 * 86_400,
        r#"{"status":"active"}"#,
    )];
    assert!(
        plan_node_reap(&rows, NOW, &ttls(0)).is_empty(),
        "an open stream session must never be reaped mid-flight"
    );
}

#[test]
fn terminal_stream_session_reaped_when_old() {
    for status in ["completed", "failed"] {
        let payload = format!(r#"{{"status":"{status}"}}"#);
        let rows = vec![row("s", "StreamSession", 12 * 3600, &payload)];
        let plan = plan_node_reap(&rows, NOW, &ttls(6 * HOUR_MS));
        assert_eq!(
            plan,
            vec!["s".to_string()],
            "terminal ({status}) old session is reapable"
        );
    }
}

#[test]
fn per_type_ttls_are_independent() {
    let rows = vec![
        row("a", "Response", 3 * 3600, "{}"), // 3h old
        row("c", "StreamChunk", 3 * 3600, "{}"),
    ];
    // AgentResponse TTL 6h (keep), StreamChunk TTL 1h (reap).
    let t = NodeTtls {
        agent_response_ms: 6 * HOUR_MS,
        stream_chunk_ms: HOUR_MS,
        stream_session_ms: 6 * HOUR_MS,
    };
    let plan = plan_node_reap(&rows, NOW, &t);
    assert_eq!(
        plan,
        vec!["c".to_string()],
        "only the short-TTL type is reaped"
    );
}

// ── integration: run_node_reap + loro resurrection ───────────────────────────

fn make_sync() -> NativeSync {
    let storage = NativeStorage::open(":memory:").unwrap();
    NativeSync::new(storage, ":memory:").unwrap()
}

#[test]
fn loro_resurrection_regression_delete_removes_from_both_models() {
    // The crux: after reaping a node, a re-projection (project_all, run on
    // apply_update/import_snapshot) must NOT bring it back. We prove the row is
    // gone from the Loro doc too, so project_all can't resurrect it.
    let sync = make_sync();
    // Store a reapable node.
    sync.store_node(
        "urn:chunk1",
        "StreamChunk",
        None,
        r#"{"is_final":true}"#,
        None,
    )
    .unwrap();
    assert_eq!(sync.query_nodes("StreamChunk").unwrap().len(), 1);

    // Delete via the durable path (both models).
    let n = sync
        .delete_nodes_by_ids(&["urn:chunk1".to_string()])
        .unwrap();
    assert_eq!(n, 1);
    assert!(
        sync.query_nodes("StreamChunk").unwrap().is_empty(),
        "gone from sqlite"
    );

    // Re-project the Loro doc into sqlite (what a peer sync / snapshot restore
    // triggers). If the key were still in the Loro map, it would come back.
    sync.project_all().unwrap();
    assert!(
        sync.query_nodes("StreamChunk").unwrap().is_empty(),
        "a reaped node must NOT be resurrected by project_all — the Loro key was tombstoned"
    );
}

#[test]
fn run_node_reap_reaps_only_old_streaming_and_keeps_durable() {
    let sync = make_sync();
    // A durable node and a streaming node, both written now.
    sync.store_node("urn:session1", "Session", None, "{}", None)
        .unwrap();
    sync.store_node("urn:chunk1", "StreamChunk", None, "{}", None)
        .unwrap();

    // Reap with now far in the FUTURE so the just-written chunk is "old" (its
    // updated_at is real-now; we pass a huge now_secs and a zero TTL).
    let future_now = now_unix_secs() + 10 * 86_400;
    let reaped = run_node_reap(&sync, future_now, &ttls(0));
    assert_eq!(reaped, 1, "exactly the streaming node is reaped");
    assert_eq!(
        sync.query_nodes("StreamChunk").unwrap().len(),
        0,
        "chunk gone"
    );
    assert_eq!(
        sync.query_nodes("Session").unwrap().len(),
        1,
        "durable Session kept"
    );
}
