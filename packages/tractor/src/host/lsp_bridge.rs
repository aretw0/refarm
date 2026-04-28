use crate::host::plugin_host::refarm::plugin::code_ops::{
    CodeReference, RenameResult, SymbolLocation,
};

const DEFAULT_RUST_ANALYZER_CMD: &str = "rust-analyzer";
const RUST_ANALYZER_CMD_ENV: &str = "REFACTOR_LSP_RUST_ANALYZER_CMD";

pub(crate) struct LspBridge {
    rust_analyzer_cmd: String,
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
}
