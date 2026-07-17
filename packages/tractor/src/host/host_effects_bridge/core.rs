// Host-effect bridge — host implementations of `host-fs`, `host-shell`, and `host-spawn`.
//
// The 4 effect primitives exposed to WASM plugins:
//   read, write, edit  → `host-fs`
//   spawn              → `host-shell`
//
// `host-spawn` is the mechanism import for host-effects.wasm:
//   the WASM component enforces policy; `spawn_process` does the actual OS fork/exec.

use std::io::Write as _;
use std::path::{Path, PathBuf};

use tokio::io::{AsyncRead, AsyncReadExt as _, AsyncWriteExt as _};
use tokio::process::Command;
use tokio::time::{timeout, Duration};

use crate::host::host_effects_bindings::plugin::host_effects::host_spawn::Host as HostSpawnHost;
use crate::host::plugin_host::plugin::host::{
    code_ops::{CodeReference, Host as CodeOpsHost, RenameResult, SymbolLocation},
    host_fs::Host as HostFsHost,
    host_shell::{Host as HostShellHost, SpawnRequest, SpawnResult},
    structured_io::{FileFormat, Host as StructuredIoHost},
};
use crate::host::permission::Permission;
use crate::host::wasi_bridge::TractorNativeBindings;

impl TractorNativeBindings {
    /// Gate a host-effect on the plugin's DECLARED capability (the capability
    /// axis). This is orthogonal to and sits BESIDE the existing path/identity
    /// checks (`enforce_fs_root`, `enforce_trusted_plugin_for_shell_with` — the
    /// path-safety axis): a plugin must BOTH declare the permission AND pass the
    /// path/identity policy. Under dev security modes `grants` is permissive, so
    /// this is a no-op there; under Strict it denies an undeclared capability
    /// before the effect runs. A denial is emitted as telemetry (a
    /// security-relevant event), mirroring `request_permission`.
    fn enforce_permission(&self, permission: Permission) -> Result<(), String> {
        if self.permission_grant.grants_permission(permission) {
            return Ok(());
        }
        self.telemetry.emit_named(
            "permission:denied",
            Some(self.plugin_id.clone()),
            Some(serde_json::json!({
                "capability": permission.as_str(),
                "reason": "host-effect gated on declared permission",
            })),
        );
        Err(format!(
            "permission denied: plugin '{}' did not declare '{}'",
            self.plugin_id,
            permission.as_str()
        ))
    }
}

// ── host-fs ─────────────────────────────────────────────────────────────────

#[wasmtime::component::__internal::async_trait]
impl HostFsHost for TractorNativeBindings {
    async fn read(&mut self, path: String) -> Result<Vec<u8>, String> {
        self.enforce_permission(Permission::FsRead)?;
        enforce_fs_root(&path, &self.effect_policy)?;
        let bytes = tokio::fs::read(&path)
            .await
            .map_err(|e| format!("read({path}): {e}"))?;
        tracing::info!(plugin_id = %self.plugin_id, op = "host-fs.read", path = %path, bytes = bytes.len());
        self.telemetry.emit_named(
            "host-effect:fs:read",
            Some(self.plugin_id.clone()),
            Some(serde_json::json!({ "path": path, "bytes": bytes.len() })),
        );
        Ok(bytes)
    }

    async fn write(&mut self, path: String, content: Vec<u8>) -> Result<(), String> {
        self.enforce_permission(Permission::FsWrite)?;
        enforce_fs_root(&path, &self.effect_policy)?;
        let bytes = content.len();
        atomic_write(&path, &content)
            .await
            .map_err(|e| format!("write({path}): {e}"))?;
        tracing::info!(plugin_id = %self.plugin_id, op = "host-fs.write", path = %path, bytes = bytes);
        self.telemetry.emit_named(
            "host-effect:fs:write",
            Some(self.plugin_id.clone()),
            Some(serde_json::json!({ "path": path, "bytes": bytes })),
        );
        Ok(())
    }

