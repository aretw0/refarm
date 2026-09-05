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
        "steps_planned":    25u32,
        "turns_completed":  1u32,
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
        // The step pair travels together; `turns_completed` is a separate notion
        // and is the only one of the three that is always present.
        "steps_completed",
        "steps_planned",
        "turns_completed",
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
        steps_completed: Some(1),
        steps_planned: Some(25),
        turns_completed: 1,
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

// ── "died at 4/25": both halves, and the turn count that is neither ───────

/// A payload with every non-step field fixed, so each test below varies only
/// the three counters under examination.
fn payload_with_counts(
    steps_completed: Option<u32>,
    steps_planned: Option<u32>,
    turns_completed: u32,
) -> UsageRecordPayload<'static> {
    UsageRecordPayload {
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
        steps_completed,
        steps_planned,
        turns_completed,
    }
}

#[test]
fn usage_record_stamps_both_halves_of_the_step_fraction_beside_rate_table_version() {
    // "Died at 4/25 under a 45s ceiling" named two missing things: the ceiling
    // and the step the run reached. Both travel on THIS record, the same way
    // rate_table_version does, because packages/tractor has no Cargo dependency
    // on this crate to compute either one itself.
    let node = usage_record_node(payload_with_counts(Some(4), Some(25), 1));
    assert_eq!(node["steps_completed"], 4);
    assert_eq!(node["steps_planned"], 25);
}

#[test]
fn usage_record_keeps_the_turn_count_under_a_name_that_is_not_steps() {
    // The whole defect in one assertion: a single `refarm ask` that ran four
    // steps is ONE turn. When the turn count was spelled `steps_completed` it
    // landed beside a step ceiling and read as "1/25" for a run the operator had
    // watched reach step 4. The two now travel under names that cannot be
    // mistaken for halves of the same fraction.
    let node = usage_record_node(payload_with_counts(Some(4), Some(25), 1));
    assert_eq!(node["turns_completed"], 1);
    assert_ne!(
        node["turns_completed"], node["steps_completed"],
        "these count different things and this record is the proof"
    );
}

#[test]
fn usage_record_omits_the_denominator_rather_than_defaulting_it_to_twenty_five() {
    // A record whose governing ceiling could not be established carries the
    // numerator and NO `steps_planned` key. Not 0, not the `DEFAULT_TOOL_CALL_
    // MAX_ITER` of 25 re-derived at record time — a 25 nobody enforced is a
    // number that looks like a measurement and is not.
    let node = usage_record_node(payload_with_counts(Some(4), None, 1));
    assert_eq!(node["steps_completed"], 4);
    assert!(
        node.get("steps_planned").is_none(),
        "an unknown ceiling must leave NO key, not a null and not a default: {node}"
    );
}

#[test]
fn usage_record_omits_the_whole_pair_when_no_completion_loop_ran() {
    // A dispatch refused before the loop (a context-limit refusal) completed
    // zero steps under no ceiling. Recording `0` would claim a measurement was
    // taken; the turn count still travels, because that one IS known.
    let node = usage_record_node(payload_with_counts(None, None, 1));
    assert!(node.get("steps_completed").is_none());
    assert!(node.get("steps_planned").is_none());
    assert_eq!(node["turns_completed"], 1);
}
