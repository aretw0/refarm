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

pub(crate) fn stream_chunk_observation_id() -> String {
    format!("urn:tractor:stream-chunk:{}", uuid::Uuid::new_v4())
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
}
