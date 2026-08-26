/// Build plugin env vars with project config override semantics:
/// process MODEL_* vars first, then `.refarm/config.json` overwrites them.
fn plugin_env_vars_from(base: &std::path::Path, sync: Option<&NativeSync>) -> Vec<(String, String)> {
    let mut vars = forwarded_model_env_vars();
    vars.extend(plugin_runtime_env_vars());
    let mut config_vars = refarm_config_env_vars_from(base, sync);
    push_model_rate_catalog(&mut vars, &mut config_vars, base);
    merge_plugin_env_vars(vars, config_vars)
}

/// Put the model rate catalog on the guest's env — or, when the host refused one,
/// make sure NOTHING carrying that name reaches the guest.
///
/// The catalog the guest sees is the one THIS host resolved (see
/// `model_rate_catalog::resolve_injected_catalog` — the single seam that decides where
/// it comes from). An inherited process-env value is stripped first, because the key is
/// now in the closed text-content forward allowlist and would otherwise ride through
/// `forwarded_model_env_vars` unvalidated — turning the refuse-loudly rule into a
/// suggestion. It goes on the CONFIG side of the merge so the host's answer wins.
///
/// `None` injects nothing at all: the guest reads that as "I do not know prices" and
/// falls back to its built-in table, which is never the same as "everything is free".
fn push_model_rate_catalog(
    model_vars: &mut Vec<(String, String)>,
    config_vars: &mut Vec<(String, String)>,
    base: &std::path::Path,
) {
    use crate::host::plugin_host::model_rate_catalog::{
        resolve_injected_catalog, MODEL_RATE_CATALOG_ENV_KEY,
    };

    model_vars.retain(|(k, _)| k != MODEL_RATE_CATALOG_ENV_KEY);
    config_vars.retain(|(k, _)| k != MODEL_RATE_CATALOG_ENV_KEY);

    let Some(catalog) = resolve_injected_catalog(base) else {
        return;
    };
    // Belt and braces: the host built this string itself, but it still answers to the
    // same closed pair policy every other forwarded MODEL_* value does.
    if crate::host::sensitive_aliases::is_forwardable_model_env_pair(
        MODEL_RATE_CATALOG_ENV_KEY,
        &catalog,
    ) {
        config_vars.push((MODEL_RATE_CATALOG_ENV_KEY.to_string(), catalog));
    } else {
        tracing::error!(
            "resolved model rate catalog failed the MODEL_* forward policy — injecting none"
        );
    }
}

fn plugin_runtime_env_vars() -> Vec<(String, String)> {
    let mut vars = Vec::new();
    push_trimmed_env_var(
        &mut vars,
        "REFARM_STREAMS_DIR",
        std::env::var("REFARM_STREAMS_DIR").ok().as_deref(),
    );
    vars
}

fn merge_plugin_env_vars(
    model_vars: Vec<(String, String)>,
    config_vars: Vec<(String, String)>,
) -> Vec<(String, String)> {
    const MAX_PLUGIN_ENV_VARS: usize = 192;
    const MAX_PLUGIN_ENV_TOTAL_BYTES: usize = 96 * 1024;

    let mut merged = std::collections::BTreeMap::<String, String>::new();
    for (k, v) in model_vars {
        merged.insert(k, v);
    }
    for (k, v) in config_vars {
        merged.insert(k, v);
    }

    let mut out = Vec::new();
    let mut total_bytes = 0usize;
    for (k, v) in merged {
        if out.len() >= MAX_PLUGIN_ENV_VARS {
            break;
        }
        let next_total = total_bytes.saturating_add(k.len() + v.len());
        if next_total > MAX_PLUGIN_ENV_TOTAL_BYTES {
            continue;
        }
        total_bytes = next_total;
        out.push((k, v));
    }

    out
}

/// Resolve the sovereign config as a JSON value: prefer the local fs
/// `.refarm/config.json` when present (the operator of THIS device is
/// authoritative for their own file), else fall back to the replicated
/// `RefarmConfig` graph node's `data` (the config as it arrived from a peer over
/// CRDT sync). This is what makes "config is a graph node" TRUE for a device that
/// has no local config file but received one from another device — while every
/// device that already has a local file behaves exactly as before.
///
/// Redaction note: the graph node redacts secret-named keys, but the fields this
/// reader consumes (provider/model/default_provider/stream_responses/budgets) are
/// never secrets, so the redacted node is a faithful source for them.
fn resolve_sovereign_config(base: &std::path::Path, sync: Option<&NativeSync>) -> Option<serde_json::Value> {
    // Sovereign dir is injected (SOVEREIGN_DIR); no selector → skip the local file.
    if let Some(path) = config_node::sovereign_config_path(base) {
        if let Some(bytes) = read_refarm_config_bytes(&path) {
            match serde_json::from_slice::<serde_json::Value>(&bytes) {
                Ok(cfg) => return Some(cfg),
                Err(_) => tracing::warn!("sovereign config.json is not valid JSON — ignoring"),
            }
        }
    }
    // No usable local file — try the replicated config node.
    let sync = sync?;
    let payload = sync
        .get_node(crate::host::plugin_host::config_node::CONFIG_NODE_DEFAULT_ID)
        .ok()??;
    let node: serde_json::Value = serde_json::from_str(&payload).ok()?;
    let data = node.get("data")?;
    if data.is_null() {
        return None;
    }
    tracing::debug!("sovereign config resolved from the replicated graph node (no local fs file)");
    Some(data.clone())
}

fn refarm_config_env_vars_from(base: &std::path::Path, sync: Option<&NativeSync>) -> Vec<(String, String)> {
    const MAX_CONFIG_BUDGET_VARS: usize = 64;

    let Some(cfg) = resolve_sovereign_config(base, sync) else {
        return vec![];
    };
    let mut vars: Vec<(String, String)> = Vec::new();
    push_trimmed_lower_env_var(&mut vars, "MODEL_PROVIDER", cfg["provider"].as_str());
    push_trimmed_env_var(&mut vars, "MODEL_ID", cfg["model"].as_str());
    push_trimmed_lower_env_var(&mut vars, "MODEL_DEFAULT_PROVIDER", cfg["default_provider"].as_str());
    push_bool_env_var(&mut vars, "MODEL_STREAM_RESPONSES", cfg["stream_responses"].as_bool());
    if let Some(budgets) = cfg["budgets"].as_object() {
        for (provider, amount) in budgets.iter().take(MAX_CONFIG_BUDGET_VARS) {
            let Some(provider_token) = sanitize_budget_provider_for_env(provider) else {
                continue;
            };
            if let Some(usd) = amount.as_f64() {
                if usd < 0.0 {
                    continue;
                }
                let key = format!("MODEL_BUDGET_{}_USD", provider_token);
                upsert_env_var_vec(&mut vars, key, usd.to_string());
            }
        }
    }
    vars
}

fn sanitize_budget_provider_for_env(provider: &str) -> Option<String> {
    let trimmed = provider.trim();
    if trimmed.is_empty() {
        return None;
    }
    if !trimmed.is_ascii() {
        return None;
    }
    if trimmed.chars().any(|c| c.is_whitespace()) {
        return None;
    }
    if trimmed.chars().any(|c| c.is_control()) {
        return None;
    }

    let mut out = String::new();
    let mut prev_underscore = false;
    for ch in trimmed.chars() {
        if ch.is_ascii_alphanumeric() {
            out.push(ch.to_ascii_uppercase());
            prev_underscore = false;
        } else if !prev_underscore {
            out.push('_');
            prev_underscore = true;
        }
    }

    let normalized = out.trim_matches('_').to_string();
    const MAX_BUDGET_PROVIDER_TOKEN_LEN: usize = 64;
    if normalized.is_empty() || normalized.len() > MAX_BUDGET_PROVIDER_TOKEN_LEN {
        None
    } else {
        Some(normalized)
    }
}

fn push_trimmed_env_var(vars: &mut Vec<(String, String)>, key: &str, value: Option<&str>) {
    const MAX_CONFIG_ENV_VALUE_LEN: usize = 4096;
    let Some(value) = value else { return; };
    let trimmed = value.trim();
    if !trimmed.is_empty()
        && trimmed.len() <= MAX_CONFIG_ENV_VALUE_LEN
        && trimmed.is_ascii()
        && !trimmed.chars().any(|c| c.is_whitespace())
        && !trimmed.chars().any(|c| c.is_control())
    {
        upsert_env_var_vec(vars, key.to_string(), trimmed.to_string());
    }
}

fn push_trimmed_lower_env_var(vars: &mut Vec<(String, String)>, key: &str, value: Option<&str>) {
    const MAX_CONFIG_ENV_VALUE_LEN: usize = 4096;
    let Some(value) = value else { return; };
    let trimmed = value.trim();
    let lowered = trimmed.to_ascii_lowercase();
    if !trimmed.is_empty()
        && trimmed.len() <= MAX_CONFIG_ENV_VALUE_LEN
        && trimmed.is_ascii()
        && !trimmed.chars().any(|c| c.is_control())
        && is_safe_provider_token(&lowered)
    {
        upsert_env_var_vec(vars, key.to_string(), lowered);
    }
}

fn push_bool_env_var(vars: &mut Vec<(String, String)>, key: &str, value: Option<bool>) {
    let Some(value) = value else { return; };
    upsert_env_var_vec(
        vars,
        key.to_string(),
        if value { "1" } else { "0" }.to_string(),
    );
}

fn is_safe_provider_token(value: &str) -> bool {
    const MAX_PROVIDER_TOKEN_LEN: usize = 64;
    !value.is_empty()
        && value.len() <= MAX_PROVIDER_TOKEN_LEN
        && value
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-' || b == b'_')
}

fn upsert_env_var_vec(vars: &mut Vec<(String, String)>, key: String, value: String) {
    if vars.iter().all(|(k, _)| k != &key) {
        vars.push((key, value));
    }
}

fn read_refarm_config_bytes(path: &std::path::Path) -> Option<Vec<u8>> {
    const MAX_REFARM_CONFIG_BYTES: u64 = 256 * 1024;

    let Ok(metadata) = std::fs::symlink_metadata(path) else {
        return None;
    };
    if !metadata.is_file() {
        tracing::warn!(
            path = %path.display(),
            "ignoring non-regular .refarm/config.json entry"
        );
        return None;
    }
    if metadata.len() > MAX_REFARM_CONFIG_BYTES {
        tracing::warn!(
            path = %path.display(),
            bytes = metadata.len(),
            "ignoring oversized .refarm/config.json"
        );
        return None;
    }

    let Ok(mut file) = std::fs::File::open(path) else {
        return None;
    };
    if !refarm_config_path_matches_open_file(path, &file) {
        tracing::warn!(
            path = %path.display(),
            "ignoring unstable .refarm/config.json entry during read"
        );
        return None;
    }

    let mut bytes = Vec::new();
    use std::io::Read as _;
    if (&mut file)
        .take(MAX_REFARM_CONFIG_BYTES + 1)
        .read_to_end(&mut bytes)
        .is_err()
    {
        return None;
    }
    if !refarm_config_path_matches_open_file(path, &file) {
        tracing::warn!(
            path = %path.display(),
            "ignoring unstable .refarm/config.json entry after read"
        );
        return None;
    }
    if bytes.len() as u64 > MAX_REFARM_CONFIG_BYTES {
        tracing::warn!(
            path = %path.display(),
            bytes = bytes.len(),
            "ignoring oversized .refarm/config.json after read"
        );
        return None;
    }
    Some(bytes)
}

#[cfg(unix)]
fn refarm_config_path_matches_open_file(path: &std::path::Path, file: &std::fs::File) -> bool {
    use std::os::unix::fs::MetadataExt;

    let Ok(path_metadata) = std::fs::symlink_metadata(path) else {
        return false;
    };
    let Ok(file_metadata) = file.metadata() else {
        return false;
    };

    path_metadata.is_file()
        && file_metadata.is_file()
        && path_metadata.dev() == file_metadata.dev()
        && path_metadata.ino() == file_metadata.ino()
}

#[cfg(not(unix))]
fn refarm_config_path_matches_open_file(path: &std::path::Path, file: &std::fs::File) -> bool {
    let Ok(path_metadata) = std::fs::symlink_metadata(path) else {
        return false;
    };
    let Ok(file_metadata) = file.metadata() else {
        return false;
    };

    path_metadata.is_file() && file_metadata.is_file()
}

fn refarm_config_json_from(base: &std::path::Path) -> Option<serde_json::Value> {
    // Sovereign dir is injected (SOVEREIGN_DIR); no selector → no config path.
    let path = config_node::sovereign_config_path(base)?;
    let bytes = read_refarm_config_bytes(&path)?;
    serde_json::from_slice::<serde_json::Value>(&bytes).ok()
}

