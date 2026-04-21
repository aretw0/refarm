//! Agent tool bridge — host implementations of `agent-fs`, `agent-shell`, and `host-spawn`.
//!
//! Pi Agent's 4 primitives exposed to WASM plugins:
//!   read, write, edit  → `agent-fs`
//!   spawn              → `agent-shell`
//!
//! `host-spawn` is the mechanism import for agent-tools.wasm:
//!   the WASM component enforces policy; `spawn_process` does the actual OS fork/exec.

use std::io::Write as _;
use std::path::{Path, PathBuf};

use tokio::io::{AsyncRead, AsyncReadExt as _, AsyncWriteExt as _};
use tokio::process::Command;
use tokio::time::{timeout, Duration};

use crate::host::agent_tools_bindings::refarm::agent_tools::host_spawn::Host as HostSpawnHost;
use crate::host::plugin_host::refarm::plugin::{
    agent_fs::Host as AgentFsHost,
    agent_shell::{Host as AgentShellHost, SpawnRequest, SpawnResult},
};
use crate::host::wasi_bridge::TractorNativeBindings;

// ── agent-fs ──────────────────────────────────────────────────────────────────

#[wasmtime::component::__internal::async_trait]
impl AgentFsHost for TractorNativeBindings {
    async fn read(&mut self, path: String) -> Result<Vec<u8>, String> {
        enforce_fs_root(&path)?;
        tokio::fs::read(&path)
            .await
            .map_err(|e| format!("read({path}): {e}"))
    }

    async fn write(&mut self, path: String, content: Vec<u8>) -> Result<(), String> {
        enforce_fs_root(&path)?;
        atomic_write(&path, &content)
            .await
            .map_err(|e| format!("write({path}): {e}"))
    }

    async fn edit(&mut self, path: String, diff: String) -> Result<(), String> {
        enforce_fs_root(&path)?;

        let original = tokio::fs::read_to_string(&path)
            .await
            .map_err(|e| format!("edit/read({path}): {e}"))?;

        let patch = diffy::Patch::from_str(&diff)
            .map_err(|e| format!("edit/parse-diff: {e}"))?;

        let patched = diffy::apply(&original, &patch)
            .map_err(|e| format!("edit/apply({path}): {e}"))?;

        atomic_write(&path, patched.as_bytes())
            .await
            .map_err(|e| format!("edit/write({path}): {e}"))
    }
}

// ── agent-shell (host primitive — Fase 1 fallback) ────────────────────────────
//
// When agent-tools.wasm is NOT loaded, TractorNativeBindings satisfies this
// import directly. When agent-tools.wasm IS loaded, its exports replace this
// via Component Model composition (Fase 3 — see HANDOFF.md Tarefa 2B).

#[wasmtime::component::__internal::async_trait]
impl AgentShellHost for TractorNativeBindings {
    async fn spawn(&mut self, req: SpawnRequest) -> Result<SpawnResult, String> {
        enforce_trusted_plugin_for_shell(&self.plugin_id)?;
        if req.argv.is_empty() {
            return Err("spawn: argv must be non-empty".into());
        }
        let (stdout, stderr, exit_code, timed_out) =
            spawn_process(&req.argv, &req.env, req.cwd.as_deref(), req.timeout_ms, req.stdin.as_deref()).await?;
        Ok(SpawnResult { stdout, stderr, exit_code, timed_out })
    }
}

// ── host-spawn (mechanism import for agent-tools.wasm) ───────────────────────
//
// agent-tools.wasm enforces policy (argv non-empty, timeout cap) then calls
// this import. The host does the actual OS fork/exec — no second check needed.

#[wasmtime::component::__internal::async_trait]
impl HostSpawnHost for TractorNativeBindings {
    async fn do_spawn(
        &mut self,
        argv: Vec<String>,
        env: Vec<(String, String)>,
        cwd: Option<String>,
        timeout_ms: u32,
        stdin: Option<Vec<u8>>,
    ) -> Result<(Vec<u8>, Vec<u8>, i32, bool), String> {
        spawn_process(&argv, &env, cwd.as_deref(), timeout_ms, stdin.as_deref()).await
    }
}

