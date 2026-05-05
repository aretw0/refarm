#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct StreamChunkObservationDraft {
    pub(crate) stream_ref: String,
    pub(crate) sequence: u32,
    pub(crate) payload_kind: String,
    pub(crate) content: String,
    pub(crate) is_final: bool,
    pub(crate) timestamp_ns: u64,
    pub(crate) metadata: serde_json::Value,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct StreamSessionObservationDraft {
    pub(crate) stream_ref: String,
    pub(crate) stream_kind: String,
    pub(crate) status: String,
    pub(crate) started_at_ns: u64,
    pub(crate) updated_at_ns: u64,
    pub(crate) completed_at_ns: Option<u64>,
    pub(crate) last_sequence: Option<u32>,
    pub(crate) chunk_count: u32,
    pub(crate) metadata: serde_json::Value,
}

pub(crate) fn stream_chunk_observation_id() -> String {
    format!("urn:tractor:stream-chunk:{}", uuid::Uuid::new_v4())
}

pub(crate) fn stream_session_observation_id(stream_ref: &str) -> String {
    stream_ref.to_string()
}

pub(crate) fn agent_response_stream_ref(prompt_ref: &str) -> String {
    format!("urn:tractor:stream:agent-response:{prompt_ref}")
}

pub(crate) fn stream_chunk_observation_node(
    node_id: &str,
    draft: &StreamChunkObservationDraft,
) -> serde_json::Value {
    serde_json::json!({
        "@type":       "StreamChunk",
        "@id":         node_id,
        "stream_ref":  draft.stream_ref,
        "sequence":    draft.sequence,
        "payload_kind": draft.payload_kind,
        "content":     draft.content,
        "is_final":    draft.is_final,
        "timestamp_ns": draft.timestamp_ns,
        "metadata":    draft.metadata,
    })
}

pub(crate) fn stream_session_observation_node(
    node_id: &str,
    draft: &StreamSessionObservationDraft,
) -> serde_json::Value {
    serde_json::json!({
        "@type":          "StreamSession",
        "@id":            node_id,
        "stream_ref":     draft.stream_ref,
        "stream_kind":    draft.stream_kind,
        "status":         draft.status,
        "started_at_ns":  draft.started_at_ns,
        "updated_at_ns":  draft.updated_at_ns,
        "completed_at_ns": draft.completed_at_ns,
        "last_sequence":  draft.last_sequence,
        "chunk_count":    draft.chunk_count,
        "metadata":       draft.metadata,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn agent_response_stream_ref_is_prompt_scoped() {
        assert_eq!(
            agent_response_stream_ref("prompt-abc"),
            "urn:tractor:stream:agent-response:prompt-abc",
        );
    }

    #[test]
    fn stream_chunk_observation_node_matches_generic_schema() {
        let draft = StreamChunkObservationDraft {
            stream_ref: "urn:tractor:stream:test".to_string(),
            sequence: 2,
            payload_kind: "text_delta".to_string(),
            content: "hello".to_string(),
            is_final: false,
            timestamp_ns: 123,
            metadata: serde_json::json!({
                "projection": "AgentResponse",
                "prompt_ref": "prompt-abc",
            }),
        };

        let node = stream_chunk_observation_node("urn:test:chunk:1", &draft);

        assert_eq!(node["@type"], "StreamChunk");
        assert_eq!(node["@id"], "urn:test:chunk:1");
        assert_eq!(node["stream_ref"], "urn:tractor:stream:test");
        assert_eq!(node["sequence"], 2);
        assert_eq!(node["payload_kind"], "text_delta");
        assert_eq!(node["content"], "hello");
        assert_eq!(node["is_final"], false);
        assert_eq!(node["timestamp_ns"], 123);
        assert_eq!(node["metadata"]["projection"], "AgentResponse");
        assert_eq!(node["metadata"]["prompt_ref"], "prompt-abc");
    }

    #[test]
    fn stream_session_observation_node_matches_generic_schema() {
        let draft = StreamSessionObservationDraft {
            stream_ref: "urn:tractor:stream:test".to_string(),
            stream_kind: "agent-response".to_string(),
            status: "completed".to_string(),
            started_at_ns: 100,
            updated_at_ns: 200,
            completed_at_ns: Some(200),
            last_sequence: Some(3),
            chunk_count: 4,
            metadata: serde_json::json!({
                "projection": "AgentResponse",
                "prompt_ref": "prompt-abc",
            }),
        };

        let node_id = stream_session_observation_id(&draft.stream_ref);
        let node = stream_session_observation_node(&node_id, &draft);

        assert_eq!(node["@type"], "StreamSession");
        assert_eq!(node["@id"], "urn:tractor:stream:test");
        assert_eq!(node["stream_ref"], "urn:tractor:stream:test");
        assert_eq!(node["stream_kind"], "agent-response");
        assert_eq!(node["status"], "completed");
        assert_eq!(node["started_at_ns"], 100);
        assert_eq!(node["updated_at_ns"], 200);
        assert_eq!(node["completed_at_ns"], 200);
        assert_eq!(node["last_sequence"], 3);
        assert_eq!(node["chunk_count"], 4);
        assert_eq!(node["metadata"]["projection"], "AgentResponse");
    }
}
