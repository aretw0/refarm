use crate::refarm::plugin::agent_fs;

pub(crate) fn read_file(input: &serde_json::Value) -> String {
    let path = input["path"].as_str().unwrap_or("");
    match agent_fs::read(path) {
        Ok(bytes) => crate::compress_tool_output(&String::from_utf8_lossy(&bytes)),
        Err(e) => format!("[error reading {path}] {e}"),
    }
}

pub(crate) fn write_file(input: &serde_json::Value) -> String {
    let path = input["path"].as_str().unwrap_or("");
    let content = input["content"].as_str().unwrap_or("");
    match agent_fs::write(path, content.as_bytes()) {
        Ok(()) => format!("wrote {} bytes to {path}", content.len()),
        Err(e) => format!("[error writing {path}] {e}"),
    }
}

pub(crate) fn edit_file(input: &serde_json::Value) -> String {
    let path = input["path"].as_str().unwrap_or("");
    let edits = match input["edits"].as_array() {
        Some(a) => a,
        None => return "[error] edit_file requires edits array".into(),
    };
    let bytes = match agent_fs::read(path) {
        Ok(b) => b,
        Err(e) => return format!("[error reading {path}] {e}"),
    };
    let content = String::from_utf8_lossy(&bytes).into_owned();
    let pairs: Vec<(&str, &str)> = edits
        .iter()
        .map(|e| {
            (
                e["old_str"].as_str().unwrap_or(""),
                e["new_str"].as_str().unwrap_or(""),
            )
        })
        .collect();
    let updated = match crate::apply_edits(content, &pairs) {
        Ok(s) => s,
        Err(e) => return format!("[error] {e} in {path}"),
    };
    match agent_fs::write(path, updated.as_bytes()) {
        Ok(()) => format!("applied {} edit(s) to {path}", edits.len()),
        Err(e) => format!("[error writing {path}] {e}"),
    }
}