    async fn edit(&mut self, path: String, diff: String) -> Result<(), String> {
        // edit is read-modify-write, but the net effect is a MUTATION and the file
        // content is never returned to the plugin (edit yields `Result<(), _>`), so
        // it is gated on fs:write alone — like an editor requesting "write" not
        // "read+write". The internal read is mechanical, not a content channel.
        self.enforce_permission(Permission::FsWrite)?;
        enforce_fs_root(&path, &self.effect_policy)?;

        let original = tokio::fs::read_to_string(&path)
            .await
            .map_err(|e| format!("edit/read({path}): {e}"))?;

        let patch = diffy::Patch::from_str(&diff)
            .map_err(|e| format!("edit/parse-diff: {e}"))?;

        let patched = diffy::apply(&original, &patch)
            .map_err(|e| format!("edit/apply({path}): {e}"))?;

        atomic_write(&path, patched.as_bytes())
            .await
            .map_err(|e| format!("edit/write({path}): {e}"))?;
        tracing::info!(plugin_id = %self.plugin_id, op = "host-fs.edit", path = %path, diff_bytes = diff.len());
        self.telemetry.emit_named(
            "host-effect:fs:edit",
            Some(self.plugin_id.clone()),
            Some(serde_json::json!({ "path": path, "diff_bytes": diff.len() })),
        );
        Ok(())
    }
}

// ── host-shell (host primitive — Fase 1 fallback) ─────────────────────────────
//
// When host-effects.wasm is NOT loaded, TractorNativeBindings satisfies this
// import directly. When host-effects.wasm IS loaded, its exports replace this
// via Component Model composition (Fase 3 — see HANDOFF.md Tarefa 2B).

#[wasmtime::component::__internal::async_trait]
impl HostShellHost for TractorNativeBindings {
    async fn spawn(&mut self, req: SpawnRequest) -> Result<SpawnResult, String> {
        self.enforce_permission(Permission::ShellSpawn)?;
        // In-memory trust gate — the allowlist was resolved ONCE per load (fs ∩ node,
        // B) and cloned into these bindings, so a spawn never reads the config from
        // disk and can never disagree with the load gate.
        enforce_trusted_plugin_for_shell_with(&self.plugin_id, self.trusted_plugins.as_ref())?;
        if req.argv.is_empty() {
            return Err("spawn: argv must be non-empty".into());
        }
        let t0 = tokio::time::Instant::now();
        let (stdout, stderr, exit_code, timed_out) = spawn_process(
            &req.argv,
            &req.env,
            req.cwd.as_deref(),
            req.timeout_ms,
            req.stdin.as_deref(),
            &self.effect_policy,
        )
        .await?;
        let duration_ms = t0.elapsed().as_millis() as u64;
        let cmd = req.argv.first().map(|s| s.as_str()).unwrap_or("<empty>");
        tracing::info!(
            plugin_id = %self.plugin_id,
            op = "host-shell.spawn",
            cmd = %cmd,
            exit_code = exit_code,
            duration_ms = duration_ms,
            timed_out = timed_out,
        );
        self.telemetry.emit_named(
            "host-effect:shell:spawn",
            Some(self.plugin_id.clone()),
            Some(serde_json::json!({
                "argv": req.argv,
                "cwd": req.cwd,
                "exit_code": exit_code,
                "duration_ms": duration_ms,
                "timed_out": timed_out,
            })),
        );
        Ok(SpawnResult { stdout, stderr, exit_code, timed_out })
    }
}

// ── host-spawn (mechanism import for host-effects.wasm) ──────────────────────
//
// host-effects.wasm enforces policy (argv non-empty, timeout cap) then calls
// this import. The host does the actual OS fork/exec — no second check needed.
//
// NOTE (Gate C scope): unlike `HostShellHost::spawn` (the integration-plugin
// surface, now gated on the declared `shell:spawn` capability), `do_spawn` is the
// mechanism import that ONLY `host-effects.wasm` imports — a trusted-computing-base
// component, not a sandboxed plugin. It is intentionally NOT capability-gated
// here: host-effects.wasm is the trusted effect-provider, and gating its
// mechanism on a plugin-style permission would conflate the TCB with the plugin
// sandbox. If host-effects.wasm ever becomes untrusted/replaceable, this becomes
// a gate site — tracked with the Gate C work, not a silent bypass.

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
        spawn_process(
            &argv,
            &env,
            cwd.as_deref(),
            timeout_ms,
            stdin.as_deref(),
            &self.effect_policy,
        )
        .await
    }
}