// ── Core spawn logic ──────────────────────────────────────────────────────────
//
// Shared by AgentShellHost::spawn (direct host primitive) and HostSpawnHost::do_spawn
// (mechanism import for agent-tools.wasm). Callers must pre-validate argv.

pub(crate) async fn spawn_process(
    argv: &[String],
    env: &[(String, String)],
    cwd: Option<&str>,
    timeout_ms: u32,
    stdin: Option<&[u8]>,
) -> Result<(Vec<u8>, Vec<u8>, i32, bool), String> {
    debug_assert!(!argv.is_empty(), "spawn_process: argv must be non-empty");

    enforce_shell_allowlist(argv)?;
    enforce_spawn_env(env)?;

    if let Some(dir) = cwd {
        enforce_spawn_cwd(dir)?;
    }
    if let Some(stdin_bytes) = stdin {
        if stdin_bytes.len() > MAX_SPAWN_STDIN_LEN {
            return Err("spawn: stdin exceeds max length".to_string());
        }
    }

    let binary = &argv[0];
    let args = &argv[1..];
    let timeout_dur = Duration::from_millis(effective_spawn_timeout_ms(timeout_ms) as u64);

    let mut cmd = Command::new(binary);
    cmd.args(args)
        .env_clear()
        .envs(env.iter().map(|(k, v)| (k.as_str(), v.as_str())))
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .stdin(if stdin.is_some() {
            std::process::Stdio::piped()
        } else {
            std::process::Stdio::null()
        });

    if let Some(dir) = cwd {
        cmd.current_dir(dir);
    }

    let mut child = cmd.spawn().map_err(|e| format!("spawn({binary}): {e}"))?;

    if let Some(stdin_bytes) = stdin {
        if let Some(mut handle) = child.stdin.take() {
            handle
                .write_all(stdin_bytes)
                .await
                .map_err(|e| format!("spawn/stdin: {e}"))?;
        }
    }

    // Drain stdout/stderr on background tasks — lets us call child.kill()
    // if the timeout fires without consuming ownership via wait_with_output.
    let out_pipe = child.stdout.take();
    let err_pipe = child.stderr.take();

    let stdout_task = tokio::spawn(read_spawn_pipe_limited(out_pipe));
    let stderr_task = tokio::spawn(read_spawn_pipe_limited(err_pipe));

    match timeout(timeout_dur, child.wait()).await {
        Ok(Ok(status)) => {
            let stdout = stdout_task.await.unwrap_or_default();
            let stderr = stderr_task.await.unwrap_or_default();
            Ok((stdout, stderr, status.code().unwrap_or(-1), false))
        }
        Ok(Err(e)) => Err(format!("spawn/wait: {e}")),
        Err(_) => {
            stdout_task.abort();
            stderr_task.abort();
            let _ = child.kill().await;
            Ok((vec![], b"process killed: timeout exceeded".to_vec(), -1, true))
        }
    }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async fn atomic_write(path: &str, content: &[u8]) -> anyhow::Result<()> {
    let target = Path::new(path);
    let parent = target
        .parent()
        .ok_or_else(|| anyhow::anyhow!("path has no parent: {path}"))?;

    let tmp = tempfile::NamedTempFile::new_in(parent)?;
    {
        let mut f = tmp.as_file();
        f.write_all(content)?;
        f.sync_all()?;
    }
    tmp.persist(target)?;
    tracing::debug!(path, bytes = content.len(), "atomic_write: ok");
    Ok(())
}

fn enforce_shell_allowlist(argv: &[String]) -> Result<(), String> {
    let allowlist = shell_allowlist_from_env();
    // Backward-compatible default remains permissive for command selection when
    // env var is not set, but structural argv guards must still apply.
    enforce_shell_allowlist_with(argv, allowlist.as_ref())
}

fn enforce_trusted_plugin_for_shell(plugin_id: &str) -> Result<(), String> {
    let Some(allowed) = trusted_plugins_from_refarm_config()? else {
        // Backward-compatible default: permissive when trusted_plugins is not configured.
        return Ok(());
    };
    enforce_trusted_plugin_for_shell_with(plugin_id, Some(&allowed))
}

fn enforce_trusted_plugin_for_shell_with(
    plugin_id: &str,
    allowed: Option<&std::collections::HashSet<String>>,
) -> Result<(), String> {
    let Some(allowed) = allowed else {
        return Ok(());
    };
    let plugin_id = plugin_id.trim();
    if plugin_id.is_empty() {
        return Err("[blocked: plugin id is empty]".to_string());
    }
    if contains_control_chars(plugin_id) {
        return Err("[blocked: plugin id contains control characters]".to_string());
    }
    if !is_safe_plugin_id_token(plugin_id) {
        return Err("[blocked: plugin id has invalid characters]".to_string());
    }
    let normalized_plugin_id = plugin_id.to_ascii_lowercase();
    if allowed.contains("*") || allowed.contains(&normalized_plugin_id) {
        Ok(())
    } else {
        Err(format!("[blocked: plugin '{plugin_id}' not allowed to use agent-shell]"))
    }
}

fn contains_control_chars(value: &str) -> bool {
    value.chars().any(|c| c.is_control())
}

fn contains_whitespace(value: &str) -> bool {
    value.chars().any(|c| c.is_whitespace())
}

fn effective_spawn_timeout_ms(requested: u32) -> u32 {
    requested.clamp(1, MAX_SPAWN_TIMEOUT_MS)
}

const MAX_SHELL_TOKEN_LEN: usize = 256;
const MAX_SHELL_ALLOWLIST_ENTRIES: usize = 256;
const MAX_SHELL_ALLOWLIST_SCAN: usize = 512;
const MAX_SHELL_ALLOWLIST_RAW_LEN: usize = 16 * 1024;
const MAX_SPAWN_ARGV_COUNT: usize = 128;
const MAX_SPAWN_ARG_LEN: usize = 4096;
const MAX_SPAWN_ARGV_TOTAL_BYTES: usize = 64 * 1024;
const MAX_SPAWN_TIMEOUT_MS: u32 = 300_000;
const MAX_TRUSTED_PLUGINS: usize = 256;
const MAX_FS_PATH_LEN: usize = 4096;
const MAX_SPAWN_ENV_KEY_LEN: usize = 128;
const MAX_SPAWN_ENV_VALUE_LEN: usize = 4096;
const MAX_SPAWN_ENV_TOTAL_BYTES: usize = 128 * 1024;
const MAX_SPAWN_ENV_VARS: usize = 128;
const MAX_SPAWN_CWD_LEN: usize = 4096;
const MAX_SPAWN_STDIN_LEN: usize = 1024 * 1024;
const MAX_SPAWN_STDIO_LEN: usize = 1024 * 1024;

async fn read_spawn_pipe_limited<R>(pipe: Option<R>) -> Vec<u8>
where
    R: AsyncRead + Unpin,
{
    let mut buf = Vec::new();
    let Some(mut pipe) = pipe else {
        return buf;
    };
    if (&mut pipe)
        .take(MAX_SPAWN_STDIO_LEN as u64 + 1)
        .read_to_end(&mut buf)
        .await
        .is_err()
    {
        return Vec::new();
    }
    if buf.len() > MAX_SPAWN_STDIO_LEN {
        buf.truncate(MAX_SPAWN_STDIO_LEN);
        buf.extend_from_slice(b"\n[truncated: spawn output exceeded limit]");
    }
    buf
}

fn is_safe_spawn_env_key(key: &str) -> bool {
    if key.is_empty() || key.len() > MAX_SPAWN_ENV_KEY_LEN {
        return false;
    }
    if contains_control_chars(key) || contains_whitespace(key) {
        return false;
    }
    let mut chars = key.chars();
    let Some(first) = chars.next() else {
        return false;
    };
    if !(first.is_ascii_alphabetic() || first == '_') {
        return false;
    }
    chars.all(|c| c.is_ascii_alphanumeric() || c == '_')
}

fn is_blocked_spawn_env_key(key: &str) -> bool {
    let upper = key.to_ascii_uppercase();
    matches!(
        upper.as_str(),
        "PATH"
            | "BASH_ENV"
            | "ENV"
            | "NODE_OPTIONS"
            | "NODE_PATH"
            | "CLASSPATH"
            | "JAVA_TOOL_OPTIONS"
            | "_JAVA_OPTIONS"
            | "PYTHONPATH"
            | "PYTHONHOME"
            | "PYTHONSTARTUP"
            | "PYTHONUSERBASE"
            | "RUBYOPT"
            | "RUBYLIB"
            | "PERL5OPT"
            | "PERL5LIB"
            | "GEM_HOME"
            | "GEM_PATH"
            | "LUA_PATH"
            | "LUA_CPATH"
            | "LD_PRELOAD"
            | "LD_AUDIT"
            | "LD_LIBRARY_PATH"
            | "DYLD_INSERT_LIBRARIES"
            | "DYLD_LIBRARY_PATH"
            | "DYLD_FRAMEWORK_PATH"
            | "DYLD_FALLBACK_LIBRARY_PATH"
    )
}

fn enforce_spawn_env(env: &[(String, String)]) -> Result<(), String> {
    if env.len() > MAX_SPAWN_ENV_VARS {
        return Err("spawn: too many env vars".to_string());
    }

    let mut seen = std::collections::HashSet::new();
    let mut total_bytes = 0usize;
    for (key, value) in env {
        if !seen.insert(key.to_ascii_uppercase()) {
            return Err("spawn: duplicate env key".to_string());
        }
        if !is_safe_spawn_env_key(key) {
            return Err("spawn: invalid env key".to_string());
        }
        if is_blocked_spawn_env_key(key) {
            return Err("spawn: blocked env key".to_string());
        }
        if value.len() > MAX_SPAWN_ENV_VALUE_LEN {
            return Err("spawn: env value exceeds max length".to_string());
        }
        if contains_control_chars(value) {
            return Err("spawn: env value contains control characters".to_string());
        }
        let next_total = total_bytes.saturating_add(key.len() + value.len());
        if next_total > MAX_SPAWN_ENV_TOTAL_BYTES {
            return Err("spawn: env payload exceeds max total bytes".to_string());
        }
        total_bytes = next_total;
    }
    Ok(())
}

fn enforce_spawn_cwd(cwd: &str) -> Result<(), String> {
    let fs_root = configured_fs_root()?;
    enforce_spawn_cwd_with(cwd, fs_root.as_deref())
}

fn enforce_spawn_cwd_with(cwd: &str, fs_root: Option<&Path>) -> Result<(), String> {
    let trimmed = cwd.trim();
    if trimmed.is_empty() {
        return Err("spawn: cwd must be non-empty".to_string());
    }
    if trimmed != cwd {
        return Err("spawn: cwd contains surrounding whitespace".to_string());
    }
    if cwd.len() > MAX_SPAWN_CWD_LEN {
        return Err("spawn: cwd exceeds max length".to_string());
    }
    if contains_control_chars(cwd) {
        return Err("spawn: cwd contains control characters".to_string());
    }
    if let Some(root) = fs_root {
        if let Err(_) = enforce_fs_root_with(cwd, Some(root)) {
            return Err("spawn: cwd outside LLM_FS_ROOT".to_string());
        }
    }
    Ok(())
}

fn is_safe_plugin_id_token(value: &str) -> bool {
    const MAX_PLUGIN_ID_LEN: usize = 128;
    value.len() <= MAX_PLUGIN_ID_LEN
        && value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-' || b == b'.')
}

fn trusted_plugins_from_refarm_config() -> Result<Option<std::collections::HashSet<String>>, String> {
    let base = std::env::current_dir().map_err(|e| format!("current_dir: {e}"))?;
    let path = base.join(".refarm/config.json");
    let bytes = read_trusted_plugins_config_bytes(&path)?;
    let Some(bytes) = bytes else {
        return Ok(None);
    };
    let cfg = serde_json::from_slice::<serde_json::Value>(&bytes)
        .map_err(|e| format!("[blocked: invalid .refarm/config.json: {e}]"))?;
    parse_trusted_plugins(&cfg)
}

fn read_trusted_plugins_config_bytes(path: &Path) -> Result<Option<Vec<u8>>, String> {
    const MAX_REFARM_CONFIG_BYTES: u64 = 256 * 1024;

    let Ok(metadata) = std::fs::symlink_metadata(path) else {
        return Ok(None);
    };
    if !metadata.is_file() {
        return Err("[blocked: .refarm/config.json must be a regular file for trusted_plugins]".to_string());
    }
    if metadata.len() > MAX_REFARM_CONFIG_BYTES {
        return Err("[blocked: .refarm/config.json exceeds max size for trusted_plugins]".to_string());
    }

    let mut file = std::fs::File::open(path).map_err(|e| format!("read .refarm/config.json: {e}"))?;
    ensure_trusted_plugins_config_path_matches_open_file(path, &file)?;

    let mut bytes = Vec::new();
    use std::io::Read as _;
    (&mut file)
        .take(MAX_REFARM_CONFIG_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| format!("read .refarm/config.json: {e}"))?;
    if bytes.len() as u64 > MAX_REFARM_CONFIG_BYTES {
        return Err("[blocked: .refarm/config.json exceeds max size for trusted_plugins]".to_string());
    }
    Ok(Some(bytes))
}

#[cfg(unix)]
fn ensure_trusted_plugins_config_path_matches_open_file(
    path: &Path,
    file: &std::fs::File,
) -> Result<(), String> {
    use std::os::unix::fs::MetadataExt;

    let path_metadata = std::fs::symlink_metadata(path)
        .map_err(|e| format!("read .refarm/config.json: {e}"))?;
    let file_metadata = file
        .metadata()
        .map_err(|e| format!("read .refarm/config.json: {e}"))?;

    if !path_metadata.is_file() || !file_metadata.is_file() {
        return Err(
            "[blocked: .refarm/config.json must be a regular file for trusted_plugins]"
                .to_string(),
        );
    }

    if path_metadata.dev() != file_metadata.dev() || path_metadata.ino() != file_metadata.ino() {
        return Err(
            "[blocked: .refarm/config.json changed during trusted_plugins read]".to_string(),
        );
    }

    Ok(())
}

#[cfg(not(unix))]
fn ensure_trusted_plugins_config_path_matches_open_file(
    path: &Path,
    file: &std::fs::File,
) -> Result<(), String> {
    let path_metadata = std::fs::symlink_metadata(path)
        .map_err(|e| format!("read .refarm/config.json: {e}"))?;
    let file_metadata = file
        .metadata()
        .map_err(|e| format!("read .refarm/config.json: {e}"))?;

    if !path_metadata.is_file() || !file_metadata.is_file() {
        return Err(
            "[blocked: .refarm/config.json must be a regular file for trusted_plugins]"
                .to_string(),
        );
    }

    Ok(())
}

fn parse_trusted_plugins(
    cfg: &serde_json::Value,
) -> Result<Option<std::collections::HashSet<String>>, String> {
    let Some(raw) = cfg.get("trusted_plugins") else {
        return Ok(None);
    };
    let arr = raw
        .as_array()
        .ok_or_else(|| "[blocked: .refarm/config.json trusted_plugins must be an array]".to_string())?;
    if arr.len() > MAX_TRUSTED_PLUGINS {
        return Err("[blocked: .refarm/config.json trusted_plugins exceeds max entries]".to_string());
    }
    let mut out = std::collections::HashSet::new();
    for item in arr {
        let plugin = item
            .as_str()
            .ok_or_else(|| "[blocked: .refarm/config.json trusted_plugins must contain only strings]".to_string())?
            .trim();
        if contains_control_chars(plugin) {
            return Err(
                "[blocked: .refarm/config.json trusted_plugins cannot contain control characters]"
                    .to_string(),
            );
        }
        if plugin != "*" && !is_safe_plugin_id_token(plugin) {
            return Err(
                "[blocked: .refarm/config.json trusted_plugins contain invalid characters]"
                    .to_string(),
            );
        }
        if plugin == "*" {
            out.insert(plugin.to_string());
        } else if !plugin.is_empty() {
            out.insert(plugin.to_ascii_lowercase());
        }
    }
    if out.contains("*") && out.len() > 1 {
        return Err(
            "[blocked: .refarm/config.json trusted_plugins wildcard must be the only entry]"
                .to_string(),
        );
    }
    Ok(Some(out))
}

fn shell_allowlist_from_env() -> Option<std::collections::HashSet<String>> {
    let raw = std::env::var("LLM_SHELL_ALLOWLIST").ok()?;
    Some(parse_shell_allowlist(&raw))
}

fn parse_shell_allowlist(raw: &str) -> std::collections::HashSet<String> {
    if raw.len() > MAX_SHELL_ALLOWLIST_RAW_LEN {
        return std::collections::HashSet::new();
    }

    raw.split(',')
        .take(MAX_SHELL_ALLOWLIST_SCAN)
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .filter(|s| s.is_ascii())
        .filter(|s| !contains_control_chars(s))
        .filter(|s| !contains_whitespace(s))
        .filter(|s| s.len() <= MAX_SHELL_TOKEN_LEN)
        .take(MAX_SHELL_ALLOWLIST_ENTRIES)
        .map(ToString::to_string)
        .collect()
}

fn enforce_shell_allowlist_with(
    argv: &[String],
    allowlist: Option<&std::collections::HashSet<String>>,
) -> Result<(), String> {
    if argv.is_empty() {
        return Err("spawn: argv must be non-empty".into());
    }
    if argv.len() > MAX_SPAWN_ARGV_COUNT {
        return Err("spawn: too many argv entries".into());
    }
    let binary_raw = argv[0].as_str();
    let binary = binary_raw.trim();
    if binary.is_empty() {
        return Err("spawn: binary must be non-empty".into());
    }
    if binary != binary_raw {
        return Err("[blocked: binary contains surrounding whitespace]".into());
    }
    if contains_control_chars(binary) {
        return Err("[blocked: binary contains control characters]".into());
    }
    if contains_whitespace(binary) {
        return Err("[blocked: binary contains whitespace]".into());
    }
    if !binary.is_ascii() {
        return Err("[blocked: binary must be ascii]".into());
    }
    if binary.len() > MAX_SHELL_TOKEN_LEN {
        return Err("[blocked: binary exceeds max length]".into());
    }

    enforce_spawn_argv_within_limits(argv)?;

    let Some(allowlist) = allowlist else {
        return Ok(());
    };
    if allowlist.contains("*") {
        return Ok(());
    }
    let cmd = Path::new(binary)
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or(binary);

    let has_path_components = Path::new(binary).components().count() > 1;
    if has_path_components {
        if allowlist.contains(binary) {
            return Ok(());
        }
        return Err(format!("[blocked: {binary} not in allowlist]"));
    }

    if allowlist.contains(binary) || allowlist.contains(cmd) {
        return Ok(());
    }

    Err(format!("[blocked: {cmd} not in allowlist]"))
}

fn enforce_spawn_argv_within_limits(argv: &[String]) -> Result<(), String> {
    let mut total_bytes = 0usize;
    for (idx, entry) in argv.iter().enumerate() {
        if entry.len() > MAX_SPAWN_ARG_LEN {
            return Err("spawn: argv entry exceeds max length".to_string());
        }
        if idx > 0 && contains_control_chars(entry) {
            return Err("spawn: argv contains control characters".to_string());
        }
        let next_total = total_bytes.saturating_add(entry.len());
        if next_total > MAX_SPAWN_ARGV_TOTAL_BYTES {
            return Err("spawn: argv payload exceeds max total bytes".to_string());
        }
        total_bytes = next_total;
    }
    Ok(())
}

fn configured_fs_root() -> Result<Option<PathBuf>, String> {
    let Ok(raw) = std::env::var("LLM_FS_ROOT") else {
        return Ok(None);
    };
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Ok(Some(PathBuf::new()));
    }
    let root = std::fs::canonicalize(trimmed)
        .map_err(|e| format!("[blocked: invalid LLM_FS_ROOT '{trimmed}': {e}]"))?;
    Ok(Some(root))
}

