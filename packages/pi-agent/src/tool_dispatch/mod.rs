mod code_ops_tools;
mod fs_shell;
mod fs_tools;
mod session_tools;
mod shell_tools;
mod structured_tools;
mod task_tools;

fn pre_tool_budget_enabled() -> bool {
    match std::env::var("LLM_PRE_TOOL_BUDGET") {
        Ok(v) => {
            let n = v.trim().to_ascii_lowercase();
            !matches!(n.as_str(), "0" | "false" | "no" | "off")
        }
        Err(_) => true,
    }
}

/// Inject default limits into tool inputs before dispatch (ADR-058 Principle 2).
/// Returns a owned copy with defaults applied; the original is unchanged.
fn apply_pre_tool_budget(name: &str, input: &serde_json::Value) -> serde_json::Value {
    if !pre_tool_budget_enabled() {
        return input.clone();
    }
    let mut patched = input.clone();
    match name {
        "read_file" => {
            if patched["limit"].is_null() {
                patched["limit"] = serde_json::json!(300);
            }
        }
        "search_files" => {
            if patched["max_results"].is_null() {
                patched["max_results"] = serde_json::json!(100);
            }
        }
        _ => {}
    }
    patched
}

/// Tool dispatch (wasm32): routes tool names to specialized handlers.
pub(crate) fn dispatch_tool(name: &str, input: &serde_json::Value) -> String {
    let input = &apply_pre_tool_budget(name, input);
    match name {
        // FS + shell + structured I/O
        "read_file" => fs_shell::read_file(input),
        "write_file" => fs_shell::write_file(input),
        "edit_file" => fs_shell::edit_file(input),
        "list_dir" => fs_shell::list_dir(input),
        "search_files" => fs_shell::search_files(input),
        "bash" => fs_shell::bash(input),
        "read_structured" => fs_shell::read_structured(input),
        "write_structured" => fs_shell::write_structured(input),

        // Session management
        "list_sessions" => session_tools::list_sessions(),
        "current_session" => session_tools::current_session(),
        "navigate" => session_tools::navigate(input),
        "fork" => session_tools::fork(input),

        // Task introspection
        "list_tasks" => task_tools::list_tasks(input),
        "task_status" => task_tools::task_status(input),

        // LSP code ops
        "find_references" => code_ops_tools::find_references(input),
        "rename_symbol" => code_ops_tools::rename_symbol(input),

        other => format!("[error] unknown tool: {other}"),
    }
}
