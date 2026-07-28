// Connection frames — a connection's observable output, published on the EXISTING
// stream:v1 contract rather than a new one. The TS transports (sse/ws/file) and
// `stream-follower` already consume this shape, so a remote surface inherits both SSE and
// WebSocket without choosing.
//
// Raw process output is deliberately NOT published. Notices are the curated channel; a raw
// transcript is noise and one more surface for sensitive text to leave the host.

use crate::streaming::{
    stream_chunk_observation_id, stream_chunk_observation_node, stream_session_observation_id,
    stream_session_observation_node, StreamChunkObservationDraft, StreamSessionObservationDraft,
};
use crate::sync::NativeSync;

/// The stream a connection publishes on. Stable and derivable, so any surface can
/// subscribe by name without asking the host for a handle.
pub(crate) fn connection_stream_ref(name: &str) -> String {
    format!("urn:tractor:stream:connection:{name}")
}

pub(crate) struct ConnectionFramePublisher {
    stream_ref: String,
    sequence: u32,
    chunk_count: u32,
    started_at_ns: u64,
}

impl ConnectionFramePublisher {
    pub(crate) fn new(name: &str, now_ns: u64) -> Self {
        Self {
            stream_ref: connection_stream_ref(name),
            sequence: 0,
            chunk_count: 0,
            started_at_ns: now_ns,
        }
    }

    pub(crate) fn last_sequence(&self) -> u32 {
        self.sequence
    }

    /// A human-facing message matched in the output (a push-approval wait, etc.).
    pub(crate) fn notice(
        &mut self,
        sync: &NativeSync,
        message: &str,
        now_ns: u64,
    ) -> Result<(), String> {
        self.chunk(sync, "notice", message, false, now_ns)?;
        self.session(sync, "active", None, now_ns)
    }

    /// The last frame of an attempt. `reason` is `ready` / `timeout` / `exit` / `error`.
    pub(crate) fn terminal(
        &mut self,
        sync: &NativeSync,
        reason: &str,
        detail: &str,
        now_ns: u64,
    ) -> Result<(), String> {
        self.chunk(sync, reason, detail, true, now_ns)?;
        let status = if reason == "ready" { "completed" } else { "failed" };
        self.session(sync, status, Some(now_ns), now_ns)
    }

    fn chunk(
        &mut self,
        sync: &NativeSync,
        payload_kind: &str,
        content: &str,
        is_final: bool,
        now_ns: u64,
    ) -> Result<(), String> {
        self.sequence += 1;
        self.chunk_count += 1;
        let draft = StreamChunkObservationDraft {
            stream_ref: self.stream_ref.clone(),
            sequence: self.sequence,
            payload_kind: payload_kind.to_string(),
            content: content.to_string(),
            is_final,
            timestamp_ns: now_ns,
            metadata: serde_json::json!({}),
        };
        let node_id = stream_chunk_observation_id();
        let node = stream_chunk_observation_node(&node_id, &draft);
        sync.store_node(&node_id, "StreamChunk", None, &node.to_string(), None)
            .map_err(|e| format!("store connection chunk: {e}"))?;
        Ok(())
    }

    fn session(
        &self,
        sync: &NativeSync,
        status: &str,
        completed_at_ns: Option<u64>,
        now_ns: u64,
    ) -> Result<(), String> {
        let draft = StreamSessionObservationDraft {
            stream_ref: self.stream_ref.clone(),
            stream_kind: "connection".to_string(),
            status: status.to_string(),
            started_at_ns: self.started_at_ns,
            updated_at_ns: now_ns,
            completed_at_ns,
            last_sequence: Some(self.sequence),
            chunk_count: self.chunk_count,
            metadata: serde_json::json!({}),
        };
        let node_id = stream_session_observation_id(&self.stream_ref);
        let node = stream_session_observation_node(&node_id, &draft);
        sync.store_node(&node_id, "StreamSession", None, &node.to_string(), None)
            .map_err(|e| format!("store connection session: {e}"))?;
        Ok(())
    }
}
