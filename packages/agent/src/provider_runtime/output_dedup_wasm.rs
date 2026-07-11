#[cfg(target_arch = "wasm32")]
pub(crate) fn dispatch_tool_dedup(
    name: &str,
    input: &serde_json::Value,
    seen_hashes: &mut std::collections::HashSet<u64>,
) -> String {
    let result = super::output_dedup::dispatch_and_dedup_with(
        name,
        input,
        seen_hashes,
        crate::tool_dispatch::dispatch_tool,
    );
    // AgentEvent: the model invoked a tool. This is the single choke-point for every
    // tool call, so it is the turn-by-turn window into the agent's reasoning. `ok` is
    // derived from the tool's own `[error]` convention; the args go as a bounded
    // summary (the full call is in the AgentResponse node). Correlated via run ctx.
    let ok = !result.trim_start().starts_with("[error]");
    crate::agent_events::tool_call(name, &input.to_string(), ok);
    result
}
