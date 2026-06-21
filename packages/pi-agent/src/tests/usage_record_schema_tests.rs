use super::*;

#[test]
fn usage_record_schema_has_required_fields() {
    let (_, _, tokens_in, tokens_out, tokens_cached, tokens_reasoning, model, usage_raw) =
        react("hello");
    let node = serde_json::json!({
        "@type":            "UsageRecord",
        "@id":              "urn:pi-agent:usage-test",
        "prompt_ref":       "urn:pi-agent:prompt-test",
        "provider":         "stub",
        "model":            model,
        "tokens_in":        tokens_in,
        "tokens_out":       tokens_out,
        "tokens_cached":    tokens_cached,
        "tokens_reasoning": tokens_reasoning,
        "pricing_mode":     pricing_mode_for_provider("stub"),
        "estimated_usd":    estimate_billable_usd("stub", &model, tokens_in, tokens_out, tokens_cached),
        "usage_raw":        usage_raw,
        "duration_ms":      0u64,
        "timestamp_ns":     now_ns(),
    });
    for field in [
        "@type",
        "@id",
        "prompt_ref",
        "provider",
        "model",
        "tokens_in",
        "tokens_out",
        "tokens_cached",
        "tokens_reasoning",
        "pricing_mode",
        "estimated_usd",
        "usage_raw",
        "duration_ms",
        "timestamp_ns",
    ] {
        assert!(
            node.get(field).is_some(),
            "UsageRecord missing field: {field}"
        );
    }
    assert_eq!(node["@type"], "UsageRecord");
}
