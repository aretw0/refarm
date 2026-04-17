//! Agent tool bridge — host implementations of `agent-fs` and `agent-shell` WIT interfaces.
//!
//! These are the 4 Pi Agent primitives exposed to WASM plugins:
//!   read, write, edit  → `agent-fs`
//!   bash               → `agent-shell` (structured argv, no shell interpolation)

use std::io::Write as _;
use std::path::Path;

use tokio::io::AsyncWriteExt as _;
use tokio::process::Command;
use tokio::time::{timeout, Duration};

use crate::host::plugin_host::{
    refarm::plugin::{
        agent_fs::Host as AgentFsHost,
        agent_shell::{Host as AgentShellHost, SpawnRequest, SpawnResult},
    },
};

// ── TractorNativeBindings implements AgentFsHost ──────────────────────────────
//
// Imported here rather than wasi_bridge.rs to keep concerns separate.
// The impl block is on TractorNativeBindings (defined in wasi_bridge.rs).

use crate::host::wasi_bridge::TractorNativeBindings;

#[wasmtime::component::__internal::async_trait]
impl AgentFsHost for TractorNativeBindings {
    /// Read file contents from an absolute path.
    async fn read(&mut self, path: String) -> Result<Vec<u8>, String> {
        tokio::fs::read(&path)
            .await
            .map_err(|e| format!("read({path}): {e}"))
    }

    /// Write bytes atomically: write to sibling tmp file, then rename.
    async fn write(&mut self, path: String, content: Vec<u8>) -> Result<(), String> {
        atomic_write(&path, &content)
            .await
            .map_err(|e| format!("write({path}): {e}"))
    }

    /// Apply a unified diff to an existing file, atomically.
    async fn edit(&mut self, path: String, diff: String) -> Result<(), String> {
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

// ── TractorNativeBindings implements AgentShellHost ───────────────────────────

#[wasmtime::component::__internal::async_trait]
impl AgentShellHost for TractorNativeBindings {
    /// Spawn a subprocess with structured argv.
    ///
    /// Safety invariants enforced here:
    /// - argv must be non-empty (returns error otherwise)
    /// - argv[0] is passed directly to the OS — no shell interpolation
    /// - Hard timeout via tokio::time::timeout; process is killed on expiry
    async fn spawn(&mut self, req: SpawnRequest) -> Result<SpawnResult, String> {
        if req.argv.is_empty() {
            return Err("spawn: argv must be non-empty".into());
        }

        let binary = &req.argv[0];
        let args = &req.argv[1..];
        let timeout_ms = req.timeout_ms.max(1) as u64;

        let mut cmd = Command::new(binary);
        cmd.args(args)
            .env_clear()
            .envs(req.env.iter().map(|(k, v)| (k.as_str(), v.as_str())))
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .stdin(if req.stdin.is_some() {
                std::process::Stdio::piped()
            } else {
                std::process::Stdio::null()
            });

        if let Some(cwd) = &req.cwd {
            cmd.current_dir(cwd);
        }

        let mut child = cmd
            .spawn()
            .map_err(|e| format!("spawn({binary}): {e}"))?;

        if let Some(stdin_bytes) = req.stdin {
            if let Some(mut stdin_handle) = child.stdin.take() {
                stdin_handle
                    .write_all(&stdin_bytes)
                    .await
                    .map_err(|e| format!("spawn/stdin: {e}"))?;
            }
        }

        // Read stdout/stderr concurrently on background tasks so we can
        // still call child.kill() if the timeout fires (wait_with_output
        // takes ownership; wait() borrows, allowing kill() after timeout).
        use tokio::io::AsyncReadExt as _;
        let mut stdout_pipe = child.stdout.take();
        let mut stderr_pipe = child.stderr.take();

        let stdout_task = tokio::spawn(async move {
            let mut buf = Vec::new();
            if let Some(ref mut out) = stdout_pipe {
                let _ = out.read_to_end(&mut buf).await;
            }
            buf
        });
        let stderr_task = tokio::spawn(async move {
            let mut buf = Vec::new();
            if let Some(ref mut err) = stderr_pipe {
                let _ = err.read_to_end(&mut buf).await;
            }
            buf
        });

        match timeout(Duration::from_millis(timeout_ms), child.wait()).await {
            Ok(Ok(status)) => {
                let stdout = stdout_task.await.unwrap_or_default();
                let stderr = stderr_task.await.unwrap_or_default();
                Ok(SpawnResult {
                    stdout,
                    stderr,
                    exit_code: status.code().unwrap_or(-1) as i32,
                    timed_out: false,
                })
            }
            Ok(Err(e)) => Err(format!("spawn/wait: {e}")),
            Err(_) => {
                stdout_task.abort();
                stderr_task.abort();
                let _ = child.kill().await;
                Ok(SpawnResult {
                    stdout: vec![],
                    stderr: b"process killed: timeout exceeded".to_vec(),
                    exit_code: -1,
                    timed_out: true,
                })
            }
        }
    }
}

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

    // ── agent-fs: read ────────────────────────────────────────────────────────

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

    // ── agent-fs: write ───────────────────────────────────────────────────────

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

    // ── agent-fs: edit ────────────────────────────────────────────────────────

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

    // ── agent-shell: spawn ────────────────────────────────────────────────────

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
        // sleep for 60s with a 100ms timeout — must be killed
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
        // HOME is always set in the shell; with env_clear it should be absent
        let result = AgentShellHost::spawn(
            &mut b,
            spawn_req(&["sh", "-c", "echo ${HOME:-ABSENT}"]),
        )
        .await
        .unwrap();
        let out = String::from_utf8_lossy(&result.stdout);
        assert!(out.trim() == "ABSENT", "expected no HOME, got: {out}");
    }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/// Write `content` to `path` atomically using a sibling tmp file + rename.
async fn atomic_write(path: &str, content: &[u8]) -> anyhow::Result<()> {
    let target = Path::new(path);
    let parent = target
        .parent()
        .ok_or_else(|| anyhow::anyhow!("path has no parent: {path}"))?;

    // Create tmp file in same directory so the rename is on the same filesystem.
    let tmp = tempfile::NamedTempFile::new_in(parent)?;
    // Write content to tmp (sync — tempfile uses std::fs).
    {
        let mut f = tmp.as_file();
        f.write_all(content)?;
        f.sync_all()?;
    }

    // Persist (moves the tmp file; prevents auto-deletion on drop).
    tmp.persist(&target)?;

    tracing::debug!(path, bytes = content.len(), "atomic_write: ok");
    Ok(())
}
