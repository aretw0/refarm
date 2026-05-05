use crate::refarm::plugin::agent_fs;

pub(crate) fn read_file(input: &serde_json::Value) -> String {
    let path = input["path"].as_str().unwrap_or("");
    let limit = input["limit"].as_u64().map(|v| v as usize);
    let offset = input["offset"].as_u64().unwrap_or(0) as usize;

    let bytes = match agent_fs::read(path) {
        Ok(b) => b,
        Err(e) => return format!("[error reading {path}] {e}"),
    };
    let text = String::from_utf8_lossy(&bytes);
    let all_lines: Vec<&str> = text.lines().collect();
    let total = all_lines.len();

    let start = offset.min(total);
    let slice = &all_lines[start..];
    let (shown, truncated) = match limit {
        Some(n) if slice.len() > n => (&slice[..n], true),
        _ => (slice, false),
    };

    let body = crate::compress_tool_output(&shown.join("\n"));
    if truncated {
        let next_offset = start + shown.len();
        format!(
            "[truncated: {total} lines → showing {start}..{next_offset}; use read_file with offset={next_offset} to continue]\n{body}"
        )
    } else if offset > 0 {
        format!("[showing lines {start}..{} of {total}]\n{body}", start + shown.len())
    } else {
        body
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
