#[allow(dead_code)]
pub(crate) fn build_anthropic_body(
    model: &str,
    system: &str,
    wire_msgs: &[serde_json::Value],
    tools: serde_json::Value,
) -> String {
    build_anthropic_body_with_streaming(model, system, wire_msgs, tools, false)
}

pub(crate) fn build_anthropic_body_with_streaming(
    model: &str,
    system: &str,
    wire_msgs: &[serde_json::Value],
    tools: serde_json::Value,
    stream: bool,
) -> String {
    let cache = super::loop_limits::prompt_cache_enabled();
    let mut body = serde_json::json!({
        "model": model,
        "max_tokens": super::loop_limits::max_output_tokens(),
        "system": system_value(system, cache),
        "tools": tools_value(tools, cache),
        "messages": wire_msgs,
    });
    if stream {
        body["stream"] = serde_json::Value::Bool(true);
    }
    body.to_string()
}

/// An ephemeral `cache_control` marker — the Anthropic prompt-cache breakpoint.
fn cache_control() -> serde_json::Value {
    serde_json::json!({ "type": "ephemeral" })
}

/// The `system` field. Without caching it stays a plain string (unchanged wire
/// shape). With caching it becomes a single text content block carrying
/// `cache_control`, so the (stable, large) system prompt is cached across turns.
fn system_value(system: &str, cache: bool) -> serde_json::Value {
    if !cache {
        return serde_json::Value::String(system.to_string());
    }
    serde_json::json!([{
        "type": "text",
        "text": system,
        "cache_control": cache_control(),
    }])
}

/// The `tools` array. With caching, the LAST tool gets `cache_control`, which caches
/// the whole tool-schema block (the prefix up to the breakpoint) — the tool schemas
/// are stable across a session, so re-sends hit the cache. Without caching the array
/// is returned unchanged.
fn tools_value(tools: serde_json::Value, cache: bool) -> serde_json::Value {
    if !cache {
        return tools;
    }
    let serde_json::Value::Array(mut items) = tools else {
        return tools;
    };
    if let Some(last) = items.last_mut() {
        if let Some(obj) = last.as_object_mut() {
            obj.insert("cache_control".to_string(), cache_control());
        }
    }
    serde_json::Value::Array(items)
}