/// Preopen the plugin's runtime dirs into its WASI filesystem, SCOPED to the
/// plugin's declared fs grant (Gate B — the context-scope gate of the trichotomy).
///
/// The `wasi:filesystem` import resolves for any plugin (base WASI is in every
/// linker), so the enforcement point for direct filesystem access is not the
/// linker but the WasiCtx: a dir the plugin never gets a preopen for is a dir it
/// cannot open, and a preopen granted read-only cannot be written. We derive the
/// preopen's DirPerms/FilePerms from `fs:read`/`fs:write`:
///   - neither declared → NO preopen (the plugin gets no wasi:filesystem root);
///   - fs:read only      → read-only preopen (mutation denied at the WASI layer);
///   - fs:write (+ read) → read-write preopen.
///
/// Under dev/Permissive `grants` is true for both, so this is byte-identical to
/// the previous unconditional `all()` preopen — dev is unaffected.
///
/// Note: today no in-tree plugin imports `wasi:filesystem` (the agent reaches fs
/// via the host-fs bridge, gated separately at Gate C), so this closes a LATENT
/// hole — a future filesystem-importing plugin is scoped from day one rather than
/// handed an ungated root. The streams dir itself is written HOST-side
/// (model_stream_events), so scoping the guest's preopen does not affect streaming.
/// Derive the WASI preopen permissions for the plugin's runtime dirs from its fs
/// grant — the pure decision at the heart of Gate B, unit-testable without a
/// `wasi:filesystem`-importing guest:
///   - neither fs:read nor fs:write → `None` (no preopen at all);
///   - fs:read only  → read-only (`DirPerms::READ`, `FilePerms::READ`);
///   - fs:write      → read-write (`all()` — writing implies traversal).
///
/// Dev/Permissive grants both → `all()`, byte-identical to the previous behavior.
fn fs_preopen_perms(
    permission_grant: &crate::host::wasi_bridge::PermissionGrant,
) -> Option<(DirPerms, FilePerms)> {
    use crate::host::permission::Permission;

    let can_read = permission_grant.grants_permission(Permission::FsRead);
    let can_write = permission_grant.grants_permission(Permission::FsWrite);
    match (can_read, can_write) {
        (false, false) => None,
        (_, true) => Some((DirPerms::all(), FilePerms::all())),
        (true, false) => Some((DirPerms::READ, FilePerms::READ)),
    }
}

fn preopen_plugin_runtime_dirs(
    wasi_builder: &mut WasiCtxBuilder,
    permission_grant: &crate::host::wasi_bridge::PermissionGrant,
) -> Result<()> {
    // No fs grant at all → no filesystem root for this plugin.
    let Some((dir_perms, file_perms)) = fs_preopen_perms(permission_grant) else {
        return Ok(());
    };

    let Ok(streams_dir) = std::env::var("REFARM_STREAMS_DIR") else {
        return Ok(());
    };
    if streams_dir.trim().is_empty() {
        return Ok(());
    }

    std::fs::create_dir_all(&streams_dir)?;
    wasi_builder.preopened_dir(&streams_dir, streams_dir.as_str(), dir_perms, file_perms)?;
    Ok(())
}

/// Publish the ONE canonical workspace config node (upsert), the unified
/// `sovereign.config.node.v1` contract shared with the TS encoder. Replaces the old
/// per-load timestamped audit writer: the node is workspace-scoped, NOT
/// per-plugin, so every load upserts the SAME node (stable @id) — N loads => 1
/// node, revised in place (was: N accumulating rows). Secrets are redacted before
/// the config enters the node (the old writer replicated a raw MODEL_* env map
/// across devices). Read-before-write: skip the store when the on-graph revision
/// already matches, so a byte-identical re-publish on every plugin load causes no
/// CRDT commit/broadcast churn.
fn store_refarm_config_node(
    sync: &NativeSync,
    config_json: Option<&serde_json::Value>,
) -> anyhow::Result<()> {
    use crate::host::plugin_host::config_node;
    // No sovereign config on disk => nothing to publish.
    let Some(config) = config_json else {
        return Ok(());
    };

    let payload_value = config_node::build_config_node_payload(config, "tractor-host");
    let new_revision = payload_value
        .get("revision")
        .and_then(|v| v.as_str())
        .map(str::to_owned);

    // Read-before-write: if the graph already holds this exact revision, don't
    // re-commit (no broadcast storm on repeated loads of an unchanged config).
    if let (Ok(Some(existing)), Some(new_rev)) =
        (sync.get_node(config_node::CONFIG_NODE_DEFAULT_ID), &new_revision)
    {
        if config_node::payload_revision(&existing).as_ref() == Some(new_rev) {
            return Ok(());
        }
    }

    sync.store_node(
        config_node::CONFIG_NODE_DEFAULT_ID,
        config_node::CONFIG_NODE_GRAPH_TYPE,
        None,
        &payload_value.to_string(),
        Some("tractor-host"),
    )?;
    Ok(())
}

/// Materialize the operator's ADD-ONLY revocation list (`revokedPlugins` /
/// `revokedPermissions` in the sovereign config) into per-revocation graph tombstones
/// (G2). Mirrors `store_refarm_config_node`: the config file is the operator's local,
/// append-only intent; the host projects each entry into its OWN
/// `urn:sovereign:revocation:<id>[:cap]` node so a revocation is a monotonic CRDT add a
/// stale concurrent config write can't undo. store_node is an idempotent upsert keyed
/// by node id, so re-materializing the same revocation on every load is a no-op.
fn materialize_revocation_tombstones(
    sync: &NativeSync,
    config_json: Option<&serde_json::Value>,
) -> anyhow::Result<()> {
    use crate::host::plugin_host::revocation_node as rev;
    let Some(config) = config_json else {
        return Ok(());
    };

    // Revoke facts. `revokedPlugins` is the add-only list; `revokedPluginsSeq` (Slice B)
    // optionally carries the operator's per-id revoke seq (default 1 — the base revoke).
    if let Some(ids) = config.get("revokedPlugins").and_then(|v| v.as_array()) {
        for id in ids.iter().filter_map(|v| v.as_str()) {
            let seq = revoke_seq_for(config, "revokedPluginsSeq", id);
            let payload = rev::build_revocation_tombstone_payload(id, None, seq);
            sync.store_node(
                &rev::revocation_node_id(id),
                rev::REVOCATION_NODE_TYPE,
                None,
                &payload.to_string(),
                Some("tractor-host"),
            )?;
        }
    }

    if let Some(map) = config.get("revokedPermissions").and_then(|v| v.as_object()) {
        for (plugin_id, caps) in map {
            let Some(caps) = caps.as_array() else { continue };
            for cap in caps.iter().filter_map(|v| v.as_str()) {
                let seq = revoke_seq_for(config, "revokedPermissionsSeq", &format!("{plugin_id}:{cap}"));
                let payload = rev::build_revocation_tombstone_payload(plugin_id, Some(cap), seq);
                sync.store_node(
                    &rev::capability_revocation_node_id(plugin_id, cap),
                    rev::REVOCATION_NODE_TYPE,
                    None,
                    &payload.to_string(),
                    Some("tractor-host"),
                )?;
            }
        }
    }

    // Annulment (un-revoke) facts — a distinct add-only node per scope, carrying the
    // operator's bumped seq. When annul.seq >= revoke.seq the scope is netted out.
    if let Some(map) = config.get("revokedPluginsAnnul").and_then(|v| v.as_object()) {
        for (id, seq) in map {
            let Some(seq) = seq.as_u64() else { continue };
            let payload = rev::build_revocation_annulment_payload(id, None, seq);
            sync.store_node(
                &rev::annulment_node_id(id, None),
                rev::REVOCATION_NODE_TYPE,
                None,
                &payload.to_string(),
                Some("tractor-host"),
            )?;
        }
    }
    if let Some(map) = config.get("revokedPermissionsAnnul").and_then(|v| v.as_object()) {
        for (key, seq) in map {
            let Some(seq) = seq.as_u64() else { continue };
            let Some((plugin_id, cap)) = key.split_once(':') else { continue };
            let payload = rev::build_revocation_annulment_payload(plugin_id, Some(cap), seq);
            sync.store_node(
                &rev::annulment_node_id(plugin_id, Some(cap)),
                rev::REVOCATION_NODE_TYPE,
                None,
                &payload.to_string(),
                Some("tractor-host"),
            )?;
        }
    }
    Ok(())
}

/// The operator's revoke seq for a scope key, from an optional `{key: seq}` map in the
/// config; defaults to 1 (the base revoke). Add-only: re-revoke bumps this above the
/// annulment seq to deny again.
fn revoke_seq_for(config: &serde_json::Value, field: &str, scope_key: &str) -> u64 {
    config
        .get(field)
        .and_then(|v| v.as_object())
        .and_then(|m| m.get(scope_key))
        .and_then(|v| v.as_u64())
        .unwrap_or(1)
}

#[derive(Debug, Clone, serde::Deserialize)]
struct RuntimePluginManifest {
    id: String,
    version: String,
    entry: String,
    observability: RuntimePluginObservability,
    #[serde(default)]
    capabilities: RuntimePluginCapabilities,
    /// Host-effect permissions the plugin DECLARES it needs (e.g. `fs:read`,
    /// `shell:spawn`, `network:outbound`). Previously discarded at parse; now read
    /// so the `request-permission` host export can answer honestly ("did this
    /// plugin declare this capability?") instead of always granting.
    #[serde(default)]
    permissions: Vec<String>,
    /// The declared content hash of the plugin `.wasm` (`sha256-<hex>`, `sha256:<hex>`,
    /// or bare hex), written by the installer (farmhand) at install time. Verified at
    /// load against the hash computed from the bytes on disk — a tampered artifact at a
    /// trusted id fails to load. Previously DROPPED at parse (no field → serde ignored
    /// it), so integrity was a write-time claim only. `None` = no integrity declared
    /// (backward-compatible: an un-signed local plugin loads, unverified).
    #[serde(default)]
    integrity: Option<String>,
}

#[derive(Debug, Clone, serde::Deserialize)]
struct RuntimePluginObservability {
    hooks: Vec<String>,
}

#[derive(Debug, Clone, Default, serde::Deserialize)]
pub(crate) struct RuntimePluginCapabilities {
    #[serde(default)]
    provides: Vec<String>,
    /// The runtime event names this plugin subscribes to — what the neutral event
    /// router delivers to it. Optional; absent means the plugin is loadable but
    /// driven only by lifecycle calls (and, for the agent, by integration:respond sugar).
    #[serde(default)]
    subscribes: Vec<String>,
    /// Named APIs this plugin PROVIDES (the SPI provider side). A canonical manifest
    /// field (validated in plugin-manifest); previously DROPPED at parse, so
    /// `get_plugin_api` could never resolve a real provider. Folded into `provides`
    /// as `api:<name>` at load so the registry's resolver finds it.
    #[serde(default, rename = "providesApi")]
    provides_api: Vec<String>,
    /// Named APIs this plugin REQUIRES (the SPI consumer side). Surfaced as an
    /// advisory warn if unmet at load (load-order-safe — never bails); the real
    /// enforcement is `get_plugin_api` returning NotFound at call time.
    #[serde(default, rename = "requiresApi")]
    requires_api: Vec<String>,
    /// Per-verb usage prose (promptSnippet Slice 2), keyed by the same `<key>:<verb>`
    /// string in `provides`. When present, `list-tool-prompts` returns THIS for the
    /// verb's system-prompt guidance instead of the host-synthesized boilerplate —
    /// so a plugin author teaches the agent how to use its tool. Optional + additive.
    #[serde(default, rename = "verbDocs")]
    verb_docs: std::collections::HashMap<String, String>,
    /// Per-verb argument SCHEMA, keyed by the same `<key>:<verb>` in `provides`. When
    /// present, the agent leg renders THIS as the model tool's parameters instead of the
    /// generic variadic `{ args: string[] }` — a plugin verb reaches the agent TYPED. Each
    /// value is the JSON-Schema object the host wraps in the provider envelope. The FORM
    /// companion of `verbDocs`' prose; optional + additive (absent → variadic-default).
    #[serde(default, rename = "verbSchemas")]
    verb_schemas: std::collections::HashMap<String, serde_json::Value>,
    /// The verbs (`<key>:<verb>`, a subset of `provides`) this plugin serves
    /// SYNCHRONOUSLY via `respond` (ADR-084's negotiated sync flag). The host
    /// dispatches a synchronous respond ONLY to a verb listed here; a verb absent
    /// from this list stays async-default (driven via `on-event`), and a caller
    /// requesting sync for it gets a clean not-supported instead of a hung call.
    /// Optional + additive; empty means the plugin is async-only.
    #[serde(default, rename = "syncVerbs")]
    sync_verbs: Vec<String>,
    /// Whether the plugin is safe to drive concurrently — i.e. its on_event is
    /// STATELESS across events (all state lives in the shared graph, nothing is
    /// retained in the guest's own linear memory between calls). Only such a
    /// plugin may be run by a pool of N stores in parallel; a plugin that hoards
    /// mutable state in its Store would diverge across N copies. Defaults false:
    /// concurrency is strictly opt-in, so the safe single-store runner stays the
    /// default and a future stateful plugin is never silently parallelised.
    #[serde(default, rename = "concurrentSafe")]
    concurrent_safe: bool,
    /// The ergonomic AUTHORING block for dispatchable verbs — the high-level form that
    /// names each verb once (short, no `<key>:` prefix); a non-empty block derives the
    /// `<key>:dispatch` channel IMPLICITLY (dispatch is infra, no flag). Lowered into the
    /// raw fields above by `capability_profile_from_manifest`, mirroring the JS
    /// `normalizeCapabilities` (plugin-manifest). Optional; coexists with the raw lists
    /// (which carry non-verb entries: events, sugar, apis).
    #[serde(default)]
    verbs: Option<RuntimeVerbsBlock>,
}