// ── Core spawn logic ──────────────────────────────────────────────────────────
//
// Shared by HostShellHost::spawn (direct host primitive) and HostSpawnHost::do_spawn
// (mechanism import for host-effects.wasm). Callers must pre-validate argv.

pub(crate) async fn spawn_process(
    argv: &[String],
    env: &[(String, String)],
    cwd: Option<&str>,
    timeout_ms: u32,
    stdin: Option<&[u8]>,
    policy: &HostEffectPolicy,
) -> Result<(Vec<u8>, Vec<u8>, i32, bool), String> {
    debug_assert!(!argv.is_empty(), "spawn_process: argv must be non-empty");

    enforce_shell_allowlist(argv, policy)?;
    enforce_spawn_env(env)?;

    if let Some(dir) = cwd {
        enforce_spawn_cwd(dir, policy)?;
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
        })
        // Put the child in its OWN process group (its PID becomes the PGID), so any
        // grandchild it forks (`bash -c 'sleep 999 &'`) joins that group. On timeout
        // we kill the whole group, not just the direct PID — otherwise the grandchild
        // survives as an orphan reparented to init. Unix-only; harmless elsewhere.
        .process_group(0);

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
            // Kill the whole process GROUP (negative PGID), so forked grandchildren die
            // too. The child leads its own group (`process_group(0)` above), so its PID
            // is the PGID. Fall back to killing just the child if the PID is already gone.
            kill_process_group(&mut child).await;
            Ok((vec![], b"process killed: timeout exceeded".to_vec(), -1, true))
        }
    }
}

/// SIGKILL the child's process group so grandchildren (forked `&` jobs) die with it,
/// then reap the child. `child` leads its own group (see `process_group(0)` at spawn),
/// so its PID is the group id; `kill(-pgid, SIGKILL)` targets the group.
async fn kill_process_group(child: &mut tokio::process::Child) {
    if let Some(pid) = child.id() {
        // SAFETY: `kill` with a negative pid targets the process group; SIGKILL is a
        // plain signal number. No memory is touched. A dead group returns ESRCH, ignored.
        unsafe {
            libc::kill(-(pid as i32), libc::SIGKILL);
        }
    }
    // Still reap the direct child so it doesn't linger as a zombie.
    let _ = child.kill().await;
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

fn enforce_shell_allowlist(argv: &[String], policy: &HostEffectPolicy) -> Result<(), String> {
    // Backward-compatible default remains permissive for command selection when
    // the allowlist is unset, but structural argv guards must still apply.
    enforce_shell_allowlist_with(argv, policy.shell_allowlist())
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
        Err(format!("[blocked: plugin '{plugin_id}' not allowed to use host-shell]"))
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

// Boundary-local (not shared): lexical shape checks for spawn env keys.
// Semantic sensitive-key policy is centralized in `sensitive_aliases`.
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
    crate::host::sensitive_aliases::is_spawn_sensitive_env_key(key)
}

// ── structured-io (host primitive for the effect-capable WIT import) ─────────
//
// Tractor provides structured-io natively so the guest's WIT import is satisfied
// without full Component Model composition. Once host-effects.wasm is composed
// (HANDOFF.md Tarefa 2B), tractor can delegate to its exported structured-io.

#[wasmtime::component::__internal::async_trait]
impl StructuredIoHost for TractorNativeBindings {
    async fn read_structured(
        &mut self,
        path: String,
        format: Option<FileFormat>,
        page_size: u32,
        page_offset: u32,
    ) -> Result<String, String> {
        enforce_fs_root(&path, &self.effect_policy)?;
        let bytes = tokio::fs::read(&path)
            .await
            .map_err(|e| format!("read({path}): {e}"))?;
        let fmt = match format {
            Some(FileFormat::Json) => "json",
            Some(FileFormat::Toml) => "toml",
            Some(FileFormat::Yaml) => "yaml",
            None => host_detect_format(&path),
        };
        Ok(host_read_structured_parse(&bytes, fmt, page_size as usize, page_offset as usize))
    }

    async fn write_structured(
        &mut self,
        path: String,
        content: String,
        format: Option<FileFormat>,
    ) -> Result<(), String> {
        enforce_fs_root(&path, &self.effect_policy)?;
        let fmt = match format {
            Some(FileFormat::Json) => "json",
            Some(FileFormat::Toml) => "toml",
            Some(FileFormat::Yaml) => "yaml",
            None => host_detect_format(&path),
        };
        host_validate_structured(&content, fmt)?;
        atomic_write(&path, content.as_bytes())
            .await
            .map_err(|e| format!("write({path}): {e}"))
    }
}

fn host_detect_format(path: &str) -> &'static str {
    if path.ends_with(".toml") { "toml" } else if path.ends_with(".yaml") || path.ends_with(".yml") { "yaml" } else { "json" }
}

