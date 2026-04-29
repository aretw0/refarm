use super::*;

#[test]
fn response_nodes_user_prompt_builder_shape() {
    let node = user_prompt_node("urn:pi-agent:prompt-test", "hello");
    assert_eq!(node["@type"], "UserPrompt");
    assert_eq!(node["@id"], "urn:pi-agent:prompt-test");
    assert_eq!(node["content"], "hello");
    assert!(node["timestamp_ns"].as_u64().unwrap_or(0) > 0);
}

#[test]
fn response_nodes_agent_response_builder_shape() {
    let node = agent_response_node(AgentResponsePayload {
        prompt_ref: "urn:pi-agent:prompt-test",
        content: "done",
        tool_calls: serde_json::json!([]),
        model: "stub",
        tokens_in: 1,
        tokens_out: 2,
        duration_ms: 3,
        is_final: true,
    });
    assert_eq!(node["@type"], "AgentResponse");
    assert_eq!(node["prompt_ref"], "urn:pi-agent:prompt-test");
    assert_eq!(node["content"], "done");
    assert_eq!(node["llm"]["model"], "stub");
    assert_eq!(node["llm"]["tokens_in"], 1);
    assert_eq!(node["llm"]["tokens_out"], 2);
    assert_eq!(node["llm"]["duration_ms"], 3);
    assert_eq!(node["is_final"], true);
}

#[test]
fn response_nodes_agent_response_builder_can_mark_partial() {
    let node = agent_response_node(AgentResponsePayload {
        prompt_ref: "urn:pi-agent:prompt-test",
        content: "partial",
        tool_calls: serde_json::json!([]),
        model: "stub",
        tokens_in: 1,
        tokens_out: 0,
        duration_ms: 1,
        is_final: false,
    });
    assert_eq!(node["@type"], "AgentResponse");
    assert_eq!(node["content"], "partial");
    assert_eq!(node["is_final"], false);
}

#[test]
fn response_nodes_usage_builder_shape() {
    let node = usage_record_node(UsageRecordPayload {
        prompt_ref: "urn:pi-agent:prompt-test",
        provider: "stub",
        model: "stub",
        tokens_in: 10,
        tokens_out: 20,
        tokens_cached: 0,
        tokens_reasoning: 0,
        usage_raw: "{}",
        duration_ms: 5,
    });
    assert_eq!(node["@type"], "UsageRecord");
    assert_eq!(node["prompt_ref"], "urn:pi-agent:prompt-test");
    assert_eq!(node["provider"], "stub");
    assert_eq!(node["model"], "stub");
    assert_eq!(node["tokens_in"], 10);
    assert_eq!(node["tokens_out"], 20);
}