/// A typed argument for a verb — the ergonomic alternative to a hand-authored `schema`. Mirrors JS
/// `PluginVerbArg`. When a verb declares `args` and no explicit `schema`, the schema is DERIVED.
#[derive(Debug, Clone, Default, serde::Deserialize)]
struct RuntimeVerbArg {
    /// The argument name — the JSON-Schema property key.
    name: String,
    /// JSON-Schema scalar type (default "string"). "array" → a list whose element type is `items`.
    #[serde(rename = "type")]
    ty: Option<String>,
    /// Marks the arg required in the derived schema's `required`.
    #[serde(default)]
    required: bool,
    /// Allowed values (a string enum) → the property's `enum`.
    #[serde(rename = "enum")]
    enum_values: Option<Vec<String>>,
    /// One-line description → the property's `description`.
    description: Option<String>,
    /// Element type when `type: "array"` (default "string").
    items: Option<String>,
}

/// One verb's entry in the `verbs` block: WHERE it goes (flags) + its per-verb metadata,
/// keyed by the SHORT verb name. Mirrors JS `PluginVerbEntry`.
#[derive(Debug, Clone, Default, serde::Deserialize)]
struct RuntimeVerbEntry {
    /// Put `<key>:<verb>` in provides. Absent = true (a listed verb is provided).
    provides: Option<bool>,
    /// Put `<key>:<verb>` in subscribes too.
    #[serde(default)]
    subscribes: bool,
    /// Per-verb prose → verbDocs["<key>:<verb>"].
    doc: Option<String>,
    /// Per-verb JSON-Schema → verbSchemas["<key>:<verb>"]. Wins over `args` (the escape hatch).
    schema: Option<serde_json::Value>,
    /// Typed args → DERIVED into verbSchemas when no explicit `schema` is given.
    args: Option<Vec<RuntimeVerbArg>>,
}

/// Derive a verb's JSON-Schema from its typed `args` — the Rust mirror of JS
/// `deriveVerbSchemaFromArgs`, kept identical (property order is irrelevant — both hosts compare
/// parsed JSON, asserted by the shared conformance fixture — but the `required` array is in
/// declaration order on both sides). Used when a verb declares `args` and no explicit `schema`.
fn derive_verb_schema_from_args(args: &[RuntimeVerbArg]) -> serde_json::Value {
    let mut properties = serde_json::Map::new();
    let mut required: Vec<serde_json::Value> = Vec::new();
    for arg in args {
        if arg.name.is_empty() {
            continue;
        }
        let ty = arg.ty.as_deref().unwrap_or("string");
        let mut property = serde_json::Map::new();
        if ty == "array" {
            let items_ty = arg.items.as_deref().unwrap_or("string");
            property.insert("type".to_string(), serde_json::json!("array"));
            property.insert("items".to_string(), serde_json::json!({ "type": items_ty }));
        } else {
            property.insert("type".to_string(), serde_json::json!(ty));
        }
        if let Some(desc) = &arg.description {
            property.insert("description".to_string(), serde_json::json!(desc));
        }
        if let Some(values) = &arg.enum_values {
            if !values.is_empty() {
                property.insert("enum".to_string(), serde_json::json!(values));
            }
        }
        properties.insert(arg.name.clone(), serde_json::Value::Object(property));
        if arg.required {
            required.push(serde_json::json!(arg.name));
        }
    }
    let mut schema = serde_json::Map::new();
    schema.insert("type".to_string(), serde_json::json!("object"));
    schema.insert("properties".to_string(), serde_json::Value::Object(properties));
    if !required.is_empty() {
        schema.insert("required".to_string(), serde_json::Value::Array(required));
    }
    serde_json::Value::Object(schema)
}

/// The `verbs` authoring block. Mirrors JS `PluginVerbsBlock`. A non-empty block always
/// derives `<key>:dispatch` (dispatch is implicit — declaring verbs means surfacing them).
#[derive(Debug, Clone, Default, serde::Deserialize)]
struct RuntimeVerbsBlock {
    /// The routing key prefixed onto every short verb. Absent → inferred from the id.
    key: Option<String>,
    /// The verbs, keyed by short name → entry.
    #[serde(default)]
    list: std::collections::HashMap<String, RuntimeVerbEntry>,
}

/// The canonical routing key inferred from a plugin id: the LAST path segment
/// (`@scope/vault` → `vault`). Mirrors JS `pluginKeyFromId` + the plugin_registry key
/// convention. Used as the default `verbs` key when none is declared.
fn plugin_key_from_id(id: &str) -> &str {
    match id.rfind('/') {
        Some(idx) => &id[idx + 1..],
        None => id,
    }
}

/// Build the registry's `PluginCapabilityProfile` from a parsed manifest's capabilities
/// — the ONE place manifest fields map onto the aggregate the handle carries and the
/// registry stores. Folds each declared `providesApi: ["FooApi"]` into `provides` as
/// `api:FooApi`, so the registry's `plugin_providing_api` matcher (which scans `provides`
/// for `api:<name>`) resolves real manifests without a parallel field. `concurrent_safe`
/// and `requires_api` are deliberately NOT here: they feed the runner and the registry's
/// separate requires-api map, not the list/invoke profile.
pub(crate) fn capability_profile_from_manifest(
    caps: &RuntimePluginCapabilities,
    id: &str,
) -> crate::host::plugin_registry::PluginCapabilityProfile {
    // Start from the raw lists (they carry the non-verb entries) and LOWER the ergonomic
    // `verbs` block into them — the Rust mirror of JS `normalizeCapabilities`, kept in
    // lockstep by the shared plugin-surface-verbs conformance fixture.
    let mut provides = caps.provides.clone();
    let mut subscribes = caps.subscribes.clone();
    let mut verb_docs = caps.verb_docs.clone();
    let mut verb_schemas = caps.verb_schemas.clone();

    if let Some(block) = &caps.verbs {
        // Explicit key wins; else infer from the id (last path segment).
        let key = match block.key.as_deref() {
            Some(k) if !k.is_empty() => k,
            _ => plugin_key_from_id(id),
        };
        let push_unique = |v: &mut Vec<String>, s: String| {
            if !v.contains(&s) {
                v.push(s);
            }
        };
        // Deterministic order: verbs in sorted key order (a HashMap has no stable order,
        // and the conformance fixture asserts a specific sequence).
        let mut verb_names: Vec<&String> = block.list.keys().collect();
        verb_names.sort();
        for verb in verb_names {
            let entry = &block.list[verb];
            let target = format!("{key}:{verb}");
            // A listed verb is provided by default; opt out with provides:false.
            if entry.provides != Some(false) {
                push_unique(&mut provides, target.clone());
            }
            if entry.subscribes {
                push_unique(&mut subscribes, target.clone());
            }
            if let Some(doc) = &entry.doc {
                verb_docs.insert(target.clone(), doc.clone());
            }
            // An explicit `schema` WINS (the escape hatch); else derive it from typed `args`.
            if let Some(schema) = &entry.schema {
                verb_schemas.insert(target.clone(), schema.clone());
            } else if let Some(args) = &entry.args {
                if !args.is_empty() {
                    verb_schemas.insert(target.clone(), derive_verb_schema_from_args(args));
                }
            }
        }
        // A non-empty block IS a dispatchable surface — derive the <key>:dispatch routing
        // channel on BOTH sides. Implicit (no flag): declaring verbs means surfacing them.
        if !key.is_empty() && !block.list.is_empty() {
            let channel = format!("{key}:dispatch");
            push_unique(&mut provides, channel.clone());
            push_unique(&mut subscribes, channel);
        }
    }

    // Fold providesApi into the api:<name> convention (after verbs expansion, so both
    // the raw and lowered provides participate).
    provides.extend(caps.provides_api.iter().map(|api| format!("api:{api}")));

    crate::host::plugin_registry::PluginCapabilityProfile {
        provides,
        subscribes,
        verb_docs,
        verb_schemas,
        sync_verbs: caps.sync_verbs.clone(),
    }
}

const REQUIRED_RUNTIME_HOOKS: &[&str] = &[
    "onLoad",
    "onInit",
    "onRequest",
    "onError",
    "onTeardown",
];

fn read_runtime_plugin_manifest(path: &Path) -> Result<Option<RuntimePluginManifest>> {
    let Some(parent) = path.parent() else {
        return Ok(None);
    };

    for filename in ["plugin.json", "plugin-manifest.json", "manifest.json"] {
        let manifest_path = parent.join(filename);
        if !manifest_path.is_file() {
            continue;
        }

        let bytes = std::fs::read(&manifest_path)
            .map_err(|e| anyhow::anyhow!("failed to read {}: {e}", manifest_path.display()))?;
        let manifest = serde_json::from_slice::<RuntimePluginManifest>(&bytes)
            .map_err(|e| anyhow::anyhow!("invalid {}: {e}", manifest_path.display()))?;
        return Ok(Some(manifest));
    }

    Ok(None)
}

/// Read the RAW `plugin.json` manifest as a JSON value (not the typed struct) — used to
/// build the plugin pointer node (E3), which carries the manifest essentials verbatim
/// (minus the device-local `entry`) so an orphan-grant device can reconstruct it.
fn read_runtime_plugin_manifest_raw(path: &Path) -> Option<serde_json::Value> {
    let parent = path.parent()?;
    for filename in ["plugin.json", "plugin-manifest.json", "manifest.json"] {
        let manifest_path = parent.join(filename);
        if !manifest_path.is_file() {
            continue;
        }
        if let Ok(bytes) = std::fs::read(&manifest_path) {
            if let Ok(value) = serde_json::from_slice::<serde_json::Value>(&bytes) {
                return Some(value);
            }
        }
    }
    None
}

/// Verify the loaded `.wasm` bytes against the manifest's declared integrity hash.
///
/// `declared` accepts `sha256-<hex>`, `sha256:<hex>`, or bare hex (case-insensitive);
/// `computed_hash` is the lowercase hex of `sha256(bytes)`. A mismatch is a hard load
/// failure — a tampered artifact at a trusted id must not run.
///
/// `None` declared = no integrity claim. This USED TO BE Ok unconditionally
/// ("backward-compatible: an un-signed local plugin still loads"), which made "deliberately
/// unsigned because I am developing it" and "the claim is missing" the same observable state.
/// It is now Ok only when the NODE declared it is developing this plugin. A declaration never
/// excuses a WRONG hash — that is "tampered or replaced" and stays a hard failure.
fn verify_wasm_integrity(
    declared: Option<&str>,
    computed_hash: &str,
    plugin_id: &str,
    under_development: bool,
) -> Result<()> {
    let Some(declared) = declared else {
        anyhow::ensure!(
            under_development,
            "plugin '{plugin_id}' declares no integrity and this node has not declared it is \
             under development — declare it, or install a signed build",
        );
        // The waiver just fired: this artifact is about to run UNVERIFIED because the node
        // declared it under development, not because anything vouches for its bytes. Silent
        // before this line — an operator reading the load log had no way to tell "ran because
        // declared" from "ran because nobody checked". `warn`, not `info`: it is a load
        // bypassing the integrity gate, worth noticing even when nothing else is wrong.
        tracing::warn!(
            plugin_id = %plugin_id,
            "plugin declares no integrity — running UNVERIFIED because this node declared it under development"
        );
        return Ok(());
    };
    // Lowercase FIRST so an uppercase `SHA256-...` prefix + hex both normalize.
    let declared = declared.trim().to_ascii_lowercase();
    let declared_hex = declared
        .strip_prefix("sha256-")
        .or_else(|| declared.strip_prefix("sha256:"))
        .unwrap_or(&declared)
        .to_string();
    anyhow::ensure!(
        declared_hex == computed_hash,
        "integrity check failed for plugin '{plugin_id}': declared sha256 {declared_hex} \
         does not match the loaded bytes ({computed_hash}) — the artifact was tampered or replaced",
    );
    Ok(())
}

fn manifest_runtime_plugin_id(manifest_id: &str) -> &str {
    manifest_id
        .trim()
        .rsplit('/')
        .next()
        .filter(|v| !v.trim().is_empty())
        .unwrap_or(manifest_id)
}

/// Whether THIS node's `.refarm/config.json` declares it is developing `plugin_id` —
/// Task 6's declaration (`packages/config/src/plugin-development.js`
/// `isUnderDevelopment`/`readPluginDevelopment`), keyed by the RUNTIME id
/// (`manifest_runtime_plugin_id`, proven 57ff5cc1 the vocabulary the load path looks
/// up) IN EITHER VOCABULARY — the stored key is canonicalised the same as the queried
/// one, so `"lsp-code-ops"` and `"@refarm/lsp-code-ops"` both resolve regardless of
/// which spelling is on disk.
///
/// MIRRORS THE JS READER'S SHAPE EXACTLY, including its fail-closed rule for every
/// malformed shape: a non-object `cfg`, a `pluginDevelopment` that is missing, not an
/// object, or an array, an entry that is not an object (including an array entry), and
/// a `declaredAt` that is missing, empty, whitespace-only, or not a string — every one
/// of these lands on `false` ("not declared"), never on `true`. This function never
/// returns an error; a parse bug on the path that decides whether an unsigned plugin
/// may run must not be mistaken for consent.
fn plugin_development_declares(cfg: &serde_json::Value, plugin_id: &str) -> bool {
    let Some(raw) = cfg.get("pluginDevelopment") else {
        return false;
    };
    let Some(entries) = raw.as_object() else {
        return false;
    };
    let target = manifest_runtime_plugin_id(plugin_id);
    entries.iter().any(|(stored_id, entry)| {
        let Some(entry) = entry.as_object() else {
            return false;
        };
        let declared_at = entry
            .get("declaredAt")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim();
        !declared_at.is_empty() && manifest_runtime_plugin_id(stored_id) == target
    })
}