fn host_validate_structured(content: &str, format: &str) -> Result<(), String> {
    match format {
        "json" => serde_json::from_str::<serde_json::Value>(content)
            .map(|_| ())
            .map_err(|e| format!("JSON parse error: {e}")),
        "toml" => toml::from_str::<toml::Value>(content)
            .map(|_| ())
            .map_err(|e| format!("TOML parse error: {e}")),
        "yaml" => serde_yaml::from_str::<serde_yaml::Value>(content)
            .map(|_| ())
            .map_err(|e| format!("YAML parse error: {e}")),
        other => Err(format!("unsupported format: {other}")),
    }
}

fn host_read_structured_parse(bytes: &[u8], fmt: &str, page_size: usize, page_offset: usize) -> String {
    let total_bytes = bytes.len();
    match fmt {
        "json" => {
            let Ok(text) = std::str::from_utf8(bytes) else {
                return "[read_structured | json | invalid UTF-8]".into();
            };
            let Ok(val) = serde_json::from_str::<serde_json::Value>(text) else {
                return "[read_structured | json | parse error]".into();
            };
            host_page_json(&val, total_bytes, "json", page_size, page_offset)
        }
        "toml" => {
            let Ok(text) = std::str::from_utf8(bytes) else {
                return "[read_structured | toml | invalid UTF-8]".into();
            };
            let Ok(val) = toml::from_str::<toml::Value>(text) else {
                return "[read_structured | toml | parse error]".into();
            };
            let Ok(json_val) = serde_json::to_value(&val) else {
                return "[read_structured | toml | conversion error]".into();
            };
            host_page_json(&json_val, total_bytes, "toml", page_size, page_offset)
        }
        "yaml" => {
            let Ok(text) = std::str::from_utf8(bytes) else {
                return "[read_structured | yaml | invalid UTF-8]".into();
            };
            let Ok(val) = serde_yaml::from_str::<serde_yaml::Value>(text) else {
                return "[read_structured | yaml | parse error]".into();
            };
            let Ok(json_val) = serde_json::to_value(val) else {
                return "[read_structured | yaml | conversion error]".into();
            };
            host_page_json(&json_val, total_bytes, "yaml", page_size, page_offset)
        }
        other => format!("[read_structured | unknown format: {other}]"),
    }
}

fn host_page_json(val: &serde_json::Value, total_bytes: usize, fmt: &str, page_size: usize, page_offset: usize) -> String {
    match val {
        serde_json::Value::Object(map) => {
            let keys: Vec<_> = map.keys().collect();
            let total = keys.len();
            if page_size == 0 || (page_offset == 0 && page_size >= total) {
                let note = format!("{total_bytes}B | complete");
                return format!(
                    "[read_structured | {fmt} | {note}]\n{}",
                    serde_json::to_string_pretty(val).unwrap_or_default()
                );
            }
            let page: serde_json::Map<_, _> = keys
                .iter()
                .skip(page_offset)
                .take(page_size)
                .filter_map(|k| map.get(*k).map(|v| ((*k).clone(), v.clone())))
                .collect();
            let shown = page.len();
            let note = format!("{total_bytes}B | keys {page_offset}..{} of {total}", page_offset + shown);
            format!(
                "[read_structured | {fmt} | {note}]\n{}",
                serde_json::to_string_pretty(&serde_json::Value::Object(page)).unwrap_or_default()
            )
        }
        serde_json::Value::Array(arr) => {
            let total = arr.len();
            if page_size == 0 || (page_offset == 0 && page_size >= total) {
                let note = format!("{total_bytes}B | complete");
                return format!(
                    "[read_structured | {fmt} | {note}]\n{}",
                    serde_json::to_string_pretty(val).unwrap_or_default()
                );
            }
            let page: Vec<_> = arr.iter().skip(page_offset).take(page_size).cloned().collect();
            let shown = page.len();
            let note = format!("{total_bytes}B | items {page_offset}..{} of {total}", page_offset + shown);
            format!(
                "[read_structured | {fmt} | {note}]\n{}",
                serde_json::to_string_pretty(&serde_json::Value::Array(page)).unwrap_or_default()
            )
        }
        _ => {
            let note = format!("{total_bytes}B | scalar");
            format!(
                "[read_structured | {fmt} | {note}]\n{}",
                serde_json::to_string_pretty(val).unwrap_or_default()
            )
        }
    }
}


