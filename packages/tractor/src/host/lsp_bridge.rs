use std::process::{Child, Command, Stdio};
use std::sync::{Mutex, MutexGuard, OnceLock};

use crate::host::plugin_host::refarm::plugin::code_ops::{
    CodeReference, RenameResult, SymbolLocation,
};

const DEFAULT_RUST_ANALYZER_CMD: &str = "rust-analyzer";
const RUST_ANALYZER_CMD_ENV: &str = "REFACTOR_LSP_RUST_ANALYZER_CMD";

static RUST_ANALYZER_SESSION: OnceLock<Mutex<Option<LspServerProcess>>> = OnceLock::new();

pub(crate) struct LspBridge {
    rust_analyzer_cmd: String,
}

/// Owns one LSP server subprocess.
///
/// Lifecycle contract:
/// - `start` creates the child with piped stdin/stdout so a future JSON-RPC
///   layer can speak LSP without changing process ownership.
/// - callers store it behind a process-wide mutex and reuse it across code-op
///   calls instead of spawning one language server per request.
/// - `stop` is idempotent and is also called from `Drop`, so a partially
///   initialized bridge cannot leak a long-lived rust-analyzer process.
struct LspServerProcess {
    child: Child,
}

impl LspServerProcess {
    fn start(program: &str, args: &[&str]) -> Result<Self, String> {
        let child = Command::new(program)
            .args(args)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|e| format!("lsp start({program}): {e}"))?;

        Ok(Self { child })
    }

    fn id(&self) -> u32 {
        self.child.id()
    }

    fn is_running(&mut self) -> bool {
        matches!(self.child.try_wait(), Ok(None))
    }

    fn stop(&mut self) {
        if self.is_running() {
            let _ = self.child.kill();
        }
        let _ = self.child.wait();
    }
}

impl Drop for LspServerProcess {
    fn drop(&mut self) {
        self.stop();
    }
}

impl LspBridge {
    pub(crate) fn from_env() -> Self {
        let rust_analyzer_cmd = std::env::var(RUST_ANALYZER_CMD_ENV)
            .ok()
            .map(|v| v.trim().to_string())
            .filter(|v| !v.is_empty())
            .unwrap_or_else(|| DEFAULT_RUST_ANALYZER_CMD.to_string());

        Self { rust_analyzer_cmd }
    }

    pub(crate) fn rename_symbol(
        &self,
        _loc: &SymbolLocation,
        _new_name: &str,
    ) -> Result<RenameResult, String> {
        Err(self.not_connected_message("rename"))
    }

    pub(crate) fn find_references(
        &self,
        _loc: &SymbolLocation,
    ) -> Result<Vec<CodeReference>, String> {
        Err(self.not_connected_message("find-references"))
    }

    fn not_connected_message(&self, op: &str) -> String {
        if command_looks_resolvable(&self.rust_analyzer_cmd) {
            format!("lsp not connected — rust-analyzer configured but session not started ({op})")
        } else {
            format!(
                "lsp not connected — configured rust-analyzer command not found: {}",
                self.rust_analyzer_cmd
            )
        }
    }

    fn session_slot() -> &'static Mutex<Option<LspServerProcess>> {
        RUST_ANALYZER_SESSION.get_or_init(|| Mutex::new(None))
    }

    fn lock_session() -> Result<MutexGuard<'static, Option<LspServerProcess>>, String> {
        Self::session_slot()
            .lock()
            .map_err(|_| "lsp session lock poisoned".to_string())
    }

    #[allow(dead_code)]
    fn ensure_rust_analyzer_session(&self) -> Result<u32, String> {
        let mut slot = Self::lock_session()?;
        if let Some(session) = slot.as_mut() {
            if session.is_running() {
                return Ok(session.id());
            }
            session.stop();
            *slot = None;
        }

        let session = LspServerProcess::start(&self.rust_analyzer_cmd, &[])?;
        let pid = session.id();
        *slot = Some(session);
        Ok(pid)
    }

    #[allow(dead_code)]
    fn stop_rust_analyzer_session() -> Result<(), String> {
        let mut slot = Self::lock_session()?;
        if let Some(mut session) = slot.take() {
            session.stop();
        }
        Ok(())
    }
}

fn command_looks_resolvable(cmd: &str) -> bool {
    if cmd.contains(std::path::MAIN_SEPARATOR) {
        return std::path::Path::new(cmd).is_file();
    }

    std::env::var_os("PATH")
        .map(|paths| {
            std::env::split_paths(&paths)
                .map(|p| p.join(cmd))
                .any(|candidate| candidate.is_file())
        })
        .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Mutex, OnceLock};

    fn env_lock() -> std::sync::MutexGuard<'static, ()> {
        static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
        LOCK.get_or_init(|| Mutex::new(())).lock().unwrap()
    }

    #[test]
    fn bridge_defaults_command() {
        let _guard = env_lock();
        std::env::remove_var(RUST_ANALYZER_CMD_ENV);
        let bridge = LspBridge::from_env();
        assert_eq!(bridge.rust_analyzer_cmd, "rust-analyzer");
    }

    #[test]
    fn bridge_honors_env_override() {
        let _guard = env_lock();
        std::env::set_var(RUST_ANALYZER_CMD_ENV, "custom-ra");
        let bridge = LspBridge::from_env();
        std::env::remove_var(RUST_ANALYZER_CMD_ENV);
        assert_eq!(bridge.rust_analyzer_cmd, "custom-ra");
    }

    #[test]
    fn lsp_process_stop_is_idempotent() {
        let mut process = LspServerProcess::start("sleep", &["10"]).expect("sleep starts");
        assert!(process.is_running());
        process.stop();
        process.stop();
        assert!(!process.is_running());
    }

    #[test]
    fn bridge_reuses_running_session() {
        let _guard = env_lock();
        std::env::set_var(RUST_ANALYZER_CMD_ENV, "sleep");
        let bridge = LspBridge::from_env();
        std::env::remove_var(RUST_ANALYZER_CMD_ENV);

        // Use the lower-level constructor with an argument for this unit test;
        // production rust-analyzer startup still uses the env-provided binary.
        let mut slot = LspBridge::lock_session().unwrap();
        *slot = Some(LspServerProcess::start("sleep", &["10"]).unwrap());
        let first_pid = slot.as_ref().unwrap().id();
        drop(slot);

        assert_eq!(bridge.ensure_rust_analyzer_session().unwrap(), first_pid);
        LspBridge::stop_rust_analyzer_session().unwrap();
    }
}
