use super::*;

#[test]
fn response_nodes_user_prompt_builder_shape() {
    let node = user_prompt_node("urn:sovereign:prompt-test", "hello");
    assert_eq!(node["@type"], "UserPrompt");
    assert_eq!(node["@id"], "urn:sovereign:prompt-test");
    assert_eq!(node["content"], "hello");
    assert!(node["timestamp_ns"].as_u64().unwrap_or(0) > 0);
}

#[test]
fn response_nodes_agent_response_builder_shape() {
    let node = agent_response_node(AgentResponsePayload {
        prompt_ref: "urn:sovereign:prompt-test",
        content: "done",
        tool_calls: serde_json::json!([]),
        model: "stub",
        tokens_in: 1,
        tokens_out: 2,
        duration_ms: 3,
        sequence: 0,
        is_final: true,
    });
    assert_eq!(node["@type"], "Response");
    assert_eq!(node["prompt_ref"], "urn:sovereign:prompt-test");
    assert_eq!(node["content"], "done");
    assert_eq!(node["inference"]["model"], "stub");
    assert_eq!(node["inference"]["tokens_in"], 1);
    assert_eq!(node["inference"]["tokens_out"], 2);
    assert_eq!(node["inference"]["duration_ms"], 3);
    assert_eq!(node["sequence"], 0);
    assert_eq!(node["is_final"], true);
}

#[test]
fn response_nodes_agent_response_builder_can_mark_partial() {
    let node = agent_response_node(AgentResponsePayload {
        prompt_ref: "urn:sovereign:prompt-test",
        content: "partial",
        tool_calls: serde_json::json!([]),
        model: "stub",
        tokens_in: 1,
        tokens_out: 0,
        duration_ms: 1,
        sequence: 7,
        is_final: false,
    });
    assert_eq!(node["@type"], "Response");
    assert_eq!(node["content"], "partial");
    assert_eq!(node["sequence"], 7);
    assert_eq!(node["is_final"], false);
}

#[test]
fn response_nodes_usage_builder_shape() {
    let node = usage_record_node(UsageRecordPayload {
        prompt_ref: "urn:sovereign:prompt-test",
        provider: "stub",
        model: "stub",
        tokens_in: 10,
        tokens_out: 20,
        cache_read_tokens: 0,
        cache_creation_tokens: 0,
        tokens_reasoning: 0,
        usage_raw: "{}",
        duration_ms: 5,
    });
    assert_eq!(node["@type"], "UsageRecord");
    assert_eq!(node["prompt_ref"], "urn:sovereign:prompt-test");
    assert_eq!(node["provider"], "stub");
    assert_eq!(node["model"], "stub");
    assert_eq!(node["tokens_in"], 10);
    assert_eq!(node["tokens_out"], 20);
}

// ── price_known (F5, whole-branch review) ─────────────────────────────────

#[test]
fn response_nodes_usage_builder_marks_price_known_for_a_priced_api_model() {
    let node = usage_record_node(UsageRecordPayload {
        prompt_ref: "urn:sovereign:prompt-test",
        provider: "anthropic",
        model: "claude-sonnet-4-6",
        tokens_in: 10,
        tokens_out: 20,
        cache_read_tokens: 0,
        cache_creation_tokens: 0,
        tokens_reasoning: 0,
        usage_raw: "{}",
        duration_ms: 5,
    });
    assert_eq!(node["price_known"], true);
}

#[test]
fn response_nodes_usage_builder_marks_price_unknown_for_an_unrated_api_model() {
    // "stub" is an api-mode provider (falls through pricing_mode_for_provider's
    // default arm) serving a model with no rate on file — estimated_usd is
    // 0.0, but that 0.0 must not read as "cheap" (F5): "I could not price
    // this" and "this was free" are different facts.
    let node = usage_record_node(UsageRecordPayload {
        prompt_ref: "urn:sovereign:prompt-test",
        provider: "stub",
        model: "stub",
        tokens_in: 10,
        tokens_out: 20,
        cache_read_tokens: 0,
        cache_creation_tokens: 0,
        tokens_reasoning: 0,
        usage_raw: "{}",
        duration_ms: 5,
    });
    assert_eq!(node["estimated_usd"], 0.0);
    assert_eq!(
        node["price_known"], false,
        "a 0.0 estimate from a missing rate must be distinguishable from a genuinely free run"
    );
}

#[test]
fn response_nodes_usage_builder_marks_price_known_true_under_a_structural_zero() {
    // A subscription/local provider's $0.00 is a deliberate structural fact,
    // not an unpriced model — price_known stays true so it is never confused
    // with the F5 case above.
    let node = usage_record_node(UsageRecordPayload {
        prompt_ref: "urn:sovereign:prompt-test",
        provider: "openai-codex",
        model: "gpt-5.5",
        tokens_in: 10,
        tokens_out: 20,
        cache_read_tokens: 0,
        cache_creation_tokens: 0,
        tokens_reasoning: 0,
        usage_raw: "{}",
        duration_ms: 5,
    });
    assert_eq!(node["estimated_usd"], 0.0);
    assert_eq!(node["price_known"], true);
}