fn enforce_fs_root(path: &str) -> Result<(), String> {
    let fs_root = configured_fs_root()?;
    enforce_fs_root_with(path, fs_root.as_deref())
}

fn enforce_fs_root_with(path: &str, fs_root: Option<&Path>) -> Result<(), String> {
    let Some(root) = fs_root else {
        return Ok(());
    };

    if root.as_os_str().is_empty() {
        return Err("[blocked: path outside LLM_FS_ROOT]".into());
    }

    let resolved = resolve_for_fs_policy(path)?;
    if resolved.starts_with(root) {
        Ok(())
    } else {
        Err("[blocked: path outside LLM_FS_ROOT]".into())
    }
}

fn resolve_for_fs_policy(path: &str) -> Result<PathBuf, String> {
    if contains_control_chars(path) {
        return Err("[blocked: path contains control characters]".to_string());
    }
    if path.len() > MAX_FS_PATH_LEN {
        return Err("[blocked: path exceeds max length]".to_string());
    }

    let candidate = if Path::new(path).is_absolute() {
        PathBuf::from(path)
    } else {
        std::env::current_dir()
            .map_err(|e| format!("resolve current_dir: {e}"))?
            .join(path)
    };

    let resolved = resolve_existing_ancestor_path(&candidate)?;
    Ok(normalize_lexical_path(&resolved))
}

