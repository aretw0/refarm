wit_bindgen::generate!({
    world: "agent-tools-provider",
    path: "wit",
});

use exports::refarm::agent_tools::agent_fs::Guest as AgentFsGuest;
use exports::refarm::agent_tools::agent_shell::{Guest as AgentShellGuest, SpawnRequest, SpawnResult};
use exports::refarm::agent_tools::structured_io::{
    Guest as StructuredIoGuest, FileFormat,
};
use refarm::agent_tools::host_spawn;

struct AgentTools;

// ── agent-fs ──────────────────────────────────────────────────────────────────
//
// std::fs calls in WASM map to wasi:filesystem automatically.
// Atomic write uses write-to-tmp + rename (same filesystem → atomic on WASI).
// diffy is pure Rust — no OS calls, works unchanged inside the WASM sandbox.

impl AgentFsGuest for AgentTools {
    fn read(path: String) -> Result<Vec<u8>, String> {
        std::fs::read(&path).map_err(|e| format!("read({path}): {e}"))
    }

    fn write(path: String, content: Vec<u8>) -> Result<(), String> {
        atomic_write(&path, &content)
    }

    fn edit(path: String, diff: String) -> Result<(), String> {
        let original = std::fs::read_to_string(&path)
            .map_err(|e| format!("edit/read({path}): {e}"))?;

        let patch =
            diffy::Patch::from_str(&diff).map_err(|e| format!("edit/parse-diff: {e}"))?;

        let patched =
            diffy::apply(&original, &patch).map_err(|e| format!("edit/apply({path}): {e}"))?;

        atomic_write(&path, patched.as_bytes())
    }
}

// ── agent-shell ───────────────────────────────────────────────────────────────
//
// Policy layer: validates the request before calling the host's do-spawn import.
// Swap this component to change spawn rules without recompiling tractor or pi-agent.

impl AgentShellGuest for AgentTools {
    fn spawn(req: SpawnRequest) -> Result<SpawnResult, String> {
        enforce_spawn_policy(&req)?;

        let (stdout, stderr, exit_code, timed_out) = host_spawn::do_spawn(
            &req.argv,
            &req.env,
            req.cwd.as_deref(),
            req.timeout_ms,
            req.stdin.as_deref(),
        )?;

        Ok(SpawnResult {
            stdout,
            stderr,
            exit_code,
            timed_out,
        })
    }
}

// Hard cap: prevents a rogue agent from holding the host thread indefinitely.
// 30 s is generous for any legitimate tool call; raise via plugin capability later.
const MAX_TIMEOUT_MS: u32 = 30_000;

fn enforce_spawn_policy(req: &SpawnRequest) -> Result<(), String> {
    if req.argv.is_empty() {
        return Err("spawn: argv must be non-empty".into());
    }
    if req.timeout_ms > MAX_TIMEOUT_MS {
        return Err(format!(
            "spawn: timeout_ms {} exceeds policy cap of {}",
            req.timeout_ms, MAX_TIMEOUT_MS,
        ));
    }
    Ok(())
}

// ── structured-io ─────────────────────────────────────────────────────────────
//
// Shared parsing layer: any plugin can import this instead of duplicating the
// serde_json/toml/serde_yaml logic. The implementation delegates filesystem I/O
// through std::fs (WASI-mapped) and validates before writing.

impl StructuredIoGuest for AgentTools {
    fn read_structured(
        path: String,
        format: Option<FileFormat>,
        page_size: u32,
        page_offset: u32,
    ) -> Result<String, String> {
        let fmt = match format {
            Some(FileFormat::Json)  => "json",
            Some(FileFormat::Toml)  => "toml",
            Some(FileFormat::Yaml)  => "yaml",
            None                    => detect_format(&path),
        };
        let bytes = std::fs::read(&path).map_err(|e| format!("read({path}): {e}"))?;
        Ok(structured_parse(&bytes, fmt, page_size as usize, page_offset as usize))
    }

    fn write_structured(
        path: String,
        content: String,
        format: Option<FileFormat>,
    ) -> Result<(), String> {
        let fmt = match format {
            Some(FileFormat::Json)  => "json",
            Some(FileFormat::Toml)  => "toml",
            Some(FileFormat::Yaml)  => "yaml",
            None                    => detect_format(&path),
        };
        validate_structured(&content, fmt)?;
        atomic_write(&path, content.as_bytes())
    }
}

fn detect_format(path: &str) -> &'static str {
    if path.ends_with(".json")                              { "json" }
    else if path.ends_with(".toml")                        { "toml" }
    else if path.ends_with(".yaml") || path.ends_with(".yml") { "yaml" }
    else                                                    { "json" }
}