// ── code-ops (host primitive backed by the generic LSP bridge) ───────────────
//
// Tractor owns the language-server subprocess lifecycle and exposes code
// navigation/refactor operations through the plugin host code-ops contract.

#[wasmtime::component::__internal::async_trait]
impl CodeOpsHost for TractorNativeBindings {
    async fn rename_symbol(
        &mut self,
        loc: SymbolLocation,
        new_name: String,
    ) -> Result<RenameResult, String> {
        crate::host::lsp_bridge::LspBridge::with_cmd(self.effect_policy.lsp_cmd())
            .rename_symbol(&loc, &new_name)
    }

    async fn find_references(
        &mut self,
        loc: SymbolLocation,
    ) -> Result<Vec<CodeReference>, String> {
        crate::host::lsp_bridge::LspBridge::with_cmd(self.effect_policy.lsp_cmd())
            .find_references(&loc)
    }

    async fn move_symbol(
        &mut self,
        loc: SymbolLocation,
        target_file: String,
    ) -> Result<RenameResult, String> {
        crate::host::lsp_bridge::LspBridge::with_cmd(self.effect_policy.lsp_cmd())
            .move_symbol(&loc, &target_file)
    }
}

// NOTE: the sibling `include!`d file (`policy_and_fs.rs`) already declares
// `#[cfg(test)] mod tests` for this same (flattened) module, so a second module
// named `tests` here would collide (E0428). These pure-helper tests live in a
// distinctly-named module. `super::*` resolves to the flattened `host_effects_bridge`
// module, which contains every private helper below (core.rs + policy_and_fs.rs).
#[cfg(test)]
mod core_pure_tests {
    use super::*;
    use std::collections::HashSet;

    // ── contains_control_chars ───────────────────────────────────────────────

    #[test]
    fn contains_control_chars_false_for_plain_ascii() {
        assert!(!contains_control_chars("plain-text_123"));
    }

    #[test]
    fn contains_control_chars_false_for_empty_string() {
        assert!(!contains_control_chars(""));
    }

    #[test]
    fn contains_control_chars_false_for_non_ascii_letters() {
        // Accented letters are not control characters.
        assert!(!contains_control_chars("café"));
    }

    #[test]
    fn contains_control_chars_true_for_newline() {
        assert!(contains_control_chars("a\nb"));
    }

    #[test]
    fn contains_control_chars_true_for_tab() {
        assert!(contains_control_chars("a\tb"));
    }

    #[test]
    fn contains_control_chars_true_for_null_byte() {
        assert!(contains_control_chars("a\u{0}b"));
    }

    // ── contains_whitespace ──────────────────────────────────────────────────

    #[test]
    fn contains_whitespace_false_for_no_spaces() {
        assert!(!contains_whitespace("no_whitespace_here"));
    }

    #[test]
    fn contains_whitespace_false_for_empty_string() {
        assert!(!contains_whitespace(""));
    }

    #[test]
    fn contains_whitespace_true_for_space() {
        assert!(contains_whitespace("a b"));
    }

    #[test]
    fn contains_whitespace_true_for_tab() {
        assert!(contains_whitespace("a\tb"));
    }

    #[test]
    fn contains_whitespace_true_for_newline() {
        assert!(contains_whitespace("a\nb"));
    }

    // ── is_safe_spawn_env_key ────────────────────────────────────────────────

    #[test]
    fn is_safe_spawn_env_key_rejects_empty() {
        assert!(!is_safe_spawn_env_key(""));
    }

