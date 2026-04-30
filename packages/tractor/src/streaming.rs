mod observations;
mod sse_events;

pub(crate) const STREAM_KIND_AGENT_RESPONSE: &str = "agent-response";
pub(crate) const STREAM_SESSION_STATUS_ACTIVE: &str = "active";
pub(crate) const STREAM_SESSION_STATUS_COMPLETED: &str = "completed";
pub(crate) const STREAM_SESSION_STATUS_FAILED: &str = "failed";
pub(crate) const STREAM_CHUNK_PAYLOAD_KIND_TEXT_DELTA: &str = "text_delta";
pub(crate) const STREAM_CHUNK_PAYLOAD_KIND_FINAL_TEXT: &str = "final_text";
pub(crate) const STREAM_CHUNK_PAYLOAD_KIND_FINAL_TOOL_CALL: &str = "final_tool_call";
pub(crate) const STREAM_CHUNK_PAYLOAD_KIND_FINAL_EMPTY: &str = "final_empty";

pub(crate) use observations::{
    agent_response_stream_ref, stream_chunk_observation_id, stream_chunk_observation_node,
    stream_session_observation_id, stream_session_observation_node, StreamChunkObservationDraft,
    StreamSessionObservationDraft,
};
pub(crate) use sse_events::{parse_sse_data_events, read_sse_data_events_limited};