fn validate_structured(content: &str, format: &str) -> Result<(), String> {
    match format {
        "json" => serde_json::from_str::<serde_json::Value>(content)
            .map(|_| ()).map_err(|e| format!("JSON parse error: {e}")),
        "toml" => toml::from_str::<toml::Value>(content)
            .map(|_| ()).map_err(|e| format!("TOML parse error: {e}")),
        "yaml" => serde_yaml::from_str::<serde_yaml::Value>(content)
            .map(|_| ()).map_err(|e| format!("YAML parse error: {e}")),
        other  => Err(format!("unsupported format: {other}")),
    }
}

fn structured_parse(bytes: &[u8], format: &str, page_size: usize, page_offset: usize) -> String {
    match format {
        "json" => parse_page_json(bytes, page_size, page_offset),
        "toml" => parse_page_toml(bytes, page_size, page_offset),
        "yaml" => parse_page_yaml(bytes, page_size, page_offset),
        other  => format!("[structured-io | unsupported format: {other}]"),
    }
}

fn page_json_value(v: serde_json::Value, page_size: usize, offset: usize) -> String {
    match &v {
        serde_json::Value::Array(arr) => {
            let count = arr.len();
            let slice: Vec<_> = arr.iter().skip(offset)
                .take(if page_size == 0 { count } else { page_size }).collect();
            let truncated = offset + slice.len() < count;
            let header = format!(
                "[structured-io | json | array | total={count} | offset={offset} | returned={} | truncated={}]\n",
                slice.len(), truncated,
            );
            let body = serde_json::to_string_pretty(&serde_json::Value::Array(
                slice.into_iter().cloned().collect()
            )).unwrap_or_default();
            header + &body
        }
        serde_json::Value::Object(map) => {
            let count = map.len();
            let keys: Vec<_> = map.keys().skip(offset)
                .take(if page_size == 0 { count } else { page_size }).collect();
            let truncated = offset + keys.len() < count;
            let header = format!(
                "[structured-io | json | object | total={count} | offset={offset} | returned={} | truncated={}]\n",
                keys.len(), truncated,
            );
            let subset: serde_json::Map<String, serde_json::Value> = keys.iter()
                .map(|k| ((*k).clone(), map[*k].clone())).collect();
            let body = serde_json::to_string_pretty(&serde_json::Value::Object(subset))
                .unwrap_or_default();
            header + &body
        }
        other => {
            format!("[structured-io | json | scalar]\n{}", serde_json::to_string_pretty(other).unwrap_or_default())
        }
    }
}

fn parse_page_json(bytes: &[u8], page_size: usize, offset: usize) -> String {
    match serde_json::from_slice::<serde_json::Value>(bytes) {
        Ok(v)  => page_json_value(v, page_size, offset),
        Err(e) => format!("[structured-io | json | parse error: {e}]"),
    }
}

fn parse_page_toml(bytes: &[u8], page_size: usize, offset: usize) -> String {
    let text = match std::str::from_utf8(bytes) {
        Ok(s)  => s,
        Err(_) => return "[structured-io | toml | invalid UTF-8]".into(),
    };
    match toml::from_str::<toml::Value>(text) {
        Ok(v)  => {
            let json = serde_json::to_value(&v).unwrap_or_default();
            page_json_value(json, page_size, offset)
                .replacen("| json |", "| toml |", 1)
        }
        Err(e) => format!("[structured-io | toml | parse error: {e}]"),
    }
}

fn parse_page_yaml(bytes: &[u8], page_size: usize, offset: usize) -> String {
    let text = match std::str::from_utf8(bytes) {
        Ok(s)  => s,
        Err(_) => return "[structured-io | yaml | invalid UTF-8]".into(),
    };
    match serde_yaml::from_str::<serde_yaml::Value>(text) {
        Ok(yaml) => {
            let json = serde_json::to_value(&yaml).unwrap_or_default();
            page_json_value(json, page_size, offset)
                .replacen("| json |", "| yaml |", 1)
        }
        Err(e) => format!("[structured-io | yaml | parse error: {e}]"),
    }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

fn atomic_write(path: &str, content: &[u8]) -> Result<(), String> {
    // Write to a sibling .tmp file then rename — both ops on the same
    // filesystem, so the rename is atomic and a reader never sees a torn file.
    let tmp = format!("{path}.tmp");
    std::fs::write(&tmp, content).map_err(|e| format!("write/tmp({path}): {e}"))?;
    std::fs::rename(&tmp, path).map_err(|e| format!("write/rename({path}): {e}"))
}

export!(AgentTools);
