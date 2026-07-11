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

/// Read + parse the sovereign `.refarm/config.json` under `base` ONCE (hardened: size
/// cap, symlink/regular-file check, dev+ino TOCTOU guard). Returns None when the file is
/// absent. Both the trusted-plugins allowlist and the approved-permissions map ride this
/// one hardened read so neither re-implements the fs safety.
fn read_refarm_config_value_at(base: &Path) -> Result<Option<serde_json::Value>, String> {
    // The config dir is injected (SOVEREIGN_CONFIG_DIR); no selector → no sovereign
    // config path → behave as if the file is absent (never a brand-dir fallback).
    let Some(path) = crate::host::plugin_host::config_node::sovereign_config_path(base) else {
        return Ok(None);
    };
    let Some(bytes) = read_trusted_plugins_config_bytes(&path)? else {
        return Ok(None);
    };
    let cfg = serde_json::from_slice::<serde_json::Value>(&bytes)
        .map_err(|e| format!("[blocked: invalid sovereign config.json: {e}]"))?;
    Ok(Some(cfg))
}

/// Read the sovereign config from BOTH sources: the local fs file (hardened, the
/// stronger posture — fail-shut on malformed) AND the replicated device-global graph
/// node (`urn:sovereign:config:workspace`), so a device that received its config purely
/// over CRDT still resolves its grants instead of falling to a permissive default.
///
/// This is the security-axis counterpart to `resolve_sovereign_config` (which reads
/// MODEL fields fs-FIRST). Here we return BOTH values un-merged so the caller can apply
/// the more-restrictive-of-{fs, node} merge (deny dominates) — NOT fs-first, which would
/// let a stale wide local file beat a converged narrow (revoked) node.
///
/// The fs error propagates (`?`) — a malformed local file fails shut, never silently
/// permissive. Node absence (no sync, no node, null data) → node = None.
fn refarm_config_values_two_source(
    base: &Path,
    sync: Option<&crate::sync::NativeSync>,
) -> Result<(Option<serde_json::Value>, Option<serde_json::Value>), String> {
    let fs_value = read_refarm_config_value_at(base)?;
    let node_value = sync.and_then(config_value_from_node);
    Ok((fs_value, node_value))
}

/// Extract the sovereign config `data` from the replicated config node, mirroring the
/// node half of `resolve_sovereign_config` (env_and_runtime.rs): get_node → parse →
/// `node["data"]`, guarding a null payload. Returns None on any absence/parse failure —
/// a missing node is simply "no node signal", never an error (the fs side owns fail-shut).
fn config_value_from_node(sync: &crate::sync::NativeSync) -> Option<serde_json::Value> {
    let payload = sync
        .get_node(crate::host::plugin_host::config_node::CONFIG_NODE_DEFAULT_ID)
        .ok()??;
    let node: serde_json::Value = serde_json::from_str(&payload).ok()?;
    let data = node.get("data")?;
    if data.is_null() {
        return None;
    }
    Some(data.clone())
}

/// Resolve the trusted-plugins allowlist from fs ∩ node (deny dominates): a plugin is
/// trusted iff BOTH configured sources agree. See `merge_trusted_deny_dominates` for the
/// absent-on-one-side reconciliation (`None` = "no opinion" = identity, NOT deny-all).
pub(crate) fn resolve_trusted_plugins(
    base: &Path,
    sync: Option<&crate::sync::NativeSync>,
) -> Result<Option<std::collections::HashSet<String>>, String> {
    let (fs_value, node_value) = refarm_config_values_two_source(base, sync)?;
    let fs = fs_value.as_ref().map(parse_trusted_plugins).transpose()?.flatten();
    let node = node_value.as_ref().map(parse_trusted_plugins).transpose()?.flatten();
    // G's revocation subtraction for trust happens at the load gate (`trusted_to_load`),
    // not here — a `{*}` wildcard can't be subtracted from as a finite set, so the gate
    // takes the revoked set and denies a revoked id even under `*`. This resolver stays
    // the pure fs ∩ node merge (B); the revoked set is resolved separately at load.
    Ok(merge_trusted_deny_dominates(fs, node))
}

