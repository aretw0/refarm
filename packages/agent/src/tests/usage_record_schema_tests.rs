use super::*;

#[test]
fn usage_record_schema_has_required_fields() {
    let (_, _, tokens_in, tokens_out, cache_read_tokens, cache_creation_tokens, tokens_reasoning, model, usage_raw) =
        react("hello");
    let tokens_cached = cache_read_tokens + cache_creation_tokens;
    let node = serde_json::json!({
        "@type":            "UsageRecord",
        "@id":              "urn:sovereign:usage-test",
        "prompt_ref":       "urn:sovereign:prompt-test",
        "provider":         "stub",
        "model":            model,
        "tokens_in":        tokens_in,
        "tokens_out":       tokens_out,
        "tokens_cached":    tokens_cached,
        "tokens_reasoning": tokens_reasoning,
        "pricing_mode":     pricing_mode_for_provider("stub"),
        "estimated_usd":    estimate_billable_usd("stub", &model, tokens_in, tokens_out, cache_read_tokens, cache_creation_tokens),
        "rate_table_version": RATE_TABLE_VERSION,
        "steps_completed":  1u32,
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
        "rate_table_version",
        "steps_completed",
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

#[test]
fn usage_record_carries_both_cache_buckets_and_their_sum() {
    let node = usage_record_node(UsageRecordPayload {
        prompt_ref: "urn:sovereign:prompt-test",
        provider: "anthropic",
        model: "claude-sonnet-4-6",
        tokens_in: 50,
        tokens_out: 10,
        cache_read_tokens: 100_000,
        cache_creation_tokens: 2_048,
        tokens_reasoning: 0,
        usage_raw: "{}",
        duration_ms: 0,
        steps_completed: 1,
    });
    assert_eq!(node["cache_read_input_tokens"], 100_000);
    assert_eq!(node["cache_creation_input_tokens"], 2_048);
    assert_eq!(
        node["tokens_cached"], 102_048,
        "the sum stays for readers that predate the split"
    );
    assert_eq!(
        node["rate_table_version"], RATE_TABLE_VERSION,
        "the rate table that priced this run travels with the price, not the tokens"
    );
}

// ── steps_completed (F1's other missing half) ─────────────────────────────

#[test]
fn usage_record_stamps_steps_completed_beside_rate_table_version() {
    // "Died at 4/25 under a 45s ceiling" named two missing things: the
    // ceiling (already recorded) and the step the run reached. This is that
    // second half — the sidecar joins it off THIS record, the same way it
    // already joins rate_table_version, because packages/tractor has no
    // Cargo dependency on this crate to compute either one itself.
    let node = usage_record_node(UsageRecordPayload {
        prompt_ref: "urn:sovereign:prompt-test",
        provider: "anthropic",
        model: "claude-sonnet-4-6",
        tokens_in: 5,
        tokens_out: 5,
        cache_read_tokens: 0,
        cache_creation_tokens: 0,
        tokens_reasoning: 0,
        usage_raw: "{}",
        duration_ms: 0,
        steps_completed: 4,
    });
    assert_eq!(node["steps_completed"], 4);
}