fn normalize_lexical_path(path: &Path) -> PathBuf {
    use std::path::Component;

    let mut out = PathBuf::new();
    for component in path.components() {
        match component {
            Component::Prefix(prefix) => out.push(prefix.as_os_str()),
            Component::RootDir => out.push(Path::new("/")),
            Component::CurDir => {}
            Component::ParentDir => {
                if !out.pop() && !out.is_absolute() {
                    out.push("..");
                }
            }
            Component::Normal(seg) => out.push(seg),
        }
    }
    out
}

fn resolve_existing_ancestor_path(path: &Path) -> Result<PathBuf, String> {
    let mut missing: Vec<std::ffi::OsString> = Vec::new();
    let mut cursor = path;

    loop {
        if let Ok(mut base) = std::fs::canonicalize(cursor) {
            for component in missing.iter().rev() {
                base.push(component);
            }
            return Ok(base);
        }

        let Some(name) = cursor.file_name() else {
            return Err(format!("resolve path({}): no existing ancestor", path.display()));
        };
        missing.push(name.to_os_string());

        let Some(parent) = cursor.parent() else {
            return Err(format!("resolve path({}): no existing ancestor", path.display()));
        };
        cursor = parent;
    }
}

// ─────────────────────────────────────────────────────────────────────────────

#[cfg(test)]
#[path = "agent_tools_bridge_tests.rs"]
mod tests;
