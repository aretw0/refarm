// Connection frames — every observed transition becomes a stream:v1 chunk on the
// connection's stream_ref, plus one StreamSession per connection instance.

#[cfg(test)]
mod connection_frames_tests {
    use super::*;
    use crate::{NativeStorage, NativeSync};

    fn sync() -> NativeSync {
        let storage = NativeStorage::open(":memory:").unwrap();
        NativeSync::new(storage, ":memory:").unwrap()
    }

    fn chunks(sync: &NativeSync, stream_ref: &str) -> Vec<serde_json::Value> {
        let mut found: Vec<serde_json::Value> = sync
            .query_nodes("StreamChunk")
            .unwrap_or_default()
            .iter()
            .filter_map(|row| serde_json::from_str::<serde_json::Value>(&row.payload).ok())
            .filter(|n| n.get("stream_ref").and_then(|v| v.as_str()) == Some(stream_ref))
            .collect();
        found.sort_by_key(|n| n.get("sequence").and_then(|v| v.as_u64()).unwrap_or(0));
        found
    }

    #[test]
    fn stream_ref_is_derived_from_the_connection_name() {
        assert_eq!(
            connection_stream_ref("serpro-vpn"),
            "urn:tractor:stream:connection:serpro-vpn"
        );
    }

    fn session(sync: &NativeSync, name: &str) -> serde_json::Value {
        let raw = sync.get_node(&connection_stream_ref(name)).unwrap().unwrap();
        serde_json::from_str(&raw).unwrap()
    }

    #[test]
    fn a_notice_becomes_a_notice_chunk() {
        let sync = sync();
        let mut p = ConnectionFramePublisher::new(&sync, "serpro-vpn", 1);
        p.notice(&sync, "aprove o push no celular", 2).unwrap();

        let found = chunks(&sync, &connection_stream_ref("serpro-vpn"));
        assert_eq!(found.len(), 1);
        assert_eq!(found[0]["payload_kind"], "notice");
        assert_eq!(found[0]["content"], "aprove o push no celular");
        assert_eq!(found[0]["is_final"], false);
    }

    #[test]
    fn sequence_numbers_increase_strictly_across_frames() {
        let sync = sync();
        let mut p = ConnectionFramePublisher::new(&sync, "c", 1);
        p.notice(&sync, "one", 2).unwrap();
        p.notice(&sync, "two", 3).unwrap();
        p.terminal(&sync, "ready", "", 4).unwrap();

        let seqs: Vec<u64> = chunks(&sync, &connection_stream_ref("c"))
            .iter()
            .map(|n| n["sequence"].as_u64().unwrap())
            .collect();
        assert_eq!(seqs, vec![1, 2, 3]);
        assert_eq!(p.last_sequence(), 3);
    }

    #[test]
    fn the_terminal_frame_is_final_and_carries_the_reason() {
        let sync = sync();
        let mut p = ConnectionFramePublisher::new(&sync, "c", 1);
        p.terminal(&sync, "timeout", "probe never succeeded", 2).unwrap();

        let found = chunks(&sync, &connection_stream_ref("c"));
        assert_eq!(found.len(), 1);
        assert_eq!(found[0]["payload_kind"], "timeout");
        assert_eq!(found[0]["is_final"], true);
        assert_eq!(found[0]["content"], "probe never succeeded");
    }

    #[test]
    fn a_non_ready_terminal_reason_marks_the_session_failed() {
        // A failure genuinely settles the session: the attempt is over and nothing is
        // holding a connection, so the node is free to be reaped. Without this assertion,
        // collapsing the branch to always return `"active"` would not fail any test.
        let sync = sync();
        let mut p = ConnectionFramePublisher::new(&sync, "c", 1);
        p.terminal(&sync, "timeout", "probe never succeeded", 2).unwrap();

        let node = session(&sync, "c");
        assert_eq!(node["@type"], "StreamSession");
        assert_eq!(node["status"], "failed");
        assert_eq!(node["completed_at_ns"], 2);
    }

