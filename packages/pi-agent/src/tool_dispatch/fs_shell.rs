use crate::refarm::plugin::{agent_fs, agent_shell, structured_io};

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

pub(crate) fn list_dir(input: &serde_json::Value) -> String {
    let path = input["path"].as_str().unwrap_or(".");
    let req = agent_shell::SpawnRequest {
        argv: vec!["ls".into(), "-1".into(), "--".into(), path.into()],
        env: vec![],
        cwd: None,
        timeout_ms: 5_000,
        stdin: None,
    };
    match agent_shell::spawn(&req) {
        Ok(r) if r.exit_code == 0 => {
            crate::compress_tool_output(&String::from_utf8_lossy(&r.stdout))
        }
        Ok(r) => format!(
            "[error listing {path}] exit {}\n{}",
            r.exit_code,
            String::from_utf8_lossy(&r.stderr)
        ),
        Err(e) => format!("[error listing {path}] {e}"),
    }
}

pub(crate) fn search_files(input: &serde_json::Value) -> String {
    let pattern = input["pattern"].as_str().unwrap_or("");
    let path = input["path"].as_str().unwrap_or(".");
    let mut argv = vec![
        "grep".into(),
        "-rn".into(),
        "--".into(),
        pattern.into(),
        path.into(),
    ];
    if let Some(glob) = input["glob"].as_str() {
        argv.insert(2, format!("--include={glob}"));
    }
    let req = agent_shell::SpawnRequest {
        argv,
        env: vec![],
        cwd: None,
        timeout_ms: 15_000,
        stdin: None,
    };
    match agent_shell::spawn(&req) {
        Ok(r) => {
            let out = String::from_utf8_lossy(&r.stdout);
            if r.exit_code == 1 && out.is_empty() {
                return format!("[no matches for '{pattern}' in {path}]");
            }
            if r.exit_code > 1 {
                return format!("[grep error]\n{}", String::from_utf8_lossy(&r.stderr));
            }
            crate::compress_tool_output(&out)
        }
        Err(e) => format!("[spawn error] {e}"),
    }
}

pub(crate) fn bash(input: &serde_json::Value) -> String {
    let argv: Vec<String> = input["argv"]
        .as_array()
        .map(|a| {
            a.iter()
                .filter_map(|v| v.as_str().map(String::from))
                .collect()
        })
        .unwrap_or_default();
    if argv.is_empty() {
        return "[error] bash requires argv".into();
    }
    let cwd = input["cwd"].as_str().map(String::from);
    let timeout_ms = input["timeout_ms"].as_u64().unwrap_or(30_000) as u32;
    let req = agent_shell::SpawnRequest {
        argv,
        env: vec![],
        cwd,
        timeout_ms,
        stdin: None,
    };
    match agent_shell::spawn(&req) {
        Ok(r) => {
            let out = String::from_utf8_lossy(&r.stdout);
            let err = String::from_utf8_lossy(&r.stderr);
            let raw = if r.timed_out {
                format!("[timeout {timeout_ms}ms]\n{out}\n{err}")
            } else if r.exit_code != 0 {
                format!("[exit {}]\n{out}\n{err}", r.exit_code)
            } else {
                out.into_owned()
            };
            crate::compress_tool_output(&raw)
        }
        Err(e) => format!("[spawn error] {e}"),
    }
}

pub(crate) fn read_structured(input: &serde_json::Value) -> String {
    let path = input["path"].as_str().unwrap_or("");
    let fmt_opt = input["format"].as_str().and_then(|s| match s {
        "json" => Some(structured_io::FileFormat::Json),
        "toml" => Some(structured_io::FileFormat::Toml),
        "yaml" => Some(structured_io::FileFormat::Yaml),
        _ => None,
    });
    let page_size = input["page_size"].as_u64().unwrap_or(50) as u32;
    let page_offset = input["page_offset"].as_u64().unwrap_or(0) as u32;
    match structured_io::read_structured(path, fmt_opt, page_size, page_offset) {
        Ok(content) => crate::compress_tool_output(&content),
        Err(e) => format!("[read_structured error] {e}"),
    }
}

pub(crate) fn write_structured(input: &serde_json::Value) -> String {
    let path = input["path"].as_str().unwrap_or("");
    let content = input["content"].as_str().unwrap_or("");
    let fmt_opt = input["format"].as_str().and_then(|s| match s {
        "json" => Some(structured_io::FileFormat::Json),
        "toml" => Some(structured_io::FileFormat::Toml),
        "yaml" => Some(structured_io::FileFormat::Yaml),
        _ => None,
    });
    match structured_io::write_structured(path, content, fmt_opt) {
        Ok(()) => format!("wrote {} bytes to {path} (validated)", content.len()),
        Err(e) => format!("[write_structured error] {e}"),
    }
}
