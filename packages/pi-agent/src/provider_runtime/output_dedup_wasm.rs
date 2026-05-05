#[cfg(target_arch = "wasm32")]
pub(crate) fn dispatch_tool_dedup(
    name: &str,
    input: &serde_json::Value,
    seen_hashes: &mut std::collections::HashSet<u64>,
) -> String {
    super::output_dedup::dispatch_and_dedup_with(
        name,
        input,
        seen_hashes,
        crate::tool_dispatch::dispatch_tool,
    )
}
