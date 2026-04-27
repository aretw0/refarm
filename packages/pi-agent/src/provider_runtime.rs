pub(crate) fn tool_loop_max_iter() -> u32 {
    std::env::var("LLM_TOOL_CALL_MAX_ITER")
        .ok()
        .and_then(|v| v.parse::<u32>().ok())
        .unwrap_or(5)
}

pub(crate) fn dedup_tool_output(
    raw: String,
    seen_hashes: &mut std::collections::HashSet<u64>,
) -> String {
    if seen_hashes.insert(crate::fnv1a_hash(&raw)) {
        raw
    } else {
        "[duplicate: same output already in this context — ask for specifics if needed]".to_string()
    }
}

#[cfg(target_arch = "wasm32")]
pub(crate) fn dispatch_tool_dedup(
    name: &str,
    input: &serde_json::Value,
    seen_hashes: &mut std::collections::HashSet<u64>,
) -> String {
    let raw = crate::tool_dispatch::dispatch_tool(name, input);
    dedup_tool_output(raw, seen_hashes)
}

pub(crate) fn push_executed_call(
    executed_calls: &mut Vec<serde_json::Value>,
    name: &str,
    input: serde_json::Value,
    result: &str,
) {
    executed_calls.push(serde_json::json!({
        "name": name,
        "input": input,
        "result": result,
    }));
}

pub(crate) fn parse_json_arguments(arguments: &str) -> serde_json::Value {
    serde_json::from_str(arguments).unwrap_or_else(|_| serde_json::json!({}))
}
