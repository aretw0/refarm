// The operator-declared spawn environment — P10
// (docs/superpowers/specs/2026-07-29-process-administration-layer-design.md).
//
// `spawn_process` (core.rs) runs every child with `.env_clear()`, and
// `is_spawn_sensitive_env_key` (sensitive_aliases/policy.rs) blocks a PLUGIN from
// setting `PATH`/`HOME`/… — the classic injection vectors: shadow a binary earlier
// in the search path, or point HOME somewhere the plugin controls. That is right.
// But it also leaves the child with NO `PATH` at all, and essentially every
// Node-ecosystem binary starts `#!/usr/bin/env node`, which needs `PATH` to find
// `node` — so `pnpm`, `vitest`, `tsc`, `npx` cannot run, even for a trusted plugin
// with `shell:spawn`, even by absolute path (the shebang resolution happens one
// level down, inside `env`).
//
// So: the OPERATOR declares the directories (`.refarm/config.json`'s `spawnEnv`),
// the HOST composes them into `PATH`/`HOME` and injects them, and the plugin still
// cannot choose them — same doctrine as `connections` (connection_decl.rs) and
// `commands` (workspace run's allowlist). A plugin passing `PATH`/`HOME` in its own
// env is still rejected by `enforce_spawn_env` above this in the call chain; the
// injected value wins only because the plugin never had a say.
//
// Filesystem-only, like `resolve_connections`: `spawnEnv` names directories on THIS
// machine, so a declaration replicated from another device over CRDT must never
// decide what a LOCAL spawn's PATH/HOME resolve to.

const MAX_SPAWN_ENV_PATH_ENTRIES: usize = 64;
// Mirrors MAX_SPAWN_ENV_VALUE_LEN (core.rs) — the same per-string cap already
// applied to a plugin-supplied env value, reused here for a directory entry.
const MAX_SPAWN_ENV_PATH_ENTRY_LEN: usize = MAX_SPAWN_ENV_VALUE_LEN;
const MAX_SPAWN_ENV_PATH_TOTAL_LEN: usize = 64 * 1024;

/// The operator's `spawnEnv` declaration, parsed and validated. `path` is kept in
/// DECLARED order — that order becomes the search order the host joins into
/// `PATH` (P10's second constraint: declared order IS search order), so shadowing
/// is visible in the operator's own config, never an emergent property of how
/// entries happened to be collected.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub(crate) struct SpawnEnvDecl {
    pub(crate) path: Vec<String>,
    pub(crate) home: Option<String>,
}

impl SpawnEnvDecl {
    /// The `(key, value)` pairs the host injects into a spawned child, composed
    /// ONLY from this declaration — never from the host's own ambient environment
    /// (P10's first constraint). An empty `path` is treated exactly like an absent
    /// `path`: no `PATH` key at all, not an empty-string `PATH` (which some shells
    /// read as "search only the current directory" — a foot-gun this never
    /// introduces). Undeclared therefore means absent, never inherited (P10's
    /// fourth constraint) — this is the ONLY place that guarantee can be lost, so
    /// it stays a pure function of `self`, nothing else.
    pub(crate) fn injected_vars(&self) -> Vec<(String, String)> {
        let mut out = Vec::with_capacity(2);
        if !self.path.is_empty() {
            out.push(("PATH".to_string(), self.path.join(":")));
        }
        if let Some(home) = &self.home {
            out.push(("HOME".to_string(), home.clone()));
        }
        out
    }
}

/// Parse the `spawnEnv` block out of an already-loaded `.refarm/config.json`
/// value. Absent block (or `null`) → `SpawnEnvDecl::default()` — undeclared means
/// absent, never the host's ambient PATH/HOME. A present-but-malformed block fails
/// shut and NAMES the field: a relative entry, a non-string entry, or an oversized
/// list must never silently narrow to "whatever parsed", which would quietly
/// change which directories are searched — a shadowing surface the operator
/// cannot see in their own config.
fn parse_spawn_env(cfg: &serde_json::Value) -> Result<SpawnEnvDecl, String> {
    let raw = match cfg.get("spawnEnv") {
        None => return Ok(SpawnEnvDecl::default()),
        Some(serde_json::Value::Null) => return Ok(SpawnEnvDecl::default()),
        Some(v) => v,
    };
    let obj = raw
        .as_object()
        .ok_or_else(|| "[blocked: .refarm/config.json spawnEnv must be an object]".to_string())?;

    let path = match obj.get("path") {
        None | Some(serde_json::Value::Null) => Vec::new(),
        Some(v) => parse_spawn_env_path(v)?,
    };

    let home = match obj.get("home") {
        None | Some(serde_json::Value::Null) => None,
        Some(serde_json::Value::String(s)) => {
            validate_spawn_env_absolute_entry(s, "home")?;
            Some(s.clone())
        }
        Some(_) => {
            return Err("[blocked: .refarm/config.json spawnEnv.home must be a string]".to_string())
        }
    };

    Ok(SpawnEnvDecl { path, home })
}

