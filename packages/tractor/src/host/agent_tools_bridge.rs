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

use tokio::io::AsyncWriteExt as _;
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

    let binary = &argv[0];
    let args = &argv[1..];
    let timeout_dur = Duration::from_millis(timeout_ms.max(1) as u64);

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
    use tokio::io::AsyncReadExt as _;
    let mut out_pipe = child.stdout.take();
    let mut err_pipe = child.stderr.take();

    let stdout_task = tokio::spawn(async move {
        let mut buf = Vec::new();
        if let Some(ref mut p) = out_pipe {
            let _ = p.read_to_end(&mut buf).await;
        }
        buf
    });
    let stderr_task = tokio::spawn(async move {
        let mut buf = Vec::new();
        if let Some(ref mut p) = err_pipe {
            let _ = p.read_to_end(&mut buf).await;
        }
        buf
    });

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
    let Some(allowlist) = shell_allowlist_from_env() else {
        // Backward-compatible default: permissive when env var is not set.
        return Ok(());
    };
    enforce_shell_allowlist_with(argv, Some(&allowlist))
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
    if allowed.contains("*") || allowed.contains(plugin_id) {
        Ok(())
    } else {
        Err(format!("[blocked: plugin '{plugin_id}' not allowed to use agent-shell]"))
    }
}

fn trusted_plugins_from_refarm_config() -> Result<Option<std::collections::HashSet<String>>, String> {
    let base = std::env::current_dir().map_err(|e| format!("current_dir: {e}"))?;
    let path = base.join(".refarm/config.json");
    let Ok(bytes) = std::fs::read(&path) else {
        return Ok(None);
    };
    let cfg = serde_json::from_slice::<serde_json::Value>(&bytes)
        .map_err(|e| format!("[blocked: invalid .refarm/config.json: {e}]"))?;
    parse_trusted_plugins(&cfg)
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
    let mut out = std::collections::HashSet::new();
    for item in arr {
        let plugin = item
            .as_str()
            .ok_or_else(|| "[blocked: .refarm/config.json trusted_plugins must contain only strings]".to_string())?
            .trim();
        if !plugin.is_empty() {
            out.insert(plugin.to_string());
        }
    }
    Ok(Some(out))
}

fn shell_allowlist_from_env() -> Option<std::collections::HashSet<String>> {
    let raw = std::env::var("LLM_SHELL_ALLOWLIST").ok()?;
    Some(parse_shell_allowlist(&raw))
}

fn parse_shell_allowlist(raw: &str) -> std::collections::HashSet<String> {
    raw.split(',')
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(ToString::to_string)
        .collect()
}

