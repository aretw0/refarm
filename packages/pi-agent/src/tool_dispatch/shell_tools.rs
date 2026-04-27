use crate::refarm::plugin::agent_shell;

fn spawn(
    argv: Vec<String>,
    cwd: Option<String>,
    timeout_ms: u32,
) -> Result<agent_shell::SpawnResult, String> {
    let req = agent_shell::SpawnRequest {
        argv,
        env: vec![],
        cwd,
        timeout_ms,
        stdin: None,
    };
    agent_shell::spawn(&req).map_err(|e| e.to_string())
}

fn render_shell_result(r: &agent_shell::SpawnResult, timeout_ms: u32) -> String {
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

    match spawn(argv, None, 15_000) {
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

    match spawn(argv, cwd, timeout_ms) {
        Ok(r) => render_shell_result(&r, timeout_ms),
        Err(e) => format!("[spawn error] {e}"),
    }
}