fn validate_manifest_runtime_alignment(
    plugin_id: &str,
    metadata: &plugin::host::types::PluginMetadata,
    manifest: &RuntimePluginManifest,
) -> Result<()> {
    let mut issues = Vec::<String>::new();

    if manifest.id.trim().is_empty() {
        issues.push("manifest.id must be a non-empty string".to_string());
    }
    if manifest.version.trim().is_empty() {
        issues.push("manifest.version must be a non-empty string".to_string());
    }
    if manifest.entry.trim().is_empty() {
        issues.push("manifest.entry must be a non-empty string".to_string());
    } else if !manifest.entry.ends_with(".wasm") {
        issues.push("manifest.entry must point to a .wasm artifact for tractor runtime".to_string());
    }

    let missing_hooks: Vec<&str> = REQUIRED_RUNTIME_HOOKS
        .iter()
        .copied()
        .filter(|hook| !manifest.observability.hooks.iter().any(|declared| declared == hook))
        .collect();
    if !missing_hooks.is_empty() {
        issues.push(format!(
            "observability.hooks missing required hooks: {}",
            missing_hooks.join(", ")
        ));
    }

    // Reject permissions outside the closed vocabulary (the effect axis) — a typo
    // like `fs:reed` would otherwise become an inert dead grant that silently
    // never enforces. Matches the reject-unknown posture of `targets` /
    // `trust.profile`. The canonical set lives in `host::permission`.
    let unknown_permissions = crate::host::permission::unknown_permissions(
        manifest.permissions.iter().map(String::as_str),
    );
    if !unknown_permissions.is_empty() {
        issues.push(format!(
            "permissions contains unknown capabilities: {} (known: {})",
            unknown_permissions.join(", "),
            crate::host::permission::Permission::ALL
                .iter()
                .map(|p| p.as_str())
                .collect::<Vec<_>>()
                .join(", ")
        ));
    }

    let manifest_plugin_id = manifest_runtime_plugin_id(&manifest.id);
    // The runtime plugin_id is what the WASM component actually exports as its
    // metadata.name — NOT `plugin_id`, which was derived from the manifest and
    // would make this a tautological self-comparison. Compare the manifest's
    // declared id against the runtime's true identity.
    let runtime_plugin_id = metadata.name.trim();
    if !runtime_plugin_id.is_empty() && manifest_plugin_id != runtime_plugin_id {
        issues.push(format!(
            "plugin_id mismatch: runtime='{}' manifest='{}' (manifest.id='{}')",
            runtime_plugin_id, manifest_plugin_id, manifest.id
        ));
    }

    if metadata.name.trim().is_empty() {
        issues.push("metadata.name must be a non-empty string".to_string());
    }
    if metadata.version.trim().is_empty() {
        issues.push("metadata.version must be a non-empty string".to_string());
    } else if metadata.version != manifest.version {
        issues.push(format!(
            "version mismatch: metadata.version='{}' manifest.version='{}'",
            metadata.version, manifest.version
        ));
    }

    if issues.is_empty() {
        Ok(())
    } else {
        anyhow::bail!(
            "manifest/runtime alignment failed for plugin '{}': {}",
            plugin_id,
            issues.join("; ")
        )
    }
}

/// The epoch tick period. increment_epoch() is called once per tick, so the
/// wall-clock budget a store gets is `deadline_ticks * EPOCH_TICK`.
pub(crate) const EPOCH_TICK: std::time::Duration = std::time::Duration::from_millis(1);

/// Spawn the single global epoch ticker for both engines. Holds Weak refs so it
/// stops once both engines are dropped (host teardown), never leaking the thread.
fn spawn_epoch_ticker(engine: &Arc<Engine>, module_engine: &Arc<Engine>) {
    let weak = Arc::downgrade(engine);
    let weak_module = Arc::downgrade(module_engine);
    std::thread::Builder::new()
        .name("epoch-ticker".to_string())
        .spawn(move || loop {
            std::thread::sleep(EPOCH_TICK);
            match (Weak::upgrade(&weak), Weak::upgrade(&weak_module)) {
                (None, None) => break, // host dropped — self-terminate
                (a, m) => {
                    if let Some(e) = a {
                        e.increment_epoch();
                    }
                    if let Some(e) = m {
                        e.increment_epoch();
                    }
                }
            }
        })
        .expect("spawn epoch-ticker thread");
}

/// Guards against a claim leak on a FAILED load. Guest code can run — and call
/// ANY host import, including `host-connection.ensure` — from the moment
/// `instantiate_async` starts the component (its own `start` function) through
/// `call_metadata` and `call_setup`, all BEFORE `load` has committed to
/// returning a handle the caller will ever hand to `register_for_events` (and
/// therefore, later, to `TractorNative::unregister`). If a later `?` aborts the
/// load — a manifest/runtime mismatch, a `setup()` failure — this plugin id is
/// never registered, so nothing would otherwise release a claim it minted
/// during init: a permanent leak, and for a connection like `serpro-vpn` a
/// claim that silently keeps a live tunnel from ever falling.
///
/// Armed from construction; releases this plugin id's claims on `Drop` UNLESS
/// `disarm()` was already called. `disarm()` is the LAST thing `load` does once
/// `call_setup` has actually succeeded, so a genuinely successful load keeps
/// whatever the plugin legitimately holds — this only fires on the failure
/// paths in between.
struct ReleaseClaimsOnLoadFailure<'a> {
    registry: &'a crate::host::host_effects_bridge::ConnectionRegistry,
    plugin_id: &'a str,
    armed: bool,
}

impl<'a> ReleaseClaimsOnLoadFailure<'a> {
    fn new(
        registry: &'a crate::host::host_effects_bridge::ConnectionRegistry,
        plugin_id: &'a str,
    ) -> Self {
        Self { registry, plugin_id, armed: true }
    }

    fn disarm(mut self) {
        self.armed = false;
    }
}

impl Drop for ReleaseClaimsOnLoadFailure<'_> {
    fn drop(&mut self) {
        if self.armed {
            self.registry.release_owner(self.plugin_id);
        }
    }
}

impl PluginHost {
    pub fn new(
        trust: TrustManager,
        telemetry: TelemetryBus,
        on_event_budget_ms: u64,
    ) -> Result<Self> {
        let mut config = Config::new();
        config.async_support(true);
        config.wasm_component_model(true);
        // Epoch interruption is the ONLY mechanism that can break a guest that
        // busy-loops with no await points (a tokio timeout never fires because the
        // wedged guest future never yields). The per-store deadline is set before
        // each guest call (see PluginInstanceHandle::call_on_event); a global
        // ticker below advances the shared epoch clock.
        config.epoch_interruption(true);
        let engine = Arc::new(Engine::new(&config)?);

        // ── Regular plugin linker ──────────────────────────────────────────
        // Two variants, differing ONLY in wasi:http: a plugin GRANTED
        // network:outbound instantiates against `linker` (http linked); one that
        // did not declare it (under Strict) instantiates against `linker_no_http`,
        // so a wasi:http import fails to resolve at instantiate time — the grant
        // becomes a real WASI enforcement boundary, not just an advisory bool.
        let mut linker_no_http: Linker<TractorStore> = Linker::new(&engine);
        wasmtime_wasi::add_to_linker_async(&mut linker_no_http)?;
        HostPlugin::add_to_linker(&mut linker_no_http, |s| &mut s.bindings)?;

        let mut linker: Linker<TractorStore> = Linker::new(&engine);
        wasmtime_wasi::add_to_linker_async(&mut linker)?;
        wasmtime_wasi_http::add_only_http_to_linker_async(&mut linker)?;
        HostPlugin::add_to_linker(&mut linker, |s| &mut s.bindings)?;

        // ── host-effects.wasm linker ────────────────────────────────────────
        // Does NOT include tractor-bridge (host-effects is not an integration plugin).
        // Includes WASI (for std::fs → wasi:filesystem) + host-spawn (for OS fork/exec).
        let mut host_effects_linker: Linker<TractorStore> = Linker::new(&engine);
        wasmtime_wasi::add_to_linker_async(&mut host_effects_linker)?;
        atb::HostEffectsHost::add_to_linker(
            &mut host_effects_linker,
            |s| &mut s.bindings,
        )?;

        // ── P1 plain module linker (ADR-061) ──────────────────────────────
        // P1 modules use blocking WASI calls — they cannot share the async engine.
        // A dedicated sync engine (async_support=false, component_model=false) is
        // used so that Linker::instantiate and TypedFunc::call both run synchronously.
        // Epoch interruption is enabled here too so a wedged P1 module on_event
        // (a sync TypedFunc::call) traps on deadline just like a component does.
        let mut module_config = Config::new();
        module_config.epoch_interruption(true);
        let module_engine = Arc::new(Engine::new(&module_config)?);
        let mut module_linker: wasmtime::Linker<P1Store> = wasmtime::Linker::new(&module_engine);
        wasmtime_wasi::preview1::add_to_linker_sync(&mut module_linker, |s: &mut P1Store| &mut s.wasi)?;

        // Global epoch ticker: one background thread advances the shared epoch
        // clock ~every 1ms for BOTH engines. increment_epoch() is &self + Send +
        // Sync (a cheap atomic add), so a single ticker serves all plugins across
        // all their runner threads — the epoch is a shared logical clock, not
        // per-store. Held via Weak so the thread self-terminates once the host is
        // dropped (both engines gone) rather than leaking. A std::thread (not
        // tokio::spawn) keeps this independent of any runtime context at new().
        spawn_epoch_ticker(&engine, &module_engine);

        Ok(Self {
            trust,
            telemetry,
            engine,
            linker: Arc::new(linker),
            linker_no_http: Arc::new(linker_no_http),
            host_effects_linker: Arc::new(host_effects_linker),
            module_engine,
            module_linker: Arc::new(module_linker),
            component_cache: Arc::new(std::sync::RwLock::new(std::collections::HashMap::new())),
            on_event_budget_ms,
            // Resolve the effect policy + model route (+ optional fallback route)
            // from env ONCE here at boot; every TractorNativeBindings gets a clone
            // at load. No hot-path env read.
            effect_policy: crate::host::host_effects_bridge::HostEffectPolicy::from_env(),
            // Grants resolve PER-LOAD (where `sync` exists), from fs ∩ node
            // (deny-dominates — B). `new` has no `sync`, so it records the intent;
            // the boot fs-only reads moved into `resolve_*_at_load`, which preserves
            // the same fail-shut (trusted) / fail-open (approved) posture on a bad file.
            trusted_plugins_source: GrantSource::ResolveFromConfig,
            approved_permissions_source: GrantSource::ResolveFromConfig,
            under_development_source: GrantSource::ResolveFromConfig,
            model_route: crate::host::wasi_bridge::ModelRoute::from_env(),
            fallback_route: crate::host::wasi_bridge::ModelRoute::fallback_from_env(),
            // Wired by the runtime via `with_cross_plugin` once its registry + router
            // exist. `new` has no runtime context, so it starts None (pre-registry
            // behavior: empty tool list, `get_plugin_api` NotFound).
            cross_plugin: None,
            // ONE registry for the whole host, constructed exactly once here — see
            // the field doc on `connection_registry` for why this must never be
            // constructed per-bindings instead.
            connection_registry: Arc::new(crate::host::host_effects_bridge::ConnectionRegistry::new()),
        })
    }

    /// Release every claim a departed plugin held on shared connections. The single
    /// production caller is `TractorNative::unregister` (lib.rs) — the one clean
    /// unload point for a plugin, whether it is a normal unload, a hot-reload
    /// (unregister + reload), or a revocation. A claim that outlives its holder is
    /// the leak the design forbids: another plugin sharing the same connection must
    /// see this plugin's interest drop, while the connection itself follows its
    /// declared `linger` policy (unaffected here — `release_owner` only touches the
    /// claim set, never the process).
    pub fn release_connection_claims(&self, plugin_id: &str) {
        self.connection_registry.release_owner(plugin_id);
    }

    /// Override the sovereign trusted-plugins allowlist that seeds the Strict load
    /// gate. The default (`new`) reads it fs-first from `.refarm/config.json`; this
    /// injects it explicitly — for a host that resolves trust another way, and for
    /// tests that must exercise the gate deterministically without a config file in
    /// the process cwd. `None` = not-configured (permissive), `Some(set)` = enforce
    /// exactly that set (`*` = all, empty = deny-all).
    pub fn with_trusted_plugins(
        mut self,
        trusted: Option<std::collections::HashSet<String>>,
    ) -> Self {
        self.trusted_plugins_source = GrantSource::Injected(trusted);
        self
    }