fn enforce_shell_allowlist_with(
    argv: &[String],
    allowlist: Option<&std::collections::HashSet<String>>,
) -> Result<(), String> {
    let Some(allowlist) = allowlist else {
        return Ok(());
    };
    if argv.is_empty() {
        return Err("spawn: argv must be non-empty".into());
    }
    let binary = argv[0].as_str();
    let cmd = Path::new(binary)
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or(binary);

    if allowlist.contains(binary) || allowlist.contains(cmd) {
        return Ok(());
    }

    Err(format!("[blocked: {cmd} not in allowlist]"))
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
    let candidate = if Path::new(path).is_absolute() {
        PathBuf::from(path)
    } else {
        std::env::current_dir()
            .map_err(|e| format!("resolve current_dir: {e}"))?
            .join(path)
    };

    resolve_existing_ancestor_path(&candidate)
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
mod tests {
    use super::*;
    use crate::{NativeStorage, NativeSync, TelemetryBus};
    use crate::host::plugin_host::refarm::plugin::{
        agent_fs::Host as AgentFsHost,
        agent_shell::{Host as AgentShellHost, SpawnRequest},
    };

    fn make_bindings() -> TractorNativeBindings {
        let storage = NativeStorage::open(":memory:").unwrap();
        let sync = NativeSync::new(storage, ":memory:").unwrap();
        let telemetry = TelemetryBus::new(10);
        TractorNativeBindings::new("test-agent", sync, telemetry)
    }

    fn spawn_req(argv: &[&str]) -> SpawnRequest {
        SpawnRequest {
            argv: argv.iter().map(|s| s.to_string()).collect(),
            env: vec![],
            cwd: None,
            timeout_ms: 5000,
            stdin: None,
        }
    }

    // ── agent-fs ──────────────────────────────────────────────────────────────

    #[tokio::test]
    async fn read_existing_file() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("hello.txt");
        std::fs::write(&path, b"sovereign").unwrap();

        let mut b = make_bindings();
        let result = AgentFsHost::read(&mut b, path.to_string_lossy().into_owned()).await;
        assert_eq!(result.unwrap(), b"sovereign");
    }

    #[tokio::test]
    async fn read_missing_file_returns_error() {
        let mut b = make_bindings();
        let result = AgentFsHost::read(&mut b, "/nonexistent/path/file.txt".into()).await;
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("read("));
    }

    #[tokio::test]
    async fn write_creates_file_atomically() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("output.txt");

        let mut b = make_bindings();
        AgentFsHost::write(&mut b, path.to_string_lossy().into_owned(), b"hello farm".to_vec())
            .await
            .unwrap();

        assert_eq!(std::fs::read(&path).unwrap(), b"hello farm");
    }

    #[tokio::test]
    async fn write_overwrites_existing_file() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("out.txt");
        std::fs::write(&path, b"old content").unwrap();

        let mut b = make_bindings();
        AgentFsHost::write(&mut b, path.to_string_lossy().into_owned(), b"new content".to_vec())
            .await
            .unwrap();

        assert_eq!(std::fs::read(&path).unwrap(), b"new content");
    }

    #[tokio::test]
    async fn edit_applies_valid_unified_diff() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("src.txt");
        std::fs::write(&path, "line one\nline two\nline three\n").unwrap();

        let diff = "--- src.txt\n+++ src.txt\n@@ -1,3 +1,3 @@\n line one\n-line two\n+line TWO\n line three\n";

        let mut b = make_bindings();
        AgentFsHost::edit(&mut b, path.to_string_lossy().into_owned(), diff.into())
            .await
            .unwrap();

        let result = std::fs::read_to_string(&path).unwrap();
        assert!(result.contains("line TWO"));
        assert!(!result.contains("line two"));
    }

    #[tokio::test]
    async fn edit_fails_on_wrong_context() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("src.txt");
        std::fs::write(&path, "completely different content\n").unwrap();

        let diff = "--- src.txt\n+++ src.txt\n@@ -1,3 +1,3 @@\n line one\n-line two\n+line TWO\n line three\n";

        let mut b = make_bindings();
        let result = AgentFsHost::edit(&mut b, path.to_string_lossy().into_owned(), diff.into()).await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn edit_fails_on_missing_file() {
        let mut b = make_bindings();
        let result = AgentFsHost::edit(&mut b, "/no/such/file.txt".into(), "--- a\n+++ b\n".into()).await;
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("edit/read("));
    }

    // ── agent-shell ───────────────────────────────────────────────────────────

    #[tokio::test]
    async fn spawn_echo_captures_stdout() {
        let mut b = make_bindings();
        let result = AgentShellHost::spawn(&mut b, spawn_req(&["echo", "sovereign farm"])).await.unwrap();
        assert_eq!(result.exit_code, 0);
        assert!(!result.timed_out);
        assert!(String::from_utf8_lossy(&result.stdout).contains("sovereign farm"));
    }

    #[tokio::test]
    async fn spawn_exit_code_propagated() {
        let mut b = make_bindings();
        let result = AgentShellHost::spawn(&mut b, spawn_req(&["false"])).await.unwrap();
        assert_ne!(result.exit_code, 0);
        assert!(!result.timed_out);
    }

    #[tokio::test]
    async fn spawn_empty_argv_returns_error() {
        let mut b = make_bindings();
        let req = SpawnRequest { argv: vec![], env: vec![], cwd: None, timeout_ms: 1000, stdin: None };
        let result = AgentShellHost::spawn(&mut b, req).await;
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("argv must be non-empty"));
    }

    #[tokio::test]
    async fn spawn_timeout_kills_process() {
        let mut b = make_bindings();
        let req = SpawnRequest {
            argv: vec!["sleep".into(), "60".into()],
            env: vec![],
            cwd: None,
            timeout_ms: 100,
            stdin: None,
        };
        let result = AgentShellHost::spawn(&mut b, req).await.unwrap();
        assert!(result.timed_out);
        assert_eq!(result.exit_code, -1);
    }

    #[tokio::test]
    async fn spawn_stdin_piped_to_process() {
        let mut b = make_bindings();
        let req = SpawnRequest {
            argv: vec!["cat".into()],
            env: vec![],
            cwd: None,
            timeout_ms: 5000,
            stdin: Some(b"refarm".to_vec()),
        };
        let result = AgentShellHost::spawn(&mut b, req).await.unwrap();
        assert_eq!(result.exit_code, 0);
        assert_eq!(&result.stdout, b"refarm");
    }

    #[tokio::test]
    async fn spawn_env_clear_no_ambient_env() {
        let mut b = make_bindings();
        let result = AgentShellHost::spawn(
            &mut b,
            spawn_req(&["sh", "-c", "echo ${HOME:-ABSENT}"]),
        )
        .await
        .unwrap();
        let out = String::from_utf8_lossy(&result.stdout);
        assert!(out.trim() == "ABSENT", "expected no HOME, got: {out}");
    }

    #[test]
    fn shell_allowlist_allows_binary_or_basename() {
        let allowlist = parse_shell_allowlist("ls,grep");

        let direct = vec!["ls".to_string(), "-la".to_string()];
        assert!(enforce_shell_allowlist_with(&direct, Some(&allowlist)).is_ok());

        let absolute = vec!["/bin/ls".to_string(), "-la".to_string()];
        assert!(enforce_shell_allowlist_with(&absolute, Some(&allowlist)).is_ok());
    }

    #[test]
    fn shell_allowlist_blocks_unknown_command() {
        let allowlist = parse_shell_allowlist("ls,grep");
        let argv = vec!["cat".to_string()];
        let err = enforce_shell_allowlist_with(&argv, Some(&allowlist)).unwrap_err();
        assert!(err.contains("not in allowlist"));
    }

    #[test]
    fn shell_allowlist_empty_string_blocks_all() {
        let allowlist = parse_shell_allowlist("   ");
        let argv = vec!["echo".to_string()];
        assert!(enforce_shell_allowlist_with(&argv, Some(&allowlist)).is_err());
    }

    #[test]
    fn shell_allowlist_unset_is_permissive() {
        let argv = vec!["echo".to_string(), "ok".to_string()];
        let result = enforce_shell_allowlist_with(&argv, None);
        assert!(result.is_ok());
    }

    #[test]
    fn shell_allowlist_parser_ignores_empty_entries_and_trims_whitespace() {
        let allowlist = parse_shell_allowlist(" ls , ,grep,   cat  ,");
        assert!(allowlist.contains("ls"));
        assert!(allowlist.contains("grep"));
        assert!(allowlist.contains("cat"));
        assert_eq!(allowlist.len(), 3);
    }

    #[test]
    fn fs_root_allows_paths_inside_root() {
        let dir = tempfile::tempdir().unwrap();
        let root = std::fs::canonicalize(dir.path()).unwrap();
        let file = root.join("safe.txt");

        let result = enforce_fs_root_with(file.to_string_lossy().as_ref(), Some(&root));
        assert!(result.is_ok(), "inside path should be allowed: {result:?}");
    }

    #[test]
    fn fs_root_blocks_paths_outside_root() {
        let root_dir = tempfile::tempdir().unwrap();
        let outside_dir = tempfile::tempdir().unwrap();
        let root = std::fs::canonicalize(root_dir.path()).unwrap();
        let outside = outside_dir.path().join("escape.txt");

        let err = enforce_fs_root_with(outside.to_string_lossy().as_ref(), Some(&root)).unwrap_err();
        assert!(err.contains("path outside LLM_FS_ROOT"));
    }

    #[test]
    fn fs_root_empty_marker_blocks_all_paths() {
        let err = enforce_fs_root_with("/tmp/anything", Some(Path::new(""))).unwrap_err();
        assert!(err.contains("path outside LLM_FS_ROOT"));
    }

    #[test]
    fn fs_root_blocks_parent_escape_sequence() {
        let root_dir = tempfile::tempdir().unwrap();
        let root = std::fs::canonicalize(root_dir.path()).unwrap();
        let escape = root.join("..").join("outside.txt");

        let err = enforce_fs_root_with(escape.to_string_lossy().as_ref(), Some(&root)).unwrap_err();
        assert!(err.contains("path outside LLM_FS_ROOT"));
    }

    #[test]
    fn trusted_plugins_parse_none_when_unset() {
        let cfg = serde_json::json!({"provider": "ollama"});
        let parsed = parse_trusted_plugins(&cfg).unwrap();
        assert!(parsed.is_none());
    }

    #[test]
    fn trusted_plugins_parse_blocks_invalid_type() {
        let cfg = serde_json::json!({"trusted_plugins": "pi_agent"});
        let err = parse_trusted_plugins(&cfg).unwrap_err();
        assert!(err.contains("trusted_plugins must be an array"));
    }

    #[test]
    fn trusted_plugins_parse_allows_only_strings() {
        let cfg = serde_json::json!({"trusted_plugins": ["pi_agent", "agent-tools", " "]});
        let parsed = parse_trusted_plugins(&cfg).unwrap().unwrap();
        assert!(parsed.contains("pi_agent"));
        assert!(parsed.contains("agent-tools"));
        assert!(!parsed.contains(""));
    }

    #[test]
    fn trusted_plugins_parse_trims_and_deduplicates_values() {
        let cfg = serde_json::json!({
            "trusted_plugins": [" pi_agent ", "pi_agent", "  ", "agent-tools"]
        });
        let parsed = parse_trusted_plugins(&cfg).unwrap().unwrap();
        assert!(parsed.contains("pi_agent"));
        assert!(parsed.contains("agent-tools"));
        assert_eq!(parsed.len(), 2);
    }

    #[test]
    fn trusted_plugins_parse_wildcard_with_whitespace_allows_any_plugin() {
        let cfg = serde_json::json!({"trusted_plugins": [" * "]});
        let parsed = parse_trusted_plugins(&cfg).unwrap().unwrap();
        assert!(parsed.contains("*"));
        assert_eq!(parsed.len(), 1);

        let ok = enforce_trusted_plugin_for_shell_with("any_plugin", Some(&parsed));
        assert!(ok.is_ok());
    }

    #[test]
    fn trusted_plugins_empty_array_blocks_all_plugins() {
        let cfg = serde_json::json!({"trusted_plugins": []});
        let parsed = parse_trusted_plugins(&cfg).unwrap().unwrap();
        assert!(parsed.is_empty());

        let err = enforce_trusted_plugin_for_shell_with("pi_agent", Some(&parsed)).unwrap_err();
        assert!(err.contains("not allowed to use agent-shell"));
    }

    #[test]
    fn trusted_plugins_enforcement_blocks_unlisted_plugin() {
        let allowed = std::collections::HashSet::from(["pi_agent".to_string()]);
        let err = enforce_trusted_plugin_for_shell_with("other_plugin", Some(&allowed)).unwrap_err();
        assert!(err.contains("not allowed to use agent-shell"));
    }

    #[test]
    fn trusted_plugins_unset_is_permissive() {
        let result = enforce_trusted_plugin_for_shell_with("any_plugin", None);
        assert!(result.is_ok());
    }

    #[test]
    fn trusted_plugins_enforcement_allows_wildcard() {
        let allowed = std::collections::HashSet::from(["*".to_string()]);
        let ok = enforce_trusted_plugin_for_shell_with("any_plugin", Some(&allowed));
        assert!(ok.is_ok());
    }
}
