pub(crate) struct AgentResponsePayload<'a> {
    pub prompt_ref: &'a str,
    pub content: &'a str,
    pub tool_calls: serde_json::Value,
    pub model: &'a str,
    pub tokens_in: u32,
    pub tokens_out: u32,
    pub duration_ms: u64,
    pub is_final: bool,
}

pub(crate) struct UsageRecordPayload<'a> {
    pub prompt_ref: &'a str,
    pub provider: &'a str,
    pub model: &'a str,
    pub tokens_in: u32,
    pub tokens_out: u32,
    pub tokens_cached: u32,
    pub tokens_reasoning: u32,
    pub usage_raw: &'a str,
    pub duration_ms: u64,
}

pub(crate) fn user_prompt_node(prompt_ref: &str, prompt: &str) -> serde_json::Value {
    serde_json::json!({
        "@type":        "UserPrompt",
        "@id":          prompt_ref,
        "content":      prompt,
        "timestamp_ns": crate::now_ns(),
    })
}

pub(crate) fn agent_response_node(payload: AgentResponsePayload<'_>) -> serde_json::Value {
    serde_json::json!({
        "@type":        "AgentResponse",
        "@id":          crate::new_pi_urn("resp"),
        "prompt_ref":   payload.prompt_ref,
        "content":      payload.content,
        "sequence":     0,
        "is_final":     payload.is_final,
        "tool_calls":   payload.tool_calls,
        "timestamp_ns": crate::now_ns(),
        "llm": {
            "model":       payload.model,
            "tokens_in":   payload.tokens_in,
            "tokens_out":  payload.tokens_out,
            "duration_ms": payload.duration_ms,
        },
    })
}

pub(crate) fn usage_record_node(payload: UsageRecordPayload<'_>) -> serde_json::Value {
    serde_json::json!({
        "@type":         "UsageRecord",
        "@id":           crate::new_pi_urn("usage"),
        "prompt_ref":    payload.prompt_ref,
        "provider":      payload.provider,
        "model":         payload.model,
        "tokens_in":     payload.tokens_in,
        "tokens_out":    payload.tokens_out,
        "estimated_usd": crate::estimate_usd(payload.model, payload.tokens_in, payload.tokens_out, payload.tokens_cached),
        "tokens_cached": payload.tokens_cached,
        "tokens_reasoning": payload.tokens_reasoning,
        "usage_raw":        payload.usage_raw,
        "duration_ms":      payload.duration_ms,
        "timestamp_ns":     crate::now_ns(),
    })
}
