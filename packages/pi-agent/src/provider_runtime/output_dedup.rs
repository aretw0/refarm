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

pub(crate) fn dispatch_and_dedup_with<F>(
    name: &str,
    input: &serde_json::Value,
    seen_hashes: &mut std::collections::HashSet<u64>,
    mut dispatch: F,
) -> String
where
    F: FnMut(&str, &serde_json::Value) -> String,
{
    let raw = dispatch(name, input);
    dedup_tool_output(raw, seen_hashes)
}

#[cfg(target_arch = "wasm32")]
pub(crate) fn dispatch_tool_dedup(
    name: &str,
    input: &serde_json::Value,
    seen_hashes: &mut std::collections::HashSet<u64>,
) -> String {
    dispatch_and_dedup_with(
        name,
        input,
        seen_hashes,
        crate::tool_dispatch::dispatch_tool,
    )
}
