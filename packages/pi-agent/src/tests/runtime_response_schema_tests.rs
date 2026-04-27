use super::*;

#[test]
fn react_returns_stub_on_native() {
    let (
        content,
        tool_calls,
        tokens_in,
        tokens_out,
        tokens_cached,
        tokens_reasoning,
        model,
        usage_raw,
    ) = react("meu prompt");
    assert!(!content.is_empty());
    assert!(tool_calls.is_array());
    assert_eq!(tool_calls.as_array().unwrap().len(), 0);
    assert_eq!(tokens_in, 0, "stub has no token count");
    assert_eq!(tokens_out, 0);
    assert_eq!(tokens_cached, 0);
    assert_eq!(tokens_reasoning, 0);
    assert!(!model.is_empty(), "model must be non-empty");
    assert!(!usage_raw.is_empty());
}

#[test]
fn agent_response_schema_has_required_fields() {
    let (
        content,
        tool_calls,
        tokens_in,
        tokens_out,
        _tokens_cached,
        _tokens_reasoning,
        model,
        _usage_raw,
    ) = react("hello");
    let node = serde_json::json!({
        "@type":      "AgentResponse",
        "@id":        "urn:pi-agent:resp-test",
        "prompt_ref": "urn:pi-agent:prompt-test",
        "content":    content,
        "sequence":   0,
        "is_final":   true,
        "tool_calls": tool_calls,
        "llm": { "model": model, "tokens_in": tokens_in, "tokens_out": tokens_out, "duration_ms": 0u64 },
    });

    for field in [
        "@type",
        "@id",
        "prompt_ref",
        "content",
        "sequence",
        "is_final",
        "tool_calls",
        "llm",
    ] {
        assert!(
            node.get(field).is_some(),
            "AgentResponse missing field: {field}"
        );
    }
    assert_eq!(node["@type"], "AgentResponse");
    assert_eq!(node["is_final"], true);
    assert_eq!(node["sequence"], 0);
    for sub in ["model", "tokens_in", "tokens_out", "duration_ms"] {
        assert!(node["llm"].get(sub).is_some(), "llm missing: {sub}");
    }
}