/// Collect the revocation tombstones for THIS load (G). Returned separately from the
/// trust/approved resolution so the load gate can apply them — for trust, denying a
/// revoked id even under a `*` wildcard; for approved, subtracting revoked caps.
pub(crate) fn resolve_revocations(
    sync: Option<&crate::sync::NativeSync>,
) -> crate::host::plugin_host::revocation_node::Tombstones {
    sync.map(crate::host::plugin_host::revocation_node::collect_tombstones)
        .unwrap_or_default()
}

/// Resolve the approved-permissions map from fs ∩ node (deny dominates per capability).
/// See `merge_approved_deny_dominates` for the two-dimension reconciliation.
pub(crate) fn resolve_approved_permissions(
    base: &Path,
    sync: Option<&crate::sync::NativeSync>,
) -> Result<Option<std::collections::HashMap<String, std::collections::HashSet<String>>>, String> {
    let (fs_value, node_value) = refarm_config_values_two_source(base, sync)?;
    let fs = fs_value.as_ref().map(parse_approved_permissions).transpose()?.flatten();
    let node = node_value.as_ref().map(parse_approved_permissions).transpose()?.flatten();
    let merged = merge_approved_deny_dominates(fs, node);
    // G: subtract revoked caps + whole-plugin revocations after B's merge (approved has
    // no wildcard, so the subtraction is a clean final step here).
    let ts = resolve_revocations(sync);
    Ok(subtract_revoked_approved(merged, &ts.plugins, &ts.capabilities))
}

/// More-restrictive-of-{fs, node} for the trust allowlist.
///
/// | fs        | node      | merge          | rationale                                   |
/// |-----------|-----------|----------------|---------------------------------------------|
/// | None      | None      | None           | no policy anywhere → permissive (compat)    |
/// | Some(S)   | None      | Some(S)        | fresh device / no node yet → fs is signal   |
/// | None      | Some(S)   | Some(S)        | config only over CRDT → node is signal      |
/// | Some(F)   | Some(N)   | Some(F ∩ N)    | both configured → intersection              |
///
/// `None` is the IDENTITY of the intersection ("no opinion"), NOT the empty set — an ∅
/// merge would deny-all a device that simply has no node yet. `*` (wildcard = the
/// universe) doesn't constrain: `{*} ∩ N = N`; `{*} ∩ {*} = {*}`.
fn merge_trusted_deny_dominates(
    fs: Option<std::collections::HashSet<String>>,
    node: Option<std::collections::HashSet<String>>,
) -> Option<std::collections::HashSet<String>> {
    match (fs, node) {
        (None, None) => None,
        (Some(s), None) | (None, Some(s)) => Some(s),
        (Some(f), Some(n)) => Some(intersect_trusted(f, n)),
    }
}

/// Intersect two trust sets, treating `*` (wildcard) as the universe on either side.
fn intersect_trusted(
    f: std::collections::HashSet<String>,
    n: std::collections::HashSet<String>,
) -> std::collections::HashSet<String> {
    let f_all = f.contains("*");
    let n_all = n.contains("*");
    match (f_all, n_all) {
        (true, true) => std::iter::once("*".to_string()).collect(),
        (true, false) => n,
        (false, true) => f,
        (false, false) => f.intersection(&n).cloned().collect(),
    }
}

/// More-restrictive-of-{fs, node} for the approved-permissions map, in two dimensions:
///
/// - WITHIN a plugin present on BOTH sides → caps = fs-caps ∩ node-caps (a capability
///   survives iff both approve — deny dominates).
/// - ACROSS the presence dimension (which plugins have an entry) → a plugin in only ONE
///   side keeps that side's set AS-IS (identity, NOT emptied): "no entry" means "no
///   opinion", not "deny all", so a locally-scoped plugin the node hasn't scoped yet is
///   preserved. Emptying it would deny-all a half-configured device.
///
/// Map-level `None` on a side → identity (use the other); both `None` → `None`. The
/// merged map then feeds the UNCHANGED `scope_to_approved`, whose "no entry → declared
/// stands" guard keeps a plugin scoped on neither device at its declared set.
fn merge_approved_deny_dominates(
    fs: Option<std::collections::HashMap<String, std::collections::HashSet<String>>>,
    node: Option<std::collections::HashMap<String, std::collections::HashSet<String>>>,
) -> Option<std::collections::HashMap<String, std::collections::HashSet<String>>> {
    match (fs, node) {
        (None, None) => None,
        (Some(m), None) | (None, Some(m)) => Some(m),
        (Some(f), Some(mut n)) => {
            let mut out = std::collections::HashMap::new();
            for (plugin, f_caps) in f {
                match n.remove(&plugin) {
                    // Present on both → per-plugin cap intersection (deny dominates).
                    Some(n_caps) => {
                        out.insert(plugin, f_caps.intersection(&n_caps).cloned().collect());
                    }
                    // fs-only → identity (node has no opinion on this plugin).
                    None => {
                        out.insert(plugin, f_caps);
                    }
                }
            }
            // node-only plugins (not seen on fs) → identity.
            for (plugin, n_caps) in n {
                out.insert(plugin, n_caps);
            }
            Some(out)
        }
    }
}

