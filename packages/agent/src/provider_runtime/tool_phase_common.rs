pub(crate) fn advance_tool_phase_with<TC, TR, FA, FE, FR>(
    wire_msgs: &mut Vec<serde_json::Value>,
    tool_calls: &[TC],
    executed_calls: &mut Vec<serde_json::Value>,
    seen_hashes: &mut std::collections::HashSet<u64>,
    mut append_assistant: FA,
    mut execute_tools: FE,
    mut append_results: FR,
) where
    FA: FnMut(&mut Vec<serde_json::Value>),
    FE: FnMut(&[TC], &mut Vec<serde_json::Value>, &mut std::collections::HashSet<u64>) -> TR,
    FR: FnMut(&mut Vec<serde_json::Value>, TR),
{
    append_assistant(wire_msgs);
    let results = execute_tools(tool_calls, executed_calls, seen_hashes);
    append_results(wire_msgs, results);
}