fn parse_spawn_env_path(value: &serde_json::Value) -> Result<Vec<String>, String> {
    let arr = value.as_array().ok_or_else(|| {
        "[blocked: .refarm/config.json spawnEnv.path must be an array of strings]".to_string()
    })?;
    if arr.len() > MAX_SPAWN_ENV_PATH_ENTRIES {
        return Err(format!(
            "[blocked: .refarm/config.json spawnEnv.path exceeds max entries ({MAX_SPAWN_ENV_PATH_ENTRIES})]"
        ));
    }
    let mut out = Vec::with_capacity(arr.len());
    let mut total_len = 0usize;
    for (i, item) in arr.iter().enumerate() {
        let field = format!("path[{i}]");
        // A non-string entry must not be dropped — that would silently search
        // FEWER directories than declared, the same "never silently rewrite the
        // declaration" rule connection_decl.rs's `string_array` already enforces.
        let entry = item.as_str().ok_or_else(|| {
            format!("[blocked: .refarm/config.json spawnEnv.{field} must be a string]")
        })?;
        validate_spawn_env_absolute_entry(entry, &field)?;
        total_len = total_len.saturating_add(entry.len());
        if total_len > MAX_SPAWN_ENV_PATH_TOTAL_LEN {
            return Err(format!(
                "[blocked: .refarm/config.json spawnEnv.path exceeds max total length ({MAX_SPAWN_ENV_PATH_TOTAL_LEN})]"
            ));
        }
        out.push(entry.to_string());
    }
    Ok(out)
}

/// Shared shape check for `spawnEnv.path[i]` and `spawnEnv.home`: must be an
/// ABSOLUTE path (never relative — a relative entry would resolve against
/// whatever the CHILD's cwd happens to be at spawn time, not what the operator
/// wrote down), under the per-entry length cap, and free of NUL/control
/// characters.
fn validate_spawn_env_absolute_entry(entry: &str, field: &str) -> Result<(), String> {
    if entry.len() > MAX_SPAWN_ENV_PATH_ENTRY_LEN {
        return Err(format!("[blocked: .refarm/config.json spawnEnv.{field} exceeds max length]"));
    }
    if contains_control_chars(entry) {
        return Err(format!(
            "[blocked: .refarm/config.json spawnEnv.{field} contains control characters]"
        ));
    }
    if !Path::new(entry).is_absolute() {
        return Err(format!("[blocked: .refarm/config.json spawnEnv.{field} must be an absolute path]"));
    }
    Ok(())
}

/// Resolve the operator's `spawnEnv` from `.refarm/config.json` under `base`.
/// Filesystem-only (see the file header for why). Absent file ⇒
/// `SpawnEnvDecl::default()` — the same fail-open-to-absent posture
/// `resolve_connections` uses for a missing file; malformed file ⇒ error,
/// matching the hardened reader's (`read_refarm_config_value_at`) fail-shut
/// posture on a corrupt one.
pub(crate) fn spawn_env_from_config_at(base: &Path) -> Result<SpawnEnvDecl, String> {
    match read_refarm_config_value_at(base)? {
        Some(cfg) => parse_spawn_env(&cfg),
        None => Ok(SpawnEnvDecl::default()),
    }
}

/// Boot-time entry point, called once from `HostEffectPolicy::from_env` — resolves
/// against the base the node was DECLARED with, the SAME base the production
/// `connections_catalog()` wiring uses. Resolved ONCE at host boot and cloned into
/// every plugin's bindings (see `HostEffectPolicy`), so a spawn never re-reads config
/// from disk.
pub(crate) fn spawn_env_from_declared_base() -> Result<SpawnEnvDecl, String> {
    spawn_env_from_config_at(&crate::host::plugin_host::config_node::declared_base())
}