/// Subtract the revoked capabilities (and whole-plugin revocations) from the merged
/// approved map (G). A plugin revoked entirely drops from the map (all its caps gone);
/// a per-capability revocation removes just that cap from the plugin's set.
fn subtract_revoked_approved(
    approved: Option<std::collections::HashMap<String, std::collections::HashSet<String>>>,
    revoked_plugins: &std::collections::HashSet<String>,
    revoked_caps: &std::collections::HashMap<String, std::collections::HashSet<String>>,
) -> Option<std::collections::HashMap<String, std::collections::HashSet<String>>> {
    approved.map(|map| {
        map.into_iter()
            .filter(|(plugin, _)| !revoked_plugins.contains(plugin))
            .map(|(plugin, caps)| {
                let effective = match revoked_caps.get(&plugin) {
                    Some(revoked) => caps.difference(revoked).cloned().collect(),
                    None => caps,
                };
                (plugin, effective)
            })
            .collect()
    })
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

/// Parse the `approvedPermissions` object — a `{ plugin_id: [capability, …] }`
/// map — into `plugin_id → set<capability>`. Same bounds + control-char hardening
/// as trusted_plugins. Absent key → None (no approval recorded → permissive at
/// load). Keys are NOT lowercased: they must match the plugin_id the load path
/// keys on (the manifest/file-stem id), unlike the case-insensitive allowlist.
fn parse_approved_permissions(
    cfg: &serde_json::Value,
) -> Result<Option<std::collections::HashMap<String, std::collections::HashSet<String>>>, String> {
    let Some(raw) = cfg.get("approvedPermissions") else {
        return Ok(None);
    };
    let obj = raw.as_object().ok_or_else(|| {
        "[blocked: .refarm/config.json approvedPermissions must be an object]".to_string()
    })?;
    if obj.len() > MAX_TRUSTED_PLUGINS {
        return Err(
            "[blocked: .refarm/config.json approvedPermissions exceeds max entries]".to_string(),
        );
    }
    let mut out = std::collections::HashMap::new();
    for (plugin_id, caps_raw) in obj {
        if contains_control_chars(plugin_id) {
            return Err(
                "[blocked: .refarm/config.json approvedPermissions plugin id cannot contain control characters]"
                    .to_string(),
            );
        }
        let caps_arr = caps_raw.as_array().ok_or_else(|| {
            "[blocked: .refarm/config.json approvedPermissions values must be arrays]".to_string()
        })?;
        if caps_arr.len() > MAX_TRUSTED_PLUGINS {
            return Err(
                "[blocked: .refarm/config.json approvedPermissions capability list exceeds max entries]"
                    .to_string(),
            );
        }
        let mut caps = std::collections::HashSet::new();
        for cap in caps_arr {
            let cap = cap
                .as_str()
                .ok_or_else(|| {
                    "[blocked: .refarm/config.json approvedPermissions capabilities must be strings]"
                        .to_string()
                })?
                .trim();
            if contains_control_chars(cap) {
                return Err(
                    "[blocked: .refarm/config.json approvedPermissions capability cannot contain control characters]"
                        .to_string(),
                );
            }
            if !cap.is_empty() {
                caps.insert(cap.to_string());
            }
        }
        out.insert(plugin_id.trim().to_string(), caps);
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
