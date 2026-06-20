use crate::runtime::streaming_metadata::{final_stream_chunk_ndjson, FinalStreamChunkInput};

#[test]
fn final_stream_chunk_metadata_marks_subscription_as_not_billable_api() {
    let line = final_stream_chunk_ndjson(FinalStreamChunkInput {
        stream_ref: "urn:tractor:stream:agent-response:test",
        content: "ok",
        model: "gpt-5.5",
        provider: "openai-codex",
        tokens_in: 1_000,
        tokens_out: 10,
        tokens_cached: 0,
    });
    let chunk: serde_json::Value = serde_json::from_str(&line).expect("valid stream chunk");

    assert_eq!(chunk["metadata"]["provider"], "openai-codex");
    assert_eq!(chunk["metadata"]["pricing_mode"], "subscription");
    assert_eq!(chunk["metadata"]["estimated_usd"], 0.0);
}

#[test]
fn final_stream_chunk_metadata_keeps_api_billable_estimate() {
    let line = final_stream_chunk_ndjson(FinalStreamChunkInput {
        stream_ref: "urn:tractor:stream:agent-response:test",
        content: "ok",
        model: "gpt-5.5",
        provider: "openai",
        tokens_in: 1_000,
        tokens_out: 10,
        tokens_cached: 0,
    });
    let chunk: serde_json::Value = serde_json::from_str(&line).expect("valid stream chunk");

    assert_eq!(chunk["metadata"]["provider"], "openai");
    assert_eq!(chunk["metadata"]["pricing_mode"], "api");
    assert!(
        chunk["metadata"]["estimated_usd"]
            .as_f64()
            .unwrap_or_default()
            > 0.0,
        "api routes should keep an estimated billable amount",
    );
}
