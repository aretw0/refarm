use crate::host::plugin::capability_tools;

/// Dispatch a tool the built-in match did not recognize — a registry-contributed
/// plugin tool (the AGENT LEG, #6). The host owns the tool list it advertised via
/// `list-tools`, so an unrecognized name is either one of those plugin verbs or a
/// genuine typo; either way `invoke-tool` is the authority. The host routes it to
/// the target plugin's dispatch (under THAT plugin's grant, not the agent's) and
/// returns the verb's result JSON, or an error string — both fed back to the model
/// as the tool result verbatim.
///
/// The model's tool input is passed as a JSON object string; the host parses it and
/// builds the dispatch payload. A `null`/absent input serializes to `{}`.
pub(crate) fn invoke_plugin_tool(name: &str, input: &serde_json::Value) -> String {
    let input_json = if input.is_null() {
        "{}".to_string()
    } else {
        input.to_string()
    };
    match capability_tools::invoke_tool(name, &input_json) {
        Ok(result) => result,
        Err(e) => format!("[error] tool '{name}' failed: {e}"),
    }
}
