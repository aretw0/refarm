use crate::plugin::host::host_shell;

fn spawn(
    argv: Vec<String>,
    cwd: Option<String>,
    timeout_ms: u32,
) -> Result<host_shell::SpawnResult, String> {
    let req = host_shell::SpawnRequest {
        argv,
        env: vec![],
        cwd,
        timeout_ms,
        stdin: None,
    };
    host_shell::spawn(&req).map_err(|e| e.to_string())
}

fn render_shell_result(r: &host_shell::SpawnResult, timeout_ms: u32) -> String {
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

pub(crate) fn list_dir(input: &serde_json::Value) -> String {
    let path = input["path"].as_str().unwrap_or(".");
    let argv = vec!["ls".into(), "-1".into(), "--".into(), path.into()];
    match spawn(argv, None, 5_000) {
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

/// Find files BY NAME matching a glob (e.g. `**/*.rs`, `Cargo.toml`) under a path —
/// the "locate files" complement to `search_files` (which greps file CONTENT) and
/// `list_dir` (one directory, no recursion/pattern). Shells `find` with `-name`, so
/// the glob matches the basename; results are one path per line.
pub(crate) fn glob(input: &serde_json::Value) -> String {
    let pattern = input["pattern"].as_str().unwrap_or("");
    if pattern.is_empty() {
        return "[error] glob requires a `pattern` (e.g. *.rs)".into();
    }
    let path = input["path"].as_str().unwrap_or(".");
    let max_results = input["max_results"].as_u64().map(|v| v as usize);
    // `find <path> -name <glob> -type f` — the basename glob is the common case; a
    // path-segment glob (**/) is matched on the last segment by find's -name.
    let name = pattern.rsplit('/').next().unwrap_or(pattern);
    let argv = vec![
        "find".into(),
        path.into(),
        "-type".into(),
        "f".into(),
        "-name".into(),
        name.into(),
    ];
    match spawn(argv, None, 15_000) {
        Ok(r) if r.exit_code == 0 => {
            let out = String::from_utf8_lossy(&r.stdout);
            let mut lines: Vec<&str> = out.lines().filter(|l| !l.is_empty()).collect();
            let total = lines.len();
            if total == 0 {
                return format!("[no files matching '{pattern}' under {path}]");
            }
            let truncated = matches!(max_results, Some(n) if total > n);
            if let Some(n) = max_results {
                lines.truncate(n);
            }
            let body = crate::compress_tool_output(&lines.join("\n"));
            if truncated {
                format!(
                    "[truncated: {total} matches → showing {}]\n{body}",
                    lines.len()
                )
            } else {
                body
            }
        }
        Ok(r) => format!(
            "[error globbing {path}] exit {}\n{}",
            r.exit_code,
            String::from_utf8_lossy(&r.stderr)
        ),
        Err(e) => format!("[error globbing {path}] {e}"),
    }
}

pub(crate) fn search_files(input: &serde_json::Value) -> String {
    let pattern = input["pattern"].as_str().unwrap_or("");
    let path = input["path"].as_str().unwrap_or(".");
    let max_results = input["max_results"].as_u64().map(|v| v as usize);
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

    match spawn(argv, None, 15_000) {
        Ok(r) => {
            let out = String::from_utf8_lossy(&r.stdout);
            if r.exit_code == 1 && out.is_empty() {
                return format!("[no matches for '{pattern}' in {path}]");
            }
            if r.exit_code > 1 {
                return format!("[grep error]\n{}", String::from_utf8_lossy(&r.stderr));
            }
            let compressed = crate::compress_tool_output(&out);
            match max_results {
                Some(limit) => {
                    let lines: Vec<&str> = compressed.lines().collect();
                    if lines.len() > limit {
                        let hidden = lines.len() - limit;
                        format!(
                            "[truncated: {} matches → first {} shown, {} hidden]\n{}",
                            lines.len(),
                            limit,
                            hidden,
                            lines[..limit].join("\n")
                        )
                    } else {
                        compressed
                    }
                }
                None => compressed,
            }
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

    match spawn(argv, cwd, timeout_ms) {
        Ok(r) => render_shell_result(&r, timeout_ms),
        Err(e) => format!("[spawn error] {e}"),
    }
}