    #[test]
    fn is_safe_spawn_env_key_rejects_overlong_key() {
        // MAX_SPAWN_ENV_KEY_LEN is 128; 129 chars must be rejected.
        let key = "A".repeat(MAX_SPAWN_ENV_KEY_LEN + 1);
        assert!(!is_safe_spawn_env_key(&key));
    }

    #[test]
    fn is_safe_spawn_env_key_accepts_max_length_key() {
        // Exactly at the cap (128 chars) starting with a letter is still valid.
        let key = "A".repeat(MAX_SPAWN_ENV_KEY_LEN);
        assert!(is_safe_spawn_env_key(&key));
    }

    #[test]
    fn is_safe_spawn_env_key_rejects_control_char() {
        assert!(!is_safe_spawn_env_key("KEY\u{1}"));
    }

    #[test]
    fn is_safe_spawn_env_key_rejects_whitespace() {
        assert!(!is_safe_spawn_env_key("KEY VAR"));
    }

    #[test]
    fn is_safe_spawn_env_key_rejects_leading_digit() {
        assert!(!is_safe_spawn_env_key("1KEY"));
    }

    #[test]
    fn is_safe_spawn_env_key_rejects_hyphen() {
        // Only ascii alphanumeric and underscore are allowed after the first char.
        assert!(!is_safe_spawn_env_key("MY-KEY"));
    }

    #[test]
    fn is_safe_spawn_env_key_rejects_dot() {
        assert!(!is_safe_spawn_env_key("MY.KEY"));
    }

    #[test]
    fn is_safe_spawn_env_key_accepts_leading_underscore() {
        assert!(is_safe_spawn_env_key("_PRIVATE"));
    }

    #[test]
    fn is_safe_spawn_env_key_accepts_alphanumeric_and_underscore() {
        assert!(is_safe_spawn_env_key("PATH_VAR_2"));
    }

    // ── is_blocked_spawn_env_key (delegates to sensitive_aliases policy) ──────

    #[test]
    fn is_blocked_spawn_env_key_blocks_path() {
        assert!(is_blocked_spawn_env_key("PATH"));
    }

    #[test]
    fn is_blocked_spawn_env_key_blocks_ld_prefix() {
        assert!(is_blocked_spawn_env_key("LD_PRELOAD"));
    }

    #[test]
    fn is_blocked_spawn_env_key_blocks_dyld_prefix() {
        assert!(is_blocked_spawn_env_key("DYLD_INSERT_LIBRARIES"));
    }

    #[test]
    fn is_blocked_spawn_env_key_allows_benign_single_token() {
        // "GREETING" has no `_` boundary and is not an exact-match sensitive key,
        // so no prefix/suffix/segment/namespace rule can fire.
        assert!(!is_blocked_spawn_env_key("GREETING"));
    }

    // ── host_detect_format ───────────────────────────────────────────────────

    #[test]
    fn host_detect_format_toml_extension() {
        assert_eq!(host_detect_format("config.toml"), "toml");
    }

    #[test]
    fn host_detect_format_yaml_extension() {
        assert_eq!(host_detect_format("config.yaml"), "yaml");
    }

    #[test]
    fn host_detect_format_yml_extension() {
        assert_eq!(host_detect_format("config.yml"), "yaml");
    }

    #[test]
    fn host_detect_format_json_extension() {
        assert_eq!(host_detect_format("config.json"), "json");
    }

    #[test]
    fn host_detect_format_defaults_to_json_for_unknown_extension() {
        assert_eq!(host_detect_format("notes.txt"), "json");
    }

    #[test]
    fn host_detect_format_defaults_to_json_without_extension() {
        assert_eq!(host_detect_format("Makefile"), "json");
    }

    // ── host_validate_structured ─────────────────────────────────────────────

    #[test]
    fn host_validate_structured_json_ok() {
        assert!(host_validate_structured("{\"a\": 1}", "json").is_ok());
    }

    #[test]
    fn host_validate_structured_json_err() {
        let err = host_validate_structured("{ not json", "json").unwrap_err();
        assert!(err.contains("JSON parse error"), "unexpected: {err}");
    }

    #[test]
    fn host_validate_structured_toml_ok() {
        assert!(host_validate_structured("key = \"value\"", "toml").is_ok());
    }

