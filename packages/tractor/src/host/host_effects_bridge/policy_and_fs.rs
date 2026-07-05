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
        if value.trim() != value {
            return Err("spawn: env value contains surrounding whitespace".to_string());
        }
        if !value.is_ascii() {
            return Err("spawn: env value must be ascii".to_string());
        }
        if contains_control_chars(value) {
            return Err("spawn: env value contains control characters".to_string());
        }
        if value.chars().any(|c| c.is_whitespace()) {
            return Err("spawn: env value must not contain whitespace".to_string());
        }
        let next_total = total_bytes.saturating_add(key.len() + value.len());
        if next_total > MAX_SPAWN_ENV_TOTAL_BYTES {
            return Err("spawn: env payload exceeds max total bytes".to_string());
        }
        total_bytes = next_total;
    }
    Ok(())
}

fn enforce_spawn_cwd(cwd: &str, policy: &HostEffectPolicy) -> Result<(), String> {
    let fs_root = policy.fs_root()?;
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
    if !cwd.is_ascii() {
        return Err("spawn: cwd must be ascii".to_string());
    }
    if contains_control_chars(cwd) {
        return Err("spawn: cwd contains control characters".to_string());
    }
    if cwd.chars().any(|c| c.is_whitespace()) {
        return Err("spawn: cwd must not contain whitespace".to_string());
    }
    if let Some(root) = fs_root {
        if enforce_fs_root_with(cwd, Some(root)).is_err() {
            return Err("spawn: cwd outside MODEL_FS_ROOT".to_string());
        }
    }
    let metadata = std::fs::metadata(cwd)
        .map_err(|_| "spawn: cwd must be an existing directory".to_string())?;
    if !metadata.is_dir() {
        return Err("spawn: cwd must be a directory".to_string());
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
    ensure_trusted_plugins_config_path_matches_open_file(path, &file)?;
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

/// Effect-dispatch policy resolved ONCE at PluginHost boot, then read from &self
/// on the per-call hot path. Replaces the per-call std::env::var reads of
/// MODEL_SHELL_ALLOWLIST / MODEL_FS_ROOT (which mutate process-global env in
/// tests and leaked across threads under --test-threads>1, flaking the
/// effect-policy tests).
#[derive(Clone, Debug)]
pub(crate) struct HostEffectPolicy {
    /// Parsed MODEL_SHELL_ALLOWLIST. `None` = permissive (env unset) — the
    /// backward-compatible default; structural argv guards still apply.
    shell_allowlist: Option<std::collections::HashSet<String>>,
    /// Resolved MODEL_FS_ROOT, stored as the SAME Result configured_fs_root()
    /// returned so a bad value keeps failing at first-USE (cloned per call),
    /// never at construction. `Ok(None)` = env unset = no fs jail.
    fs_root: Result<Option<PathBuf>, String>,
    /// The LSP server command (REFACTOR_LSP_CMD / legacy fallback), resolved once
    /// at boot. Read per code-op (rename/find-references) instead of rebuilding
    /// LspBridge::from_env each time.
    lsp_cmd: String,
}

impl HostEffectPolicy {
    /// Boot-time resolver — the ONLY place MODEL_SHELL_ALLOWLIST / MODEL_FS_ROOT
    /// / REFACTOR_LSP_CMD are read from env.
    pub(crate) fn from_env() -> Self {
        Self {
            shell_allowlist: shell_allowlist_from_env(),
            fs_root: configured_fs_root(),
            lsp_cmd: crate::host::lsp_bridge::configured_lsp_command(),
        }
    }

    /// Explicit constructor (tests) — no env access.
    #[cfg(test)]
    pub(crate) fn new(
        shell_allowlist: Option<std::collections::HashSet<String>>,
        fs_root: Result<Option<PathBuf>, String>,
        lsp_cmd: String,
    ) -> Self {
        Self { shell_allowlist, fs_root, lsp_cmd }
    }

    fn shell_allowlist(&self) -> Option<&std::collections::HashSet<String>> {
        self.shell_allowlist.as_ref()
    }

    /// Clone the boot Result so a bad MODEL_FS_ROOT surfaces its error on THIS
    /// call — byte-identical to the old `configured_fs_root()?`.
    fn fs_root(&self) -> Result<Option<PathBuf>, String> {
        self.fs_root.clone()
    }

    pub(crate) fn lsp_cmd(&self) -> &str {
        &self.lsp_cmd
    }
}

impl Default for HostEffectPolicy {
    /// Permissive default (env-unset equivalent): no allowlist, no fs jail, and
    /// the default LSP command.
    fn default() -> Self {
        Self {
            shell_allowlist: None,
            fs_root: Ok(None),
            lsp_cmd: crate::host::lsp_bridge::DEFAULT_RUST_LSP_CMD.to_string(),
        }
    }
}

fn shell_allowlist_from_env() -> Option<std::collections::HashSet<String>> {
    let raw = std::env::var("MODEL_SHELL_ALLOWLIST").ok()?;
    Some(parse_shell_allowlist(&raw))
}

fn parse_shell_allowlist(raw: &str) -> std::collections::HashSet<String> {
    if raw.len() > MAX_SHELL_ALLOWLIST_RAW_LEN {
        return std::collections::HashSet::new();
    }

    let out: std::collections::HashSet<String> = raw
        .split(',')
        .take(MAX_SHELL_ALLOWLIST_SCAN)
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .filter(|s| s.is_ascii())
        .filter(|s| !contains_control_chars(s))
        .filter(|s| !contains_whitespace(s))
        .filter(|s| s.len() <= MAX_SHELL_TOKEN_LEN)
        .take(MAX_SHELL_ALLOWLIST_ENTRIES)
        .map(ToString::to_string)
        .collect();

    if out.contains("*") {
        return std::collections::HashSet::from(["*".to_string()]);
    }

    out
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
        if idx > 0 && !entry.is_ascii() {
            return Err("spawn: argv must be ascii".to_string());
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
    let Ok(raw) = std::env::var("MODEL_FS_ROOT") else {
        return Ok(None);
    };
    configured_fs_root_from_raw(&raw)
}

fn configured_fs_root_from_raw(raw: &str) -> Result<Option<PathBuf>, String> {
    if raw.len() > MAX_FS_PATH_LEN {
        return Err("[blocked: invalid MODEL_FS_ROOT: exceeds max length]".to_string());
    }
    if contains_control_chars(raw) {
        return Err("[blocked: invalid MODEL_FS_ROOT: contains control characters]".to_string());
    }
    if !raw.is_ascii() {
        return Err("[blocked: invalid MODEL_FS_ROOT: must be ascii]".to_string());
    }
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Ok(Some(PathBuf::new()));
    }
    if trimmed != raw {
        return Err("[blocked: invalid MODEL_FS_ROOT: surrounding whitespace not allowed]".to_string());
    }
    if raw.chars().any(|c| c.is_whitespace()) {
        return Err("[blocked: invalid MODEL_FS_ROOT: whitespace not allowed]".to_string());
    }
    let root = std::fs::canonicalize(trimmed)
        .map_err(|e| format!("[blocked: invalid MODEL_FS_ROOT '{trimmed}': {e}]"))?;
    if !root.is_dir() {
        return Err(format!(
            "[blocked: invalid MODEL_FS_ROOT '{trimmed}': must be a directory]"
        ));
    }
    Ok(Some(root))
}

fn enforce_fs_root(path: &str, policy: &HostEffectPolicy) -> Result<(), String> {
    let fs_root = policy.fs_root()?;
    enforce_fs_root_with(path, fs_root.as_deref())
}

fn enforce_fs_root_with(path: &str, fs_root: Option<&Path>) -> Result<(), String> {
    let Some(root) = fs_root else {
        return Ok(());
    };

    if root.as_os_str().is_empty() {
        return Err("[blocked: path outside MODEL_FS_ROOT]".into());
    }

    let resolved = resolve_for_fs_policy(path)?;
    if resolved.starts_with(root) {
        Ok(())
    } else {
        Err("[blocked: path outside MODEL_FS_ROOT]".into())
    }
}

fn resolve_for_fs_policy(path: &str) -> Result<PathBuf, String> {
    if path.is_empty() {
        return Err("[blocked: path must be non-empty]".to_string());
    }
    if path.trim() != path {
        return Err("[blocked: path contains surrounding whitespace]".to_string());
    }
    if !path.is_ascii() {
        return Err("[blocked: path must be ascii]".to_string());
    }
    if contains_control_chars(path) {
        return Err("[blocked: path contains control characters]".to_string());
    }
    if path.chars().any(|c| c.is_whitespace()) {
        return Err("[blocked: path must not contain whitespace]".to_string());
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
#[path = "../host_effects_bridge_tests.rs"]
mod tests;