    /// Override the operator-approved capability sets that narrow declared
    /// permissions at load (the persona approval loop's enforcement half). Default
    /// (`new`) reads them fs-first from `.refarm/config.json`; this injects them
    /// explicitly for tests / alternate hosts. `None` = no scoping (declared
    /// stands); `Some(map)` scopes a plugin present in the map to declared ∩ its
    /// approved set.
    pub fn with_approved_permissions(
        mut self,
        approved: Option<
            std::collections::HashMap<String, std::collections::HashSet<String>>,
        >,
    ) -> Self {
        self.approved_permissions_source = GrantSource::Injected(approved);
        self
    }

    /// Override which plugins (by runtime id, `*` for every plugin) this host treats as
    /// under development — the waiver `verify_wasm_integrity` consults for an ABSENT
    /// integrity claim only (never a wrong one). The default (`new`) reads it fs-first
    /// from `.refarm/config.json`'s `pluginDevelopment`; this injects it explicitly — for
    /// tests that load a manifest-less or unsigned artifact deterministically, without a
    /// config file in the process cwd. `None` = nothing declared (CLOSED, waives nothing);
    /// `Some(set)` = exactly those runtime ids (or all, under `*`) are waived.
    pub fn with_under_development(mut self, declared: Option<std::collections::HashSet<String>>) -> Self {
        self.under_development_source = GrantSource::Injected(declared);
        self
    }

    /// Wire the shared cross-plugin access (registry + router handles) the runtime
    /// owns, so every plugin loaded by this host can list/invoke OTHER loaded plugins'
    /// verbs (the agent leg #6 `capability-tools`) and resolve a named API
    /// (`get_plugin_api`). Called once by the runtime after it builds its registry +
    /// router. Absent this call the host keeps pre-registry behavior.
    pub fn with_cross_plugin(
        mut self,
        cross_plugin: crate::host::wasi_bridge::CrossPluginAccess,
    ) -> Self {
        self.cross_plugin = Some(cross_plugin);
        self
    }

    /// Return the compiled Component for the given wasm bytes, compiling+caching
    /// it on first use. Keyed by the content hash (`wasm_hash`), so a rebuilt
    /// plugin at the same path misses the cache and recompiles (no stale code),
    /// while a repeat load of identical bytes (e.g. the N-store pool) skips the
    /// ~200ms Cranelift compile. Compiles from the already-read bytes (not the
    /// file) so the compiled component matches the hashed bytes — no second disk
    /// read, no TOCTOU. Component is Arc-backed, so the clone is cheap.
    /// Number of distinct compiled components in the cache. Test-only, so a test
    /// can assert dedup-by-hash (same bytes → one entry) and recompile-on-change
    /// (new bytes → a new entry) without timing.
    #[cfg(test)]
    pub(crate) fn component_cache_len(&self) -> usize {
        self.component_cache
            .read()
            .expect("component_cache poisoned")
            .len()
    }

    fn cached_component(&self, wasm_hash: &str, bytes: &[u8]) -> Result<Component> {
        if let Some(component) = self
            .component_cache
            .read()
            .expect("component_cache poisoned")
            .get(wasm_hash)
        {
            return Ok(component.clone());
        }
        let component = Component::from_binary(&self.engine, bytes)?;
        {
            let mut cache = self.component_cache.write().expect("component_cache poisoned");
            // Bound the cache so a hot-reload loop (each rebuild = new bytes = new
            // hash) can't accumulate compiled components without limit (§7: 8GB
            // ceiling). Keyed by content hash, so distinct blobs are what grow it.
            // When full, drop one existing entry before inserting — the miss just
            // recompiles next time, which is correct, not a leak. Cap is generous
            // (far more than any real plugin set) so steady-state never evicts.
            const MAX_CACHED_COMPONENTS: usize = 64;
            if cache.len() >= MAX_CACHED_COMPONENTS && !cache.contains_key(wasm_hash) {
                if let Some(evict) = cache.keys().next().cloned() {
                    cache.remove(&evict);
                    tracing::debug!(evicted = %evict, "component cache full — evicted one entry");
                }
            }
            cache.insert(wasm_hash.to_string(), component.clone());
        }
        Ok(component)
    }

    /// Load a regular integration plugin (`.wasm` Component).
    ///
    /// Uses the regular linker: tractor-bridge + host-fs/shell host primitives.
    /// Fase 3 TODO: if `host_effects` is loaded, compose host-fs/shell from it
    /// instead of the host primitive — see HANDOFF.md Tarefa 2B.
    /// Narrow a plugin's DECLARED permission set to what the operator APPROVED for
    /// it (declared ∩ approved) — the enforcement half of the persona approval loop.
    /// Approval is opt-in scoping: if no approvals are configured, or this plugin has
    /// no approved entry, the declared set stands unchanged (backward-compatible).
    /// A plugin WITH an approved entry runs with only the intersection, so approving
    /// fewer capabilities really restricts what the Gate A/B/C enforcement grants.
    /// Resolve the trusted-plugins allowlist for THIS load. An injected override wins
    /// verbatim (deterministic test path); otherwise resolve from fs ∩ node
    /// (deny-dominates — B), preserving the boot posture: an unreadable config denies
    /// rather than opens (deny-all under Strict), never silently trusting everything.
    fn resolve_trusted_at_load(
        &self,
        base: &Path,
        sync: &NativeSync,
    ) -> Option<std::collections::HashSet<String>> {
        match &self.trusted_plugins_source {
            GrantSource::Injected(v) => v.clone(),
            GrantSource::ResolveFromConfig => {
                crate::host::host_effects_bridge::resolve_trusted_plugins(base, Some(sync))
                    .unwrap_or_else(|e| {
                        tracing::warn!(error = %e, "trusted_plugins config unreadable — treating as deny-all");
                        Some(std::collections::HashSet::new())
                    })
            }
        }
    }

    /// Resolve the approved-permissions map for THIS load. An injected override wins
    /// verbatim; otherwise resolve from fs ∩ node (deny-dominates). Approval scoping is
    /// additive (it only NARROWS declared), so an unreadable config falls open to None
    /// = no scoping (declared stands) — a bad file must not silently drop capabilities;
    /// the trusted gate still governs whether the plugin loads at all.
    fn resolve_approved_at_load(
        &self,
        base: &Path,
        sync: &NativeSync,
    ) -> Option<std::collections::HashMap<String, std::collections::HashSet<String>>> {
        match &self.approved_permissions_source {
            GrantSource::Injected(v) => v.clone(),
            GrantSource::ResolveFromConfig => {
                crate::host::host_effects_bridge::resolve_approved_permissions(base, Some(sync))
                    .unwrap_or_else(|e| {
                        tracing::warn!(error = %e, "approvedPermissions config unreadable — no capability scoping applied");
                        None
                    })
            }
        }
    }

    /// Resolve whether THIS node has declared it is developing `plugin_id` — the third
    /// declaration this load path resolves at THIS point, beside `resolve_trusted_at_load`
    /// and `resolve_approved_at_load` just above. An injected override (test/alt-host path,
    /// `with_under_development`) wins verbatim; otherwise read straight from the sovereign
    /// fs config (Task 6's `pluginDevelopment`, see `plugin_development_declares`) — no
    /// node/CRDT side, because developing a plugin is a statement about THIS machine, not a
    /// grant meant to converge across devices.
    ///
    /// UNLIKE its two siblings above (which fall PERMISSIVE on an unreadable config — see
    /// their docs), this one fails CLOSED on every branch: an absent sovereign config, an
    /// unreadable one, a malformed `pluginDevelopment`, or an injected `None` all land on
    /// `false` — "not declared". A declaration only ever WIDENS what may load (an
    /// absent-integrity plugin), so falling open on a config bug would recreate exactly the
    /// silent-consent failure this task exists to close.
    ///
    /// `id_is_from_manifest` gates the `ResolveFromConfig` branch ONLY: when `plugin_id` is the
    /// guessed file-stem fallback (no manifest was found), it is `false` and this ALWAYS answers
    /// `false` without ever reading the config — every real `--plugin` argument is
    /// `.../refarm_<name>/plugin.wasm`, so that guess is the literal string "plugin" for EVERY
    /// manifest-less artifact on the node (`RequestedPluginEntry`'s doc, lib.rs). Consulting the
    /// operator's declaration under that guessed key would let one `refarm plugin develop plugin`
    /// waive the integrity gate for every manifest-less artifact at once — an id that cannot be
    /// known must not be guessed into one that collides. `GrantSource::Injected` is UNAFFECTED
    /// (its callers are the mechanics-test harness, never a real declaration keyed by a guessed
    /// id): a wildcard override still bypasses the gate for a manifest-less fixture on purpose.
    fn resolve_under_development_at_load(
        &self,
        base: &Path,
        plugin_id: &str,
        id_is_from_manifest: bool,
    ) -> bool {
        match &self.under_development_source {
            GrantSource::Injected(v) => v
                .as_ref()
                .is_some_and(|set| set.contains("*") || set.contains(plugin_id)),
            GrantSource::ResolveFromConfig => {
                if !id_is_from_manifest {
                    return false;
                }
                match crate::host::host_effects_bridge::read_refarm_config_value_at(base) {
                    Ok(Some(cfg)) => plugin_development_declares(&cfg, plugin_id),
                    Ok(None) => false,
                    Err(e) => {
                        tracing::warn!(
                            error = %e,
                            "pluginDevelopment config unreadable — treating as not under development"
                        );
                        false
                    }
                }
            }
        }
    }

    /// Narrow a plugin's declared permissions to the operator-approved set (declared ∩
    /// approved). `approved` is the per-load-resolved map (fs ∩ node). None (no map) or a
    /// plugin absent from the map → declared stands unchanged (additive scoping).
    fn scope_to_approved(
        approved: Option<&std::collections::HashMap<String, std::collections::HashSet<String>>>,
        plugin_id: &str,
        declared: std::collections::HashSet<String>,
    ) -> std::collections::HashSet<String> {
        let Some(approvals) = approved else {
            return declared;
        };
        let Some(approved) = approvals.get(plugin_id) else {
            return declared;
        };
        declared.intersection(approved).cloned().collect()
    }

    /// Whether the sovereign trusted_plugins allowlist admits this plugin to load
    /// under Strict, WITHOUT a per-hash trust grant. Semantics mirror the shell
    /// gate:
    ///   - None (not configured) → permissive: everything loads (backward-compat).
    ///   - contains `*`          → trust every plugin.
    ///   - contains the id       → trust this plugin.
    ///   - otherwise (incl. `[]`)→ deny (the id is not listed).
    ///
    /// The operator of THIS device is authoritative over their own local plugins,
    /// so a config-declared trust is a standing "yes" — no separate grant needed.
    ///
    /// G: a REVOKED id is denied even when the allowlist admits it (including under `*`).
    /// The tombstone is a monotonic add-only fact, so deny dominates the wildcard —
    /// `{*} − {vault}` denies `vault`. `revoked` is the resolved-at-load tombstone set.
    fn trusted_to_load(
        trusted: Option<&std::collections::HashSet<String>>,
        revoked: &std::collections::HashSet<String>,
        plugin_id: &str,
    ) -> bool {
        let id = plugin_id.to_ascii_lowercase();
        if revoked.iter().any(|r| r.to_ascii_lowercase() == id) {
            return false; // deny dominates: a revoked id never loads, even under `*`
        }
        match trusted {
            None => true,
            Some(allow) => allow.contains("*") || allow.contains(&id),
        }
    }

