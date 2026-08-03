pub(crate) struct AgentResponsePayload<'a> {
    pub prompt_ref: &'a str,
    pub content: &'a str,
    pub tool_calls: serde_json::Value,
    pub model: &'a str,
    pub tokens_in: u32,
    pub tokens_out: u32,
    pub duration_ms: u64,
    pub sequence: u32,
    pub is_final: bool,
}

pub(crate) struct UsageRecordPayload<'a> {
    pub prompt_ref: &'a str,
    pub provider: &'a str,
    pub model: &'a str,
    pub tokens_in: u32,
    pub tokens_out: u32,
    pub cache_read_tokens: u32,
    pub cache_creation_tokens: u32,
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
        "@type":        "Response",
        "@id":          crate::mint_urn("resp"),
        "prompt_ref":   payload.prompt_ref,
        "content":      payload.content,
        "sequence":     payload.sequence,
        "is_final":     payload.is_final,
        "tool_calls":   payload.tool_calls,
        "timestamp_ns": crate::now_ns(),
        "inference": {
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
        "@id":           crate::mint_urn("usage"),
        "prompt_ref":    payload.prompt_ref,
        "provider":      payload.provider,
        "model":         payload.model,
        "tokens_in":     payload.tokens_in,
        "tokens_out":    payload.tokens_out,
        "pricing_mode":  crate::pricing_mode_for_provider(payload.provider),
        "estimated_usd": crate::estimate_billable_usd(payload.provider, payload.model, payload.tokens_in, payload.tokens_out, payload.cache_read_tokens, payload.cache_creation_tokens),
        // OTel gen_ai.usage.cache_read.input_tokens / cache_creation.input_tokens,
        // spelled flat because this node is not an OTel span.
        "cache_read_input_tokens":     payload.cache_read_tokens,
        "cache_creation_input_tokens": payload.cache_creation_tokens,
        // Retained for readers written before the split. Derived, never authoritative.
        "tokens_cached": payload.cache_read_tokens + payload.cache_creation_tokens,
        "tokens_reasoning": payload.tokens_reasoning,
        "usage_raw":        payload.usage_raw,
        "duration_ms":      payload.duration_ms,
        "timestamp_ns":     crate::now_ns(),
    })
}
