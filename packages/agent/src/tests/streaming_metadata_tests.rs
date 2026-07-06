use crate::runtime::streaming_metadata::{final_stream_chunk_ndjson, FinalStreamChunkInput};

#[test]
fn final_stream_chunk_metadata_marks_subscription_as_not_billable_api() {
    let line = final_stream_chunk_ndjson(FinalStreamChunkInput {
        stream_ref: "urn:tractor:stream:response:test",
        content: "ok",
        model: "gpt-5.5",
        provider: "openai-codex",
        tokens_in: 1_000,
        tokens_out: 10,
        tokens_cached: 0,
        partials_present: false,
        sequence: 0,
    });
    let chunk: serde_json::Value = serde_json::from_str(&line).expect("valid stream chunk");

    assert_eq!(chunk["metadata"]["provider"], "openai-codex");
    assert_eq!(chunk["metadata"]["pricing_mode"], "subscription");
    assert_eq!(chunk["metadata"]["estimated_usd"], 0.0);
}

#[test]
fn final_stream_chunk_metadata_keeps_api_billable_estimate() {
    let line = final_stream_chunk_ndjson(FinalStreamChunkInput {
        stream_ref: "urn:tractor:stream:response:test",
        content: "ok",
        model: "gpt-5.5",
        provider: "openai",
        tokens_in: 1_000,
        tokens_out: 10,
        tokens_cached: 0,
        partials_present: false,
        sequence: 0,
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

#[test]
fn final_marker_is_empty_when_partials_present() {
    // When partial delta lines preceded it, the final line is a pure end-marker:
    // content:"" so the CLI's `content += chunk.content` does not double-count the
    // answer the deltas already carried; the sequence follows the last partial.
    let line = final_stream_chunk_ndjson(FinalStreamChunkInput {
        stream_ref: "urn:tractor:stream:response:test",
        content: "the whole answer",
        model: "gpt-5.5",
        provider: "openai",
        tokens_in: 100,
        tokens_out: 10,
        tokens_cached: 0,
        partials_present: true,
        sequence: 3,
    });
    let chunk: serde_json::Value = serde_json::from_str(&line).expect("valid stream chunk");

    assert_eq!(chunk["content"], "", "final must add nothing when partials carried the text");
    assert_eq!(chunk["sequence"], 3, "final sorts after the last partial");
    assert_eq!(chunk["is_final"], true);
    assert_eq!(chunk["metadata"]["model"], "gpt-5.5");
}

#[test]
fn final_carries_whole_answer_when_no_partials() {
    // Single-shot / non-SSE: no partials, so the final IS the only line and must
    // carry the whole answer at sequence 0 (today's exact behavior, unchanged).
    let line = final_stream_chunk_ndjson(FinalStreamChunkInput {
        stream_ref: "urn:tractor:stream:response:test",
        content: "the whole answer",
        model: "gpt-5.5",
        provider: "openai",
        tokens_in: 100,
        tokens_out: 10,
        tokens_cached: 0,
        partials_present: false,
        sequence: 0,
    });
    let chunk: serde_json::Value = serde_json::from_str(&line).expect("valid stream chunk");

    assert_eq!(chunk["content"], "the whole answer");
    assert_eq!(chunk["sequence"], 0);
    assert_eq!(chunk["is_final"], true);
}
