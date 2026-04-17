wit_bindgen::generate!({
    world: "agent-tools-provider",
    path: "wit",
});

use exports::refarm::agent_tools::agent_fs::Guest as AgentFsGuest;
use exports::refarm::agent_tools::agent_shell::{Guest as AgentShellGuest, SpawnRequest, SpawnResult};
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

// ── Helpers ───────────────────────────────────────────────────────────────────

fn atomic_write(path: &str, content: &[u8]) -> Result<(), String> {
    // Write to a sibling .tmp file then rename — both ops on the same
    // filesystem, so the rename is atomic and a reader never sees a torn file.
    let tmp = format!("{path}.tmp");
    std::fs::write(&tmp, content).map_err(|e| format!("write/tmp({path}): {e}"))?;
    std::fs::rename(&tmp, path).map_err(|e| format!("write/rename({path}): {e}"))
}

export!(AgentTools);
