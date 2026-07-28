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

    #[test]
    fn a_notice_becomes_a_notice_chunk() {
        let sync = sync();
        let mut p = ConnectionFramePublisher::new("serpro-vpn", 1);
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
        let mut p = ConnectionFramePublisher::new("c", 1);
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
        let mut p = ConnectionFramePublisher::new("c", 1);
        p.terminal(&sync, "timeout", "probe never succeeded", 2).unwrap();

        let found = chunks(&sync, &connection_stream_ref("c"));
        assert_eq!(found.len(), 1);
        assert_eq!(found[0]["payload_kind"], "timeout");
        assert_eq!(found[0]["is_final"], true);
        assert_eq!(found[0]["content"], "probe never succeeded");
    }

    #[test]
    fn a_non_ready_terminal_reason_marks_the_session_failed() {
        // The `status` branch in `ConnectionFramePublisher::terminal` is
        // `"completed"` only for `reason == "ready"`; every other reason (timeout,
        // exit, error, ...) must land as `"failed"`. Without this assertion,
        // collapsing the branch to always return `"completed"` would not fail
        // any test.
        let sync = sync();
        let mut p = ConnectionFramePublisher::new("c", 1);
        p.terminal(&sync, "timeout", "probe never succeeded", 2).unwrap();

        let raw = sync.get_node(&connection_stream_ref("c")).unwrap().unwrap();
        let node: serde_json::Value = serde_json::from_str(&raw).unwrap();
        assert_eq!(node["@type"], "StreamSession");
        assert_eq!(node["status"], "failed");
    }

    #[test]
    fn a_session_node_tracks_the_connection_instance() {
        let sync = sync();
        let mut p = ConnectionFramePublisher::new("c", 10);
        p.notice(&sync, "n", 11).unwrap();
        p.terminal(&sync, "ready", "", 12).unwrap();

        let raw = sync.get_node(&connection_stream_ref("c")).unwrap().unwrap();
        let node: serde_json::Value = serde_json::from_str(&raw).unwrap();
        assert_eq!(node["@type"], "StreamSession");
        assert_eq!(node["stream_kind"], "connection");
        assert_eq!(node["status"], "completed");
        assert_eq!(node["last_sequence"], 2);
        assert_eq!(node["chunk_count"], 2);
    }

    #[test]
    fn a_session_is_active_until_a_terminal_frame() {
        // node_reap never sweeps a non-terminal StreamSession, so a live connection's
        // session must NOT be marked completed while it is still coming up.
        let sync = sync();
        let mut p = ConnectionFramePublisher::new("c", 10);
        p.notice(&sync, "n", 11).unwrap();

        let raw = sync.get_node(&connection_stream_ref("c")).unwrap().unwrap();
        let node: serde_json::Value = serde_json::from_str(&raw).unwrap();
        assert_eq!(node["status"], "active");
    }
}