    #[test]
    fn a_session_node_tracks_the_connection_instance() {
        let sync = sync();
        let mut p = ConnectionFramePublisher::new(&sync, "c", 10);
        p.notice(&sync, "n", 11).unwrap();
        p.terminal(&sync, "ready", "", 12).unwrap();

        let node = session(&sync, "c");
        assert_eq!(node["@type"], "StreamSession");
        assert_eq!(node["stream_kind"], "connection");
        assert_eq!(node["last_sequence"], 2);
        assert_eq!(node["chunk_count"], 2);
    }

    #[test]
    fn a_session_is_active_until_a_terminal_frame() {
        // node_reap never sweeps a non-terminal StreamSession, so a live connection's
        // session must NOT be marked completed while it is still coming up.
        let sync = sync();
        let mut p = ConnectionFramePublisher::new(&sync, "c", 10);
        p.notice(&sync, "n", 11).unwrap();

        let node = session(&sync, "c");
        assert_eq!(node["status"], "active");
    }

    #[test]
    fn a_ready_terminal_frame_leaves_the_session_active_because_the_connection_is_live() {
        // `ready` is when the tunnel comes UP — the session's most ALIVE moment. Marking it
        // `"completed"` put it in node_reap's terminal set (`completed`/`failed`), so after
        // the TTL the reaper would sweep the live connection's session node and its resume
        // cursor. The chunk stays `is_final` (the establish attempt IS over); only the
        // session's own lifetime differs.
        let sync = sync();
        let mut p = ConnectionFramePublisher::new(&sync, "c", 10);
        p.terminal(&sync, "ready", "", 12).unwrap();

        let node = session(&sync, "c");
        assert_eq!(node["status"], "active", "a live connection's session is not terminal");
        assert_eq!(node["completed_at_ns"], serde_json::Value::Null);
        assert_eq!(
            chunks(&sync, &connection_stream_ref("c"))[0]["is_final"],
            true,
            "the chunk still closes the establish attempt"
        );

    }

    #[test]
    fn a_failure_reason_still_settles_the_session_so_a_dead_attempt_is_reapable() {
        // The other half of the same branch: nothing is holding a connection after `exit`
        // or `timeout`, so the session IS terminal and node_reap may sweep it.
        let sync = sync();
        let mut p = ConnectionFramePublisher::new(&sync, "c", 10);
        p.terminal(&sync, "exit", "the process ended first", 12).unwrap();

        let node = session(&sync, "c");
        assert_eq!(node["status"], "failed");
        assert_eq!(node["completed_at_ns"], 12);
    }

    #[test]
    fn the_frame_cursor_continues_across_a_re_establish() {
        // `stream_ref` and the session node id are stable per connection NAME, so a second
        // attempt writes into the stream a consumer is already following. Restarting
        // `sequence` at 0 made that consumer's resume cursor go backwards — the design's
        // resume-cursor claim depends on this staying monotonic.
        let sync = sync();
        let mut first = ConnectionFramePublisher::new(&sync, "c", 10);
        first.notice(&sync, "aprove o push", 11).unwrap();
        first.terminal(&sync, "timeout", "probe never succeeded", 12).unwrap();
        assert_eq!(first.last_sequence(), 2);

        // The operator retries. Same name ⇒ same stream ⇒ the cursor must continue.
        let mut second = ConnectionFramePublisher::new(&sync, "c", 20);
        second.notice(&sync, "aprove o push", 21).unwrap();
        second.terminal(&sync, "ready", "", 22).unwrap();

        assert_eq!(second.last_sequence(), 4, "the cursor must not restart at 0");
        let seqs: Vec<u64> = chunks(&sync, &connection_stream_ref("c"))
            .iter()
            .map(|n| n["sequence"].as_u64().unwrap())
            .collect();
        assert_eq!(seqs, vec![1, 2, 3, 4], "a consumer must never see a sequence go backwards");

        let node = session(&sync, "c");
        assert_eq!(node["last_sequence"], 4);
        assert_eq!(node["chunk_count"], 4);
        assert_eq!(node["started_at_ns"], 10, "the stream began with the first attempt");
    }
}