    pub async fn load(&self, path: &Path, sync: &NativeSync) -> Result<PluginInstanceHandle> {
        let manifest = read_runtime_plugin_manifest(path)?;
        // Kept separate from `plugin_id` below: this is `Some` ONLY where the id is a REAL
        // identity read from a manifest, never the guessed file-stem fallback. The development
        // gate (just below) must consult the config ONLY through this id — see its call site.
        let manifest_plugin_id =
            manifest.as_ref().map(|m| manifest_runtime_plugin_id(&m.id).to_string());
        let plugin_id = manifest_plugin_id.clone().unwrap_or_else(|| {
            path.file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("unknown")
                .to_string()
        });

        tracing::info!(plugin_id = %plugin_id, path = %path.display(), "Loading plugin");
        anyhow::ensure!(path.exists(), "Plugin file not found: {}", path.display());

        let bytes = tokio::fs::read(path).await?;
        let wasm_hash = hex::encode(Sha256::digest(&bytes));
        tracing::debug!(plugin_id = %plugin_id, wasm_hash = %wasm_hash, "Plugin hash computed");

        // `grant_base` is needed by the integrity check below (for `under_development`)
        // as well as the trust/approval grants further down — resolved once, ahead of
        // all three, rather than duplicated at each call site.
        let grant_base = crate::host::plugin_host::config_node::declared_base();

        // Integrity-at-load (E): a tampered artifact at a trusted id must not run. The
        // manifest's declared hash was written at install; verify the bytes on disk
        // match it. No declared integrity → Ok only where THIS node declared it is
        // developing this plugin (see `verify_wasm_integrity` / `plugin_development_declares`).
        //
        // `manifest_plugin_id.is_some()` tells the resolver below whether `plugin_id` is a REAL
        // identity or the guessed file-stem fallback ("plugin", for EVERY manifest-less artifact
        // — see the resolver's own doc for why that guess must never reach the config-declared
        // lookup).
        let under_development = self.resolve_under_development_at_load(
            &grant_base,
            &plugin_id,
            manifest_plugin_id.is_some(),
        );
        verify_wasm_integrity(
            manifest.as_ref().and_then(|m| m.integrity.as_deref()),
            &wasm_hash,
            &plugin_id,
            under_development,
        )?;

        // Resolve the sovereign grants for THIS load, where `sync` exists (B): the
        // trusted allowlist + the approved-permissions map, each fs ∩ node
        // (deny-dominates). Resolved ONCE per load and threaded into the trust gate,
        // the approval scoping, AND the shell-effect bindings — one source of truth.
        let trusted_at_load = self.resolve_trusted_at_load(&grant_base, sync);
        let approved_at_load = self.resolve_approved_at_load(&grant_base, sync);
        // G: the revocation tombstones for this load. Denies a revoked id at the trust
        // gate even under a `*` wildcard (approved-cap revocations are already subtracted
        // inside resolve_approved_at_load).
        let revoked_at_load =
            crate::host::host_effects_bridge::resolve_revocations(Some(sync)).plugins;

        // The plugin's declared permissions (from its manifest) + the host
        // security mode form its capability grant. Built once here so BOTH load
        // paths (component + P1 module) scope their filesystem preopen to the fs
        // grant (Gate B) and share one construction.
        let declared_permissions: std::collections::HashSet<String> = manifest
            .as_ref()
            .map(|m| m.permissions.iter().cloned().collect())
            .unwrap_or_default();
        // The operator-approved capability set NARROWS the declared set (the persona
        // approval loop): when this plugin has an approved entry, the effective grant
        // is declared ∩ approved, so approving fewer capabilities actually restricts.
        // No approvals configured, or this plugin not approved → declared stands
        // (approval is opt-in scoping, backward-compatible).
        let effective_permissions =
            Self::scope_to_approved(approved_at_load.as_ref(), &plugin_id, declared_permissions);
        let permission_grant = crate::host::wasi_bridge::PermissionGrant::new(
            effective_permissions,
            self.trust.security_mode().clone(),
        );

        // ── WASI variant probe (ADR-061) ──────────────────────────────────────
        let variant = crate::host::wasi_variant::probe_bytes(&bytes)
            .ok_or_else(|| anyhow::anyhow!("{} is not a valid WASM module or component", path.display()))?;
        tracing::info!(plugin_id = %plugin_id, variant = %variant, "WASI variant detected");

        if variant == crate::host::wasi_variant::WasiVariant::Module {
            return self
                .load_module(
                    path,
                    &bytes,
                    &plugin_id,
                    &wasm_hash,
                    &permission_grant,
                    trusted_at_load.as_ref(),
                    &revoked_at_load,
                    sync,
                )
                .await;
        }

        if self.trust.security_mode() == &SecurityMode::Strict
            && !self.trust.has_valid_grant(&plugin_id, Some(&wasm_hash))
            && !Self::trusted_to_load(trusted_at_load.as_ref(), &revoked_at_load, &plugin_id)
        {
            anyhow::bail!(
                "SecurityMode::Strict: plugin '{}' (hash: {}) is neither trust-granted \
                 nor in the sovereign trusted_plugins allowlist",
                plugin_id,
                wasm_hash
            );
        }

        let base = crate::host::plugin_host::config_node::declared_base();
        let env_vars = plugin_env_vars_from(&base, Some(sync));
        let config_json = refarm_config_json_from(&base);
        let mut wasi_builder = WasiCtxBuilder::new();
        wasi_builder.inherit_stderr();
        for (k, v) in &env_vars {
            wasi_builder.env(k, v);
        }
        // Scope the filesystem preopen to the fs grant (Gate B); the grant was
        // built once in `load()` above.
        preopen_plugin_runtime_dirs(&mut wasi_builder, &permission_grant)?;
        let wasi = wasi_builder.build();
        let table = ResourceTable::new();
        let http = wasmtime_wasi_http::WasiHttpCtx::new();
        // Pick the linker BEFORE the grant moves into bindings: a plugin granted
        // network:outbound gets wasi:http; one that wasn't (Strict + undeclared)
        // gets the http-less linker, so a wasi:http import fails to resolve.
        // Typed against the canonical vocabulary — the capability can't be a typo.
        let grant_network =
            permission_grant.grants_permission(crate::host::permission::Permission::NetworkOutbound);
        let bindings = TractorNativeBindings::new(
            &plugin_id,
            sync.clone(),
            self.telemetry.clone(),
            self.effect_policy.clone(),
            self.model_route.clone(),
            self.fallback_route.clone(),
            permission_grant,
            trusted_at_load,
            self.cross_plugin.clone(),
            self.connection_registry.clone(),
        );

        // Armed from here: guest code can run (and mint a connection claim) from
        // `instantiate_async` onward, before this plugin is ever registered. See
        // `ReleaseClaimsOnLoadFailure`'s doc.
        let claim_guard = ReleaseClaimsOnLoadFailure::new(&self.connection_registry, &plugin_id);

        let component = self.cached_component(&wasm_hash, &bytes)?;
        // Armed-at-creation: epoch_interruption(true) makes an un-armed store trap
        // during the component's own instantiate/start (heavy guest init for jco).
        // new_armed_store makes forgetting to arm unrepresentable.
        let mut store = crate::host::instance::new_armed_store(
            &self.engine,
            TractorStore { wasi, http, bindings, table, epoch_guard: EpochGuard::new() },
        );

        let linker = if grant_network {
            &self.linker
        } else {
            &self.linker_no_http
        };
        let plugin =
            HostPlugin::instantiate_async(&mut store, &component, linker).await?;

        // The capability profile (the registry aggregate) is built ONCE from the
        // manifest; `concurrent_safe` + `requires_api` ride alongside it but stay
        // separate (they feed the runner + the requires-api map, not the profile).
        let (profile, concurrent_safe, requires_api) = if let Some(manifest) = manifest.as_ref() {
            let metadata = plugin.plugin_host_integration().call_metadata(&mut store).await?;
            validate_manifest_runtime_alignment(&plugin_id, &metadata, manifest)?;
            (
                capability_profile_from_manifest(&manifest.capabilities, &plugin_id),
                manifest.capabilities.concurrent_safe,
                manifest.capabilities.requires_api.clone(),
            )
        } else {
            tracing::warn!(
                plugin_id = %plugin_id,
                path = %path.display(),
                "plugin manifest not found near wasm; skipping manifest/runtime alignment checks"
            );
            (
                crate::host::plugin_registry::PluginCapabilityProfile::default(),
                false,
                vec![],
            )
        };

        let mut handle = PluginInstanceHandle::new_component(
            plugin_id.clone(),
            plugin,
            store,
            self.telemetry.clone(),
            profile,
        )
        .with_concurrent_safe(concurrent_safe)
        .with_requires_api(requires_api)
        .with_on_event_budget_ms(self.on_event_budget_ms);
        handle.call_setup().await?;
        // `call_setup` succeeded: the plugin is about to be returned to the
        // caller, which registers it (and, eventually, unregisters it — the path
        // that normally releases its connection claims). From here on, nothing
        // remaining in `load` can abort it, so any claim minted during init is a
        // legitimate one this plugin now owns, not a leak.
        claim_guard.disarm();

        if let Err(e) = store_refarm_config_node(sync, config_json.as_ref()) {
            tracing::warn!(plugin_id = %plugin_id, error = %e, "failed to store RefarmConfig node");
        }
        if let Err(e) = materialize_revocation_tombstones(sync, config_json.as_ref()) {
            tracing::warn!(plugin_id = %plugin_id, error = %e, "failed to materialize revocation tombstones");
        }
        // E3: publish the plugin pointer (id -> hash + manifest) so an orphan-grant
        // device can resolve and load this plugin by hash. Rides the same CRDT node map
        // as the grant, so it replicates with it. Best-effort — never blocks the load.
        if let Some(raw_manifest) = read_runtime_plugin_manifest_raw(path) {
            if let Err(e) = crate::host::plugin_host::plugin_pointer_node::materialize_plugin_pointer(
                sync,
                &plugin_id,
                &wasm_hash,
                &raw_manifest,
            ) {
                tracing::warn!(plugin_id = %plugin_id, error = %e, "failed to materialize plugin pointer");
            }
        }

        self.telemetry.emit_named(
            "plugin:loaded",
            Some(plugin_id.clone()),
            Some(serde_json::json!({
                "path": path.to_string_lossy(),
                "wasm_hash": wasm_hash,
            })),
        );

        tracing::info!(plugin_id = %plugin_id, "Plugin loaded and setup() called");
        Ok(handle)
    }

    /// Load a WASI P1 plain module (ADR-061 ModuleLoader path).
    ///
    /// P1 modules export plain WASM functions with no WIT bindings:
    ///   - `memory`           — required: the module's linear memory
    ///   - `alloc(i32) -> i32` — required: allocate bytes, return pointer
    ///   - `setup()`          — optional: called once after load
    ///   - `on_event(ptr: i32, len: i32)` — required: receive JSON event payload
    ///   - `ingest() -> i32`  — optional: trigger data ingestion, return count
    ///   - `teardown()`       — optional: clean up before unload
    #[allow(clippy::too_many_arguments)]
    async fn load_module(
        &self,
        path: &Path,
        bytes: &[u8],
        plugin_id: &str,
        wasm_hash: &str,
        permission_grant: &crate::host::wasi_bridge::PermissionGrant,
        trusted: Option<&std::collections::HashSet<String>>,
        revoked: &std::collections::HashSet<String>,
        sync: &NativeSync,
    ) -> Result<PluginInstanceHandle> {
        tracing::info!(plugin_id, "Loading P1 plain module (WASI preview1 ABI)");

        if self.trust.security_mode() == &SecurityMode::Strict
            && !self.trust.has_valid_grant(plugin_id, Some(wasm_hash))
            && !Self::trusted_to_load(trusted, revoked, plugin_id)
        {
            anyhow::bail!(
                "SecurityMode::Strict: P1 module '{}' (hash: {}) is neither trust-granted \
                 nor in the sovereign trusted_plugins allowlist",
                plugin_id,
                wasm_hash
            );
        }

        let base = crate::host::plugin_host::config_node::declared_base();
        let env_vars = plugin_env_vars_from(&base, Some(sync));
        let config_json = refarm_config_json_from(&base);

        let wasi_p1 = {
            let mut builder = WasiCtxBuilder::new();
            builder.inherit_stderr();
            for (k, v) in &env_vars {
                builder.env(k, v);
            }
            preopen_plugin_runtime_dirs(&mut builder, permission_grant)?;
            builder.build_p1()
        };

        let module = Module::from_binary(&self.module_engine, bytes)?;
        // Armed-at-creation (see new_armed_store): module init runs guest code that
        // would trap on the default-0 deadline. Cheap for a plain module, but the
        // same factory keeps arming impossible to forget.
        let mut store = crate::host::instance::new_armed_store(
            &self.module_engine,
            P1Store { wasi: wasi_p1, epoch_guard: EpochGuard::new() },
        );
        let instance = self.module_linker.instantiate(&mut store, &module)?;

        // A P1 module surfaces only `provides` (no WIT integration → no dispatchable
        // verbs / prompts / schemas); the rest of the profile stays default.
        let provides = read_runtime_plugin_manifest(path)?
            .map(|m| m.capabilities.provides)
            .unwrap_or_default();
        let profile = crate::host::plugin_registry::PluginCapabilityProfile {
            provides,
            ..Default::default()
        };

        let mut handle = PluginInstanceHandle::new_module(
            plugin_id.to_string(),
            instance,
            store,
            self.telemetry.clone(),
            profile,
        )
        .with_on_event_budget_ms(self.on_event_budget_ms);
        handle.call_setup().await?;

        if let Err(e) = store_refarm_config_node(sync, config_json.as_ref()) {
            tracing::warn!(plugin_id, error = %e, "failed to store RefarmConfig node");
        }

        self.telemetry.emit_named(
            "plugin:loaded",
            Some(plugin_id.to_string()),
            Some(serde_json::json!({
                "path": path.to_string_lossy(),
                "wasm_hash": wasm_hash,
                "variant": "p1-module",
            })),
        );

        tracing::info!(plugin_id, "P1 module loaded and setup() called");
        Ok(handle)
    }

