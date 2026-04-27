mod code_ops_tools;
mod fs_shell;
mod session_tools;

/// Tool dispatch (wasm32): routes tool names to specialized handlers.
pub(crate) fn dispatch_tool(name: &str, input: &serde_json::Value) -> String {
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

        // LSP code ops
        "find_references" => code_ops_tools::find_references(input),
        "rename_symbol" => code_ops_tools::rename_symbol(input),

        other => format!("[error] unknown tool: {other}"),
    }
}
