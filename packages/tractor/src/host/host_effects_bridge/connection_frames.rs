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

// These surfaces are complete and fully unit-tested, but nothing in the crate CALLS them
// yet: the consumer is the `host-connection` WIT surface, which is a later plan. Marked
// `allow(dead_code)` for the non-test build ONLY — the test build still audits them — so the
// crate stays warning-clean and a genuinely new warning is not buried under twenty of these.

/// The stream a connection publishes on. Stable and derivable, so any surface can
/// subscribe by name without asking the host for a handle.
#[cfg_attr(not(test), allow(dead_code))]
pub(crate) fn connection_stream_ref(name: &str) -> String {
    format!("urn:tractor:stream:connection:{name}")
}

pub(crate) struct ConnectionFramePublisher {
    stream_ref: String,
    sequence: u32,
    chunk_count: u32,
    started_at_ns: u64,
}

#[cfg_attr(not(test), allow(dead_code))]
impl ConnectionFramePublisher {
    /// Open (or RESUME) the connection's stream.
    ///
    /// `stream_ref` and the session node id are stable per connection NAME, so a second
    /// establish attempt writes to the same stream a consumer is already following. Starting
    /// `sequence` back at 0 on every attempt would therefore make that consumer's resume
    /// cursor go BACKWARDS after a re-establish — it would either replay frames it already
    /// saw or, worse, filter out the new ones as stale. The cursor is continued from the
    /// session node's own `last_sequence`, which is the value the consumer holds.
    ///
    /// A storage read is best-effort here: a publisher must always be constructible, so an
    /// unreadable or absent session simply starts a fresh stream at 0.
    pub(crate) fn new(sync: &NativeSync, name: &str, now_ns: u64) -> Self {
        let stream_ref = connection_stream_ref(name);
        let prior = sync
            .get_node(&stream_session_observation_id(&stream_ref))
            .ok()
            .flatten()
            .and_then(|raw| serde_json::from_str::<serde_json::Value>(&raw).ok());
        let (sequence, chunk_count, started_at_ns) = match prior {
            Some(node) => (
                node.get("last_sequence").and_then(|v| v.as_u64()).unwrap_or(0) as u32,
                node.get("chunk_count").and_then(|v| v.as_u64()).unwrap_or(0) as u32,
                node.get("started_at_ns").and_then(|v| v.as_u64()).unwrap_or(now_ns),
            ),
            None => (0, 0, now_ns),
        };
        Self { stream_ref, sequence, chunk_count, started_at_ns }
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
        // `is_final` on the CHUNK is right either way — it closes the establish attempt.
        // The SESSION is a different lifetime: `ready` means the tunnel is now UP and
        // HOLDING, which is the opposite of finished. Marking it `completed` put it in
        // `node_reap`'s terminal set (`completed`/`failed`), so after the TTL the reaper
        // would sweep the session node — and with it the resume cursor — out from under a
        // live connection. Only a failure reason genuinely settles the session.
        let (status, completed_at_ns) = if reason == "ready" {
            ("active", None)
        } else {
            ("failed", Some(now_ns))
        };
        self.session(sync, status, completed_at_ns, now_ns)
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