    /// Load host-effects.wasm — the composition component that exports host-fs + host-shell.
    ///
    /// Uses a dedicated linker with WASI + host-spawn (no tractor-bridge).
    /// The returned `HostEffectsHandle` is stored by the caller (daemon/manager)
    /// for future Fase 3 composition with agent.wasm.
    pub async fn load_host_effects(&self, path: &Path, sync: &NativeSync) -> Result<HostEffectsHandle> {
        let plugin_id = "host-effects".to_string();

        tracing::info!(path = %path.display(), "Loading host-effects.wasm");
        anyhow::ensure!(path.exists(), "host-effects.wasm not found: {}", path.display());

        let bytes = tokio::fs::read(path).await?;
        let wasm_hash = hex::encode(Sha256::digest(&bytes));

        let wasi = WasiCtxBuilder::new().inherit_stderr().build();
        let table = ResourceTable::new();
        let http = wasmtime_wasi_http::WasiHttpCtx::new();
        let bindings = TractorNativeBindings::new(
            &plugin_id,
            sync.clone(),
            self.telemetry.clone(),
            self.effect_policy.clone(),
            self.model_route.clone(),
            self.fallback_route.clone(),
            // host-effects.wasm is a host-provided composition component, not a
            // manifest-declared plugin — permissive grant, and no trust allowlist
            // gating (the host's own effect surface).
            crate::host::wasi_bridge::PermissionGrant::permissive(),
            None,
            // Not a dispatchable plugin — no cross-plugin surface.
            None,
            self.connection_registry.clone(),
        );

        let component = Component::from_file(&self.engine, path)?;
        // Armed-at-creation (see new_armed_store): host-effects is a component whose
        // start runs guest code that would trap on the default-0 deadline.
        let mut store = crate::host::instance::new_armed_store(
            &self.engine,
            TractorStore { wasi, http, bindings, table, epoch_guard: EpochGuard::new() },
        );

        let host_effects = atb::HostEffectsHost::instantiate_async(
            &mut store,
            &component,
            &self.host_effects_linker,
        )
        .await?;

        self.telemetry.emit_named(
            "host-effects:loaded",
            Some(plugin_id.clone()),
            Some(serde_json::json!({ "wasm_hash": wasm_hash })),
        );

        tracing::info!(wasm_hash = %wasm_hash, "host-effects.wasm loaded");
        Ok(HostEffectsHandle::new(plugin_id, host_effects, store))
    }
}

#[cfg(test)]
#[path = "../plugin_host_tests.rs"]
mod tests;

#[cfg(test)]
mod capability_tests {
    use super::*;