    #[test]
    fn host_validate_structured_toml_err() {
        let err = host_validate_structured("= = =", "toml").unwrap_err();
        assert!(err.contains("TOML parse error"), "unexpected: {err}");
    }

    #[test]
    fn host_validate_structured_yaml_ok() {
        assert!(host_validate_structured("key: value", "yaml").is_ok());
    }

    #[test]
    fn host_validate_structured_yaml_err() {
        // Unterminated flow sequence — invalid YAML.
        let err = host_validate_structured("[unclosed", "yaml").unwrap_err();
        assert!(err.contains("YAML parse error"), "unexpected: {err}");
    }

    #[test]
    fn host_validate_structured_unsupported_format() {
        let err = host_validate_structured("<x/>", "xml").unwrap_err();
        assert_eq!(err, "unsupported format: xml");
    }

    // ── host_read_structured_parse ───────────────────────────────────────────

    #[test]
    fn host_read_structured_parse_json_valid() {
        let out = host_read_structured_parse(br#"{"name":"x"}"#, "json", 0, 0);
        assert!(out.starts_with("[read_structured | json |"), "unexpected: {out}");
        assert!(out.contains("complete]"), "unexpected: {out}");
        assert!(out.contains("\"name\""), "unexpected: {out}");
    }

    #[test]
    fn host_read_structured_parse_json_invalid_utf8() {
        let out = host_read_structured_parse(&[0xff, 0xfe], "json", 0, 0);
        assert_eq!(out, "[read_structured | json | invalid UTF-8]");
    }

    #[test]
    fn host_read_structured_parse_json_parse_error() {
        let out = host_read_structured_parse(b"{ not json", "json", 0, 0);
        assert_eq!(out, "[read_structured | json | parse error]");
    }

    #[test]
    fn host_read_structured_parse_toml_valid() {
        let out = host_read_structured_parse(b"name = \"x\"\n", "toml", 0, 0);
        assert!(out.starts_with("[read_structured | toml |"), "unexpected: {out}");
        assert!(out.contains("complete]"), "unexpected: {out}");
        assert!(out.contains("\"name\""), "unexpected: {out}");
    }

    #[test]
    fn host_read_structured_parse_toml_invalid_utf8() {
        let out = host_read_structured_parse(&[0xff, 0xfe], "toml", 0, 0);
        assert_eq!(out, "[read_structured | toml | invalid UTF-8]");
    }

    #[test]
    fn host_read_structured_parse_toml_parse_error() {
        let out = host_read_structured_parse(b"= = =", "toml", 0, 0);
        assert_eq!(out, "[read_structured | toml | parse error]");
    }

    #[test]
    fn host_read_structured_parse_yaml_valid() {
        let out = host_read_structured_parse(b"name: x\n", "yaml", 0, 0);
        assert!(out.starts_with("[read_structured | yaml |"), "unexpected: {out}");
        assert!(out.contains("complete]"), "unexpected: {out}");
        assert!(out.contains("\"name\""), "unexpected: {out}");
    }

    #[test]
    fn host_read_structured_parse_yaml_invalid_utf8() {
        let out = host_read_structured_parse(&[0xff, 0xfe], "yaml", 0, 0);
        assert_eq!(out, "[read_structured | yaml | invalid UTF-8]");
    }

    #[test]
    fn host_read_structured_parse_yaml_parse_error() {
        let out = host_read_structured_parse(b"[unclosed", "yaml", 0, 0);
        assert_eq!(out, "[read_structured | yaml | parse error]");
    }

    #[test]
    fn host_read_structured_parse_unknown_format() {
        let out = host_read_structured_parse(b"anything", "xml", 0, 0);
        assert_eq!(out, "[read_structured | unknown format: xml]");
    }

    // ── host_page_json ───────────────────────────────────────────────────────

    #[test]
    fn host_page_json_object_complete_when_page_size_zero() {
        let val = serde_json::json!({"a": 1, "b": 2});
        let out = host_page_json(&val, 10, "json", 0, 0);
        assert!(out.starts_with("[read_structured | json | 10B | complete]"), "unexpected: {out}");
        assert!(out.contains("\"a\""), "unexpected: {out}");
        assert!(out.contains("\"b\""), "unexpected: {out}");
    }

    #[test]
    fn host_page_json_object_paged_subset() {
        let val = serde_json::json!({"a": 1, "b": 2, "c": 3});
        let out = host_page_json(&val, 9, "json", 2, 0);
        assert!(out.contains("keys 0..2 of 3"), "unexpected: {out}");
        assert!(out.contains("\"a\""), "unexpected: {out}");
        assert!(out.contains("\"b\""), "unexpected: {out}");
        assert!(!out.contains("\"c\""), "third key should be beyond the page: {out}");
    }

    #[test]
    fn host_page_json_array_complete_when_page_covers_all() {
        let val = serde_json::json!([1, 2]);
        // page_size >= total at offset 0 => complete branch.
        let out = host_page_json(&val, 5, "json", 5, 0);
        assert!(out.starts_with("[read_structured | json | 5B | complete]"), "unexpected: {out}");
    }

    #[test]
    fn host_page_json_array_paged_subset_with_offset() {
        let val = serde_json::json!([10, 20, 30, 40]);
        let out = host_page_json(&val, 12, "json", 2, 1);
        assert!(out.contains("items 1..3 of 4"), "unexpected: {out}");
        assert!(out.contains("20"), "unexpected: {out}");
        assert!(out.contains("30"), "unexpected: {out}");
        assert!(!out.contains("40"), "last item should be beyond the page: {out}");
    }

    #[test]
    fn host_page_json_scalar_branch() {
        let val = serde_json::json!(42);
        let out = host_page_json(&val, 2, "json", 0, 0);
        assert_eq!(out, "[read_structured | json | 2B | scalar]\n42");
    }

    // ── enforce_trusted_plugin_for_shell_with ────────────────────────────────

    #[test]
    fn trusted_plugin_none_allowlist_is_permissive() {
        assert!(enforce_trusted_plugin_for_shell_with("any.plugin", None).is_ok());
    }

    #[test]
    fn trusted_plugin_empty_id_is_blocked() {
        let allowed: HashSet<String> = HashSet::from(["myplugin".to_string()]);
        // A whitespace-only id trims to empty.
        let err = enforce_trusted_plugin_for_shell_with("   ", Some(&allowed)).unwrap_err();
        assert_eq!(err, "[blocked: plugin id is empty]");
    }

    #[test]
    fn trusted_plugin_control_chars_are_blocked() {
        let allowed: HashSet<String> = HashSet::from(["*".to_string()]);
        let err = enforce_trusted_plugin_for_shell_with("bad\u{1}id", Some(&allowed)).unwrap_err();
        assert_eq!(err, "[blocked: plugin id contains control characters]");
    }

    #[test]
    fn trusted_plugin_invalid_token_is_blocked() {
        let allowed: HashSet<String> = HashSet::from(["*".to_string()]);
        // '@' is not an allowed plugin-id character.
        let err = enforce_trusted_plugin_for_shell_with("bad@id", Some(&allowed)).unwrap_err();
        assert_eq!(err, "[blocked: plugin id has invalid characters]");
    }

    #[test]
    fn trusted_plugin_wildcard_allows_any_id() {
        let allowed: HashSet<String> = HashSet::from(["*".to_string()]);
        assert!(enforce_trusted_plugin_for_shell_with("some.plugin-id", Some(&allowed)).is_ok());
    }

    #[test]
    fn trusted_plugin_exact_match_is_allowed() {
        let allowed: HashSet<String> = HashSet::from(["myplugin".to_string()]);
        assert!(enforce_trusted_plugin_for_shell_with("myplugin", Some(&allowed)).is_ok());
    }

    #[test]
    fn trusted_plugin_match_is_case_insensitive() {
        let allowed: HashSet<String> = HashSet::from(["myplugin".to_string()]);
        // The id is normalized to ascii-lowercase before the allowlist lookup.
        assert!(enforce_trusted_plugin_for_shell_with("MyPlugin", Some(&allowed)).is_ok());
    }

    #[test]
    fn trusted_plugin_not_in_allowlist_is_denied() {
        let allowed: HashSet<String> = HashSet::from(["other".to_string()]);
        let err = enforce_trusted_plugin_for_shell_with("myplugin", Some(&allowed)).unwrap_err();
        assert_eq!(err, "[blocked: plugin 'myplugin' not allowed to use host-shell]");
    }
}