    fn minimal_manifest(extra_json: &str) -> RuntimePluginManifest {
        let json = format!(
            r#"{{"id":"@test/plugin","version":"0.1.0","entry":"plugin.wasm",
                "observability":{{"hooks":["onLoad","onInit","onRequest","onError","onTeardown"]}}
                {}}}"#,
            if extra_json.is_empty() { String::new() } else { format!(",{extra_json}") }
        );
        serde_json::from_str(&json).expect("valid manifest JSON")
    }

    #[test]
    fn manifest_without_capabilities_defaults_to_empty() {
        let m = minimal_manifest("");
        assert!(m.capabilities.provides.is_empty());
    }

    #[test]
    fn manifest_with_observe_host_effects_capability() {
        let m = minimal_manifest(r#""capabilities":{"provides":["observe-host-effects"]}"#);
        assert!(m.capabilities.provides.contains(&"observe-host-effects".to_string()));
    }

    #[test]
    fn manifest_with_multiple_capabilities() {
        let m = minimal_manifest(r#""capabilities":{"provides":["observe-host-effects","audit-log"]}"#);
        assert_eq!(m.capabilities.provides.len(), 2);
        assert!(m.capabilities.provides.contains(&"observe-host-effects".to_string()));
    }

    #[test]
    fn plugin_key_from_id_takes_the_last_segment() {
        assert_eq!(plugin_key_from_id("@scope/vault"), "vault");
        assert_eq!(plugin_key_from_id("@devbench/coding-agent"), "coding-agent");
        assert_eq!(plugin_key_from_id("plain-id"), "plain-id");
    }

    #[test]
    fn verbs_block_lowers_with_inferred_key_and_implicit_dispatch() {
        // id @test/plugin → inferred key "plugin"; a non-empty block derives plugin:dispatch.
        let m = minimal_manifest(
            r#""capabilities":{"verbs":{"list":{"search":{},"extract":{}}}}"#,
        );
        let profile = capability_profile_from_manifest(&m.capabilities, "@test/plugin");
        assert_eq!(
            profile.provides,
            vec!["plugin:extract", "plugin:search", "plugin:dispatch"],
            "verbs sorted, then the derived dispatch channel"
        );
        assert_eq!(profile.subscribes, vec!["plugin:dispatch"]);
    }

    #[test]
    fn verbs_block_explicit_key_overrides_the_id_inference() {
        let m = minimal_manifest(
            r#""capabilities":{"verbs":{"key":"agent","list":{"code":{},"review":{}}}}"#,
        );
        let profile = capability_profile_from_manifest(&m.capabilities, "@devbench/coding-agent");
        assert_eq!(profile.provides, vec!["agent:code", "agent:review", "agent:dispatch"]);
        assert_eq!(profile.subscribes, vec!["agent:dispatch"]);
    }

    #[test]
    fn real_agent_manifest_makes_respond_a_dispatchable_verb() {
        // The load-bearing assertion for agent→agent DELEGATION: the ACTUAL agent
        // plugin.json must lower into a dispatchable `agent:respond`. If the verbs block
        // is dropped or malformed, respond stops being invokable by another agent and
        // delegation silently breaks — so pin it against the real manifest, not a fixture.
        // The agent plugin.json is a TEMPLATE — `entry`/`integrity` are injected at
        // install time, so the strict RuntimePluginManifest deserializer (entry
        // required) can't read it. Parse the raw JSON and lift `id` + `capabilities`,
        // which is all the lowering depends on.
        let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("../agent/plugin.json");
        let raw = std::fs::read_to_string(&path).expect("agent plugin.json reads");
        let value: serde_json::Value = serde_json::from_str(&raw).expect("agent plugin.json is JSON");
        let id = value["id"].as_str().expect("agent manifest has an id").to_string();
        let capabilities: RuntimePluginCapabilities =
            serde_json::from_value(value["capabilities"].clone()).expect("capabilities deserialize");
        let profile = capability_profile_from_manifest(&capabilities, &id);

        // The verb + its derived dispatch channel exist on BOTH sides.
        assert!(
            profile.provides.contains(&"agent:respond".to_string()),
            "provides must carry agent:respond, got {:?}",
            profile.provides
        );
        assert!(
            profile.provides.contains(&"agent:dispatch".to_string()),
            "provides must carry the derived agent:dispatch channel"
        );
        assert!(
            profile.subscribes.contains(&"agent:dispatch".to_string()),
            "subscribes must carry agent:dispatch (only then is the verb dispatchable)"
        );
        // The verb reaches the model TYPED — its arg schema (prompt required) rides along.
        let schema = profile
            .verb_schemas
            .get("agent:respond")
            .expect("agent:respond carries a declared arg schema");
        assert_eq!(schema["required"], serde_json::json!(["prompt"]));

        // And the registry's dispatch guard actually SURFACES it (the consumer side of
        // the same rule invoke_tool/call_plugin walk).
        let registry = crate::host::plugin_registry::PluginRegistry::default();
        registry.register(&id, profile);
        let dispatchable = registry.dispatchable_verbs();
        assert!(
            dispatchable
                .iter()
                .any(|v| v.plugin_key == "agent" && v.verb == "respond"),
            "dispatchable_verbs must include agent/respond, got {dispatchable:?}"
        );
    }

    #[test]
    fn verbs_block_lowers_doc_and_schema_and_coexists_with_raw() {
        // verbs for the dispatchable surface + a raw user:prompt subscription (a non-verb).
        let m = minimal_manifest(
            r#""capabilities":{
                "subscribes":["user:prompt"],
                "verbs":{"key":"vault","list":{
                    "search":{"doc":"Search.","schema":{"type":"object"}}
                }}
            }"#,
        );
        let profile = capability_profile_from_manifest(&m.capabilities, "@example/agent");
        assert!(profile.provides.contains(&"vault:search".to_string()));
        assert!(profile.provides.contains(&"vault:dispatch".to_string()));
        // The raw non-verb subscription survives the merge, plus the derived channel.
        assert_eq!(profile.subscribes, vec!["user:prompt", "vault:dispatch"]);
        assert_eq!(profile.verb_docs.get("vault:search").map(String::as_str), Some("Search."));
        assert_eq!(
            profile.verb_schemas.get("vault:search"),
            Some(&serde_json::json!({"type":"object"}))
        );
    }

    #[test]
    fn verbs_block_provides_false_is_subscribe_only() {
        let m = minimal_manifest(
            r#""capabilities":{"verbs":{"key":"vault","list":{
                "search":{},"incoming":{"provides":false,"subscribes":true}
            }}}"#,
        );
        let profile = capability_profile_from_manifest(&m.capabilities, "@scope/vault");
        // incoming NOT provided; search provided; implicit dispatch channel added.
        assert_eq!(profile.provides, vec!["vault:search", "vault:dispatch"]);
        // incoming subscribed + the derived dispatch channel.
        assert_eq!(profile.subscribes, vec!["vault:incoming", "vault:dispatch"]);
    }

    #[test]
    fn manifest_concurrent_safe_defaults_false_and_parses() {
        // Absent => false (concurrency is strictly opt-in; the safe single-store
        // runner stays the default).
        assert!(!minimal_manifest("").capabilities.concurrent_safe);
        assert!(
            !minimal_manifest(r#""capabilities":{"provides":["x"]}"#)
                .capabilities
                .concurrent_safe
        );
        // Present and true => the plugin opts into pooled concurrent dispatch.
        let m = minimal_manifest(r#""capabilities":{"concurrentSafe":true}"#);
        assert!(m.capabilities.concurrent_safe);
    }

    #[test]
    fn runtime_manifest_reader_accepts_plugin_json() {
        let dir = tempfile::tempdir().expect("tempdir");
        let wasm_path = dir.path().join("plugin.wasm");
        std::fs::write(&wasm_path, b"wasm").expect("write wasm placeholder");
        std::fs::write(
            dir.path().join("plugin.json"),
            r#"{"id":"@test/plugin","version":"0.1.0","entry":"plugin.wasm",
                "observability":{"hooks":["onLoad","onInit","onRequest","onError","onTeardown"]},
                "capabilities":{"provides":["integration:respond"]}}"#,
        )
        .expect("write plugin manifest");

        let manifest = read_runtime_plugin_manifest(&wasm_path)
            .expect("read manifest")
            .expect("manifest found");

        assert!(manifest.capabilities.provides.contains(&"integration:respond".to_string()));
    }

    #[test]
    fn manifest_runtime_plugin_id_uses_manifest_identity_suffix() {
        assert_eq!(manifest_runtime_plugin_id("@refarm/agent"), "agent");
    }

    // ── The approval lookup, which had NO test at all before 2026-08-25 ───────
    //
    // `scope_to_approved` decides which permissions a plugin actually receives — the whole of
    // the operator's capability model — and nothing exercised it. AGENTS.md section 9: a guard
    // that has only ever been seen passing is indistinguishable from one that does not run;
    // here there was not even a guard.

    fn caps(items: &[&str]) -> std::collections::HashSet<String> {
        items.iter().map(|s| (*s).to_string()).collect()
    }

    #[test]
    fn scope_to_approved_narrows_to_the_intersection_when_the_key_matches() {
        let mut approvals = std::collections::HashMap::new();
        approvals.insert("lsp-code-ops".to_string(), caps(&["fs:read", "fs:write"]));

        let effective = PluginHost::scope_to_approved(
            Some(&approvals),
            "lsp-code-ops",
            caps(&["fs:read", "fs:write", "shell:spawn"]),
        );

        assert_eq!(effective, caps(&["fs:read", "fs:write"]));
        assert!(!effective.contains("shell:spawn"), "an unapproved capability must be dropped");
    }

    #[test]
    fn scope_to_approved_is_PERMISSIVE_when_the_key_does_not_match() {
        // THE FACT THAT MAKES A WRONG KEY DANGEROUS RATHER THAN INERT. A miss is not "deny";
        // it is "no approval recorded", and the plugin keeps everything it declared. So an
        // approval written under an id the load path does not use does not merely fail to
        // grant — it fails to RESTRICT, silently, while reading as a restriction in the config.
        let mut approvals = std::collections::HashMap::new();
        approvals.insert("@refarm/lsp-code-ops".to_string(), caps(&["fs:read"]));

        let effective = PluginHost::scope_to_approved(
            Some(&approvals),
            manifest_runtime_plugin_id("@refarm/lsp-code-ops"),
            caps(&["fs:read", "fs:write", "shell:spawn"]),
        );

        assert!(
            effective.contains("shell:spawn"),
            "documented behaviour: a key the load path never looks up leaves declared standing"
        );
    }

    #[test]
    fn scope_to_approved_leaves_declared_standing_when_no_map_exists() {
        // Backward compatibility, and stated so a future change cannot quietly make an
        // unconfigured node deny-all — the failure mode ISS-068 records for `trusted_plugins`.
        let effective = PluginHost::scope_to_approved(None, "agent", caps(&["fs:read"]));
        assert_eq!(effective, caps(&["fs:read"]));
    }

    #[test]
    fn the_load_path_keys_approvals_on_the_RUNTIME_id() {
        // The ground truth three durable records got wrong (ISS-068, the comment at
        // policy_and_fs.rs:421, and a session analysis on 2026-08-25): the load path computes
        // `manifest_runtime_plugin_id(manifest.id)` and looks the approval up under THAT.
        // `trusted_plugins` and `approvedPermissions` want the SAME vocabulary; only the CLI
        // canonicalises one of them.
        assert_eq!(manifest_runtime_plugin_id("@refarm/lsp-code-ops"), "lsp-code-ops");
        assert_eq!(manifest_runtime_plugin_id("@refarm/agent"), "agent");
    }

    // ── E1: integrity-at-load (a tampered artifact must not run) ──────────────

    #[test]
    fn manifest_parses_the_integrity_field() {
        // Previously DROPPED (no field → serde ignored it); now read.
        let m = minimal_manifest(r#""integrity":"sha256-abc123""#);
        assert_eq!(m.integrity.as_deref(), Some("sha256-abc123"));
        assert!(minimal_manifest("").integrity.is_none());
    }

    #[test]
    fn integrity_none_declared_loads_only_when_the_node_declared_development() {
        // No longer backward-compatible-unconditionally: an un-signed local plugin loads
        // ONLY where the node declared it is developing this plugin.
        assert!(verify_wasm_integrity(None, "deadbeef", "@test/p", true).is_ok());
        assert!(verify_wasm_integrity(None, "deadbeef", "@test/p", false).is_err());
    }

    #[test]
    fn integrity_matching_hash_passes_across_prefixes() {
        let hash = "abc123def456";
        for declared in [
            "abc123def456",       // bare hex
            "sha256-abc123def456", // SRI-style
            "sha256:abc123def456", // colon form
            "SHA256-ABC123DEF456", // case-insensitive
        ] {
            assert!(
                verify_wasm_integrity(Some(declared), hash, "@test/p", false).is_ok(),
                "declared {declared} should match {hash}"
            );
        }
    }

    #[test]
    fn integrity_mismatch_fails_load() {
        // The tampered-artifact case: declared hash ≠ the bytes on disk → hard fail.
        let err = verify_wasm_integrity(Some("sha256-0000"), "abcd", "@test/p", false).unwrap_err();
        assert!(err.to_string().contains("integrity check failed"));
        assert!(err.to_string().contains("@test/p"));
    }

    #[test]
    fn an_unsigned_plugin_needs_a_declaration_to_run() {
        // The affordance existed and was expressed by SILENCE. Absence must declare itself
        // rather than be read as consent — the same rule ISS-131 tier 3 reached for
        // credentials.
        assert!(verify_wasm_integrity(None, "abc", "ghost", false).is_err());
        assert!(verify_wasm_integrity(None, "abc", "ghost", true).is_ok());
    }

    #[test]
    fn a_declaration_never_excuses_a_wrong_hash() {
        // "Under development" waives an ABSENT claim, never a false one. A wrong hash is
        // "tampered or replaced" and stays a hard failure whatever the node declared.
        assert!(verify_wasm_integrity(Some("sha256-0000"), "abc", "ghost", true).is_err());
    }

    // ── resolve_under_development_at_load: a guessed id must never waive by config ──

    fn sovereign_dir_env_for_tests() {
        // Same fixed value every other test file in this crate sets (env_policy_edges.rs's
        // `ensure_sovereign_dir_env`) — a `Once` per test binary, safe because the VALUE never
        // varies across tests (only `base`, an explicit fn argument here, ever does).
        use std::sync::Once;
        static SET: Once = Once::new();
        SET.call_once(|| std::env::set_var("SOVEREIGN_DIR", ".refarm"));
    }

    #[test]
    fn a_guessed_manifest_less_id_never_consults_the_development_declaration() {
        // The operator ran `refarm plugin develop plugin` — "plugin" being the file-stem EVERY
        // manifest-less artifact collapses to (every real `--plugin` argument is
        // `.../refarm_<name>/plugin.wasm`, see `RequestedPluginEntry`'s doc). Without this
        // guard, that ONE declaration would waive integrity for every manifest-less artifact
        // on the node — the collision this task closes.
        sovereign_dir_env_for_tests();
        let dir = tempfile::tempdir().expect("tempdir");
        let refarm_dir = dir.path().join(".refarm");
        std::fs::create_dir_all(&refarm_dir).expect("mkdir");
        std::fs::write(
            refarm_dir.join("config.json"),
            r#"{"pluginDevelopment":{"plugin":{"declaredAt":"2026-08-25"}}}"#,
        )
        .expect("write config.json");

        let trust = crate::trust::TrustManager::with_security_mode(crate::trust::SecurityMode::Permissive);
        let telemetry = crate::telemetry::TelemetryBus::new(64);
        let host = PluginHost::new(trust, telemetry, crate::host::instance::DEFAULT_ON_EVENT_BUDGET_MS)
            .expect("PluginHost::new");

        // A REAL manifest id "plugin" (id_is_from_manifest = true) legitimately sees the
        // declaration — this is NOT the collision, it is the one artifact the operator named.
        assert!(
            host.resolve_under_development_at_load(dir.path(), "plugin", true),
            "a manifest-derived id must see this node's own declaration"
        );

        // The GUESSED file-stem fallback for a manifest-less artifact (id_is_from_manifest =
        // false) must NEVER consult the declaration, however the stored key reads — an id that
        // cannot be known must not be guessed into one that collides with every other
        // manifest-less artifact on the node.
        assert!(
            !host.resolve_under_development_at_load(dir.path(), "plugin", false),
            "a guessed (manifest-less) id must never be waived via the config-declared route"
        );
    }

    /// The test above calls `resolve_under_development_at_load` DIRECTLY, passing
    /// `id_is_from_manifest` by hand — it never exercises the real call site
    /// (`manifest_plugin_id.is_some()`, `load()`'s own derivation of that flag). Mutating
    /// that call site to pass `true` unconditionally would keep every test above green,
    /// including the four this task repaired. This test goes through `load()` itself, on a
    /// REAL manifest-less artifact, so that derivation is the thing under test.
    #[tokio::test]
    async fn a_manifest_less_artifact_is_refused_even_when_the_node_declares_its_guessed_stem_under_development(
    ) {
        // Security-adjacent: the operator declared "plugin" under development (exactly the
        // scenario the direct-call test above proves the RESOLVER refuses). Here the same
        // declaration sits in a REAL config.json and a REAL manifest-less artifact is loaded
        // through `load()` end to end — no manifest.json/plugin.json/plugin-manifest.json
        // beside it, so `plugin_id` can only be the guessed file stem "plugin". If refusal
        // came from anywhere other than the id-provenance gate, this would pass too — the
        // point is that it must NOT pass.
        let _env = crate::test_support::env_lock();
        sovereign_dir_env_for_tests();
        let dir = tempfile::tempdir().expect("tempdir");
        let refarm_dir = dir.path().join(".refarm");
        std::fs::create_dir_all(&refarm_dir).expect("mkdir");
        std::fs::write(
            refarm_dir.join("config.json"),
            r#"{"pluginDevelopment":{"plugin":{"declaredAt":"2026-08-25"}}}"#,
        )
        .expect("write config.json");
        // `load()` resolves its grant base via `config_node::declared_base()` — an internal
        // env-driven chain, not an argument — so proving it end to end (rather than by calling
        // `resolve_under_development_at_load` with an injected base, as above) means pointing
        // that chain at this tempdir for the duration of the test.
        let _base = crate::test_support::DeclaredBaseGuard::enter(dir.path());

        // Manifest-less: bytes at "plugin.wasm" with NO plugin.json/plugin-manifest.json/
        // manifest.json in the same directory. The content need not be valid WASM — the
        // integrity gate this test targets runs before any WASM parsing.
        let plugin_path = dir.path().join("plugin.wasm");
        std::fs::write(&plugin_path, b"not a real wasm module").expect("write plugin.wasm");

        let trust =
            crate::trust::TrustManager::with_security_mode(crate::trust::SecurityMode::Permissive);
        let telemetry = crate::telemetry::TelemetryBus::new(64);
        let host = PluginHost::new(trust, telemetry, crate::host::instance::DEFAULT_ON_EVENT_BUDGET_MS)
            .expect("PluginHost::new");
        let storage = crate::storage::NativeStorage::open(":memory:").expect("open storage");
        let sync = crate::sync::NativeSync::new(storage, "test").expect("NativeSync::new");

        let err = host.load(&plugin_path, &sync).await.expect_err(
            "a manifest-less artifact's guessed file stem must never be waived by a config \
             declaration keyed to that same guessed stem",
        );
        assert!(
            err.to_string().contains("declares no integrity"),
            "refusal must be the integrity-at-load gate, not an unrelated failure: {err}"
        );
    }

    // ── plugin_development_declares mirrors the JS reader exactly ──────────────

    #[test]
    fn plugin_development_declares_matches_the_shared_rs_js_parity_fixture() {
        // The SAME fixture `packages/config/src/plugin-development.test.js` reads — one
        // JSON file, two readers, so RS↔JS agreement on every malformed shape (a
        // non-object top level, an array, an entry that is not an object, an entry
        // that is an array, a missing/empty/whitespace/non-string declaredAt, and a
        // stored key in either vocabulary) is PROVEN rather than asserted twice by
        // hand in two languages that can silently drift.
        let fixture = include_str!("../../../../config/src/plugin-development.fixture.json");
        let cases: Vec<serde_json::Value> =
            serde_json::from_str(fixture).expect("parity fixture must be valid JSON");
        assert!(
            cases.len() >= 15,
            "parity fixture looks stale/empty ({} cases) — refusing to prove nothing",
            cases.len()
        );
        for case in &cases {
            let description = case["description"].as_str().unwrap_or("<no description>");
            let config = case.get("config").cloned().unwrap_or(serde_json::Value::Null);
            let plugin_id = case["pluginId"].as_str().expect("pluginId must be a string");
            let expected = case["expected"].as_bool().expect("expected must be a bool");
            assert_eq!(
                plugin_development_declares(&config, plugin_id),
                expected,
                "case {description:?} (pluginId={plugin_id:?}): expected {expected}"
            );
        }
    }

    // ── G: the trust gate denies a revoked id even under a `*` wildcard ────────

    fn trust_set(items: &[&str]) -> std::collections::HashSet<String> {
        items.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn trusted_to_load_denies_revoked_id_even_under_wildcard() {
        let allow = trust_set(&["*"]);
        let revoked = trust_set(&["vault"]);
        // `*` admits everything EXCEPT a revoked id — deny dominates the wildcard.
        assert!(!PluginHost::trusted_to_load(Some(&allow), &revoked, "vault"));
        assert!(PluginHost::trusted_to_load(Some(&allow), &revoked, "quality"));
    }

    #[test]
    fn trusted_to_load_denies_revoked_id_from_concrete_allowlist() {
        let allow = trust_set(&["vault", "quality"]);
        let revoked = trust_set(&["vault"]);
        assert!(!PluginHost::trusted_to_load(Some(&allow), &revoked, "vault"));
        assert!(PluginHost::trusted_to_load(Some(&allow), &revoked, "quality"));
    }

    #[test]
    fn trusted_to_load_no_revocations_is_unchanged() {
        let allow = trust_set(&["vault"]);
        let empty = std::collections::HashSet::new();
        assert!(PluginHost::trusted_to_load(Some(&allow), &empty, "vault"));
        assert!(!PluginHost::trusted_to_load(Some(&allow), &empty, "other"));
        // None (not configured) still permissive when nothing revoked.
        assert!(PluginHost::trusted_to_load(None, &empty, "anything"));
        // …but a revocation denies even the not-configured permissive case.
        assert!(!PluginHost::trusted_to_load(None, &trust_set(&["anything"]), "anything"));
    }

    #[test]
    fn capability_constant_is_stable() {
        // Guard: if CAP_OBSERVE_HOST_EFFECTS ever changes, existing plugin.json files
        // would silently stop being routed as observers.
        assert_eq!(crate::observer::CAP_OBSERVE_HOST_EFFECTS, "observe-host-effects");
    }

    // ── Gate B: the filesystem preopen is scoped to the fs grant ─────────────
    //
    // fs_preopen_perms is the pure decision behind preopen_plugin_runtime_dirs.
    // Testing it directly proves the context-scope gate without needing a
    // wasi:filesystem-importing guest (none exists in-tree yet).

    use crate::host::wasi_bridge::PermissionGrant;

    #[test]
    fn strict_without_any_fs_grant_gets_no_preopen() {
        let grant = PermissionGrant::strict_declaring(&["network:outbound"]);
        assert_eq!(
            fs_preopen_perms(&grant),
            None,
            "a plugin declaring no fs capability gets no filesystem root at all"
        );
    }

    #[test]
    fn strict_with_fs_read_only_gets_a_read_only_preopen() {
        let grant = PermissionGrant::strict_declaring(&["fs:read"]);
        assert_eq!(
            fs_preopen_perms(&grant),
            Some((DirPerms::READ, FilePerms::READ)),
            "fs:read alone must not confer write at the WASI layer"
        );
    }

    #[test]
    fn strict_with_fs_write_gets_a_read_write_preopen() {
        // write implies traversal, so both perms are full.
        let grant = PermissionGrant::strict_declaring(&["fs:write"]);
        assert_eq!(
            fs_preopen_perms(&grant),
            Some((DirPerms::all(), FilePerms::all()))
        );
    }

    #[test]
    fn dev_permissive_grant_is_byte_identical_to_the_old_unconditional_preopen() {
        // Permissive grants everything → all()/all(), exactly what the preopen did
        // before Gate B — so dev/test is unaffected by the scoping.
        let grant = PermissionGrant::permissive();
        assert_eq!(
            fs_preopen_perms(&grant),
            Some((DirPerms::all(), FilePerms::all()))
        );
    }
}
