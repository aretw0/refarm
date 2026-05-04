fn is_forwardable_llm_env_value(value: &str) -> bool {
    crate::host::sensitive_aliases::is_forwardable_llm_env_value(value)
}

/// Build plugin env vars with project config override semantics:
/// process LLM_* vars first, then `.refarm/config.json` overwrites them.
fn plugin_env_vars_from(base: &std::path::Path) -> Vec<(String, String)> {
    merge_plugin_env_vars(forwarded_llm_env_vars(), refarm_config_env_vars_from(base))
}

fn merge_plugin_env_vars(
    llm_vars: Vec<(String, String)>,
    config_vars: Vec<(String, String)>,
) -> Vec<(String, String)> {
    const MAX_PLUGIN_ENV_VARS: usize = 192;
    const MAX_PLUGIN_ENV_TOTAL_BYTES: usize = 96 * 1024;

    let mut merged = std::collections::BTreeMap::<String, String>::new();
    for (k, v) in llm_vars {
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

fn refarm_config_env_vars_from(base: &std::path::Path) -> Vec<(String, String)> {
    const MAX_CONFIG_BUDGET_VARS: usize = 64;

    let path = base.join(".refarm/config.json");
    let Some(bytes) = read_refarm_config_bytes(&path) else {
        return vec![];
    };
    let Ok(cfg) = serde_json::from_slice::<serde_json::Value>(&bytes) else {
        tracing::warn!(".refarm/config.json is not valid JSON — ignoring");
        return vec![];
    };
    let mut vars: Vec<(String, String)> = Vec::new();
    push_trimmed_lower_env_var(&mut vars, "LLM_PROVIDER", cfg["provider"].as_str());
    push_trimmed_env_var(&mut vars, "LLM_MODEL", cfg["model"].as_str());
    push_trimmed_lower_env_var(&mut vars, "LLM_DEFAULT_PROVIDER", cfg["default_provider"].as_str());
    push_bool_env_var(&mut vars, "LLM_STREAM_RESPONSES", cfg["stream_responses"].as_bool());
    if let Some(budgets) = cfg["budgets"].as_object() {
        for (provider, amount) in budgets.iter().take(MAX_CONFIG_BUDGET_VARS) {
            let Some(provider_token) = sanitize_budget_provider_for_env(provider) else {
                continue;
            };
            if let Some(usd) = amount.as_f64() {
                if usd < 0.0 {
                    continue;
                }
                let key = format!("LLM_BUDGET_{}_USD", provider_token);
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
    let path = base.join(".refarm/config.json");
    let bytes = read_refarm_config_bytes(&path)?;
    serde_json::from_slice::<serde_json::Value>(&bytes).ok()
}

fn now_ns() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos() as u64)
        .unwrap_or(0)
}

fn refarm_config_node_payload(
    plugin_id: &str,
    base: &std::path::Path,
    env_vars: &[(String, String)],
    config_json: Option<&serde_json::Value>,
) -> serde_json::Value {
    let env_map: serde_json::Map<String, serde_json::Value> = env_vars
        .iter()
        .map(|(k, v)| (k.clone(), serde_json::Value::String(v.clone())))
        .collect();

    let timestamp_ns = now_ns();
    serde_json::json!({
        "@type": "RefarmConfig",
        "@id": format!("urn:tractor:refarm-config:{plugin_id}:{timestamp_ns}"),
        "plugin_id": plugin_id,
        "workspace": base.to_string_lossy(),
        "config_path": base.join(".refarm/config.json").to_string_lossy(),
        "timestamp_ns": timestamp_ns,
        "llm_env": serde_json::Value::Object(env_map),
        "config_json": config_json.cloned().unwrap_or(serde_json::Value::Null),
    })
}

fn store_refarm_config_node(
    sync: &NativeSync,
    plugin_id: &str,
    base: &std::path::Path,
    env_vars: &[(String, String)],
    config_json: Option<&serde_json::Value>,
) -> anyhow::Result<()> {
    let payload = refarm_config_node_payload(plugin_id, base, env_vars, config_json).to_string();
    let node: serde_json::Value = serde_json::from_str(&payload)?;
    let id = node["@id"]
        .as_str()
        .ok_or_else(|| anyhow::anyhow!("RefarmConfig node missing @id"))?;
    sync.store_node(id, "RefarmConfig", None, &payload, Some("tractor-host"))?;
    Ok(())
}

#[derive(Debug, Clone, serde::Deserialize)]
struct RuntimePluginManifest {
    id: String,
    version: String,
    entry: String,
    observability: RuntimePluginObservability,
}

#[derive(Debug, Clone, serde::Deserialize)]
struct RuntimePluginObservability {
    hooks: Vec<String>,
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

    for filename in ["plugin-manifest.json", "manifest.json"] {
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

fn manifest_runtime_plugin_id(manifest_id: &str) -> &str {
    manifest_id
        .trim()
        .rsplit('/')
        .next()
        .filter(|v| !v.trim().is_empty())
        .unwrap_or(manifest_id)
}

fn validate_manifest_runtime_alignment(
    plugin_id: &str,
    metadata: &refarm::plugin::types::PluginMetadata,
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

    let manifest_plugin_id = manifest_runtime_plugin_id(&manifest.id);
    if manifest_plugin_id != plugin_id {
        issues.push(format!(
            "plugin_id mismatch: runtime='{}' manifest='{}' (manifest.id='{}')",
            plugin_id, manifest_plugin_id, manifest.id
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

impl PluginHost {
    pub fn new(trust: TrustManager, telemetry: TelemetryBus) -> Result<Self> {
        let mut config = Config::new();
        config.async_support(true);
        config.wasm_component_model(true);
        let engine = Arc::new(Engine::new(&config)?);

        // ── Regular plugin linker ──────────────────────────────────────────
        let mut linker: Linker<TractorStore> = Linker::new(&engine);
        wasmtime_wasi::add_to_linker_async(&mut linker)?;
        wasmtime_wasi_http::add_only_http_to_linker_async(&mut linker)?;
        RefarmPluginHost::add_to_linker(&mut linker, |s| &mut s.bindings)?;

        // ── agent-tools.wasm linker ────────────────────────────────────────
        // Does NOT include tractor-bridge (agent-tools is not an integration plugin).
        // Includes WASI (for std::fs → wasi:filesystem) + host-spawn (for OS fork/exec).
        let mut agent_tools_linker: Linker<TractorStore> = Linker::new(&engine);
        wasmtime_wasi::add_to_linker_async(&mut agent_tools_linker)?;
        atb::AgentToolsHost::add_to_linker(
            &mut agent_tools_linker,
            |s| &mut s.bindings,
        )?;

        Ok(Self {
            trust,
            telemetry,
            engine,
            linker: Arc::new(linker),
            agent_tools_linker: Arc::new(agent_tools_linker),
        })
    }

    /// Load a regular integration plugin (`.wasm` Component).
    ///
    /// Uses the regular linker: tractor-bridge + agent-fs/shell host primitives.
    /// Fase 3 TODO: if `agent_tools` is loaded, compose agent-fs/shell from it
    /// instead of the host primitive — see HANDOFF.md Tarefa 2B.
    pub async fn load(&self, path: &Path, sync: &NativeSync) -> Result<PluginInstanceHandle> {
        let plugin_id = path
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("unknown")
            .to_string();

        tracing::info!(plugin_id = %plugin_id, path = %path.display(), "Loading plugin");
        anyhow::ensure!(path.exists(), "Plugin file not found: {}", path.display());

        let bytes = tokio::fs::read(path).await?;
        let wasm_hash = hex::encode(Sha256::digest(&bytes));
        tracing::debug!(plugin_id = %plugin_id, wasm_hash = %wasm_hash, "Plugin hash computed");

        // ── WASI variant probe (ADR-061) ──────────────────────────────────────
        let variant = crate::host::wasi_variant::probe_bytes(&bytes)
            .ok_or_else(|| anyhow::anyhow!("{} is not a valid WASM module or component", path.display()))?;
        tracing::info!(plugin_id = %plugin_id, variant = %variant, "WASI variant detected");

        if variant == crate::host::wasi_variant::WasiVariant::Module {
            anyhow::bail!(
                "Plugin '{}' is a WASI P1 plain module. \
                 P1 module loader is not yet implemented (ADR-061 Phase 2). \
                 Recompile with cargo-component to produce a WASM component.",
                plugin_id
            );
        }

        if self.trust.security_mode() == &SecurityMode::Strict
            && !self.trust.has_valid_grant(&plugin_id, Some(&wasm_hash))
        {
            anyhow::bail!(
                "SecurityMode::Strict: no valid trust grant for plugin '{}' (hash: {})",
                plugin_id,
                wasm_hash
            );
        }

        let base = std::env::current_dir().unwrap_or_default();
        let env_vars = plugin_env_vars_from(&base);
        let config_json = refarm_config_json_from(&base);
        let mut wasi_builder = WasiCtxBuilder::new();
        wasi_builder.inherit_stderr();
        for (k, v) in &env_vars {
            wasi_builder.env(k, v);
        }
        let wasi = wasi_builder.build();
        let table = ResourceTable::new();
        let http = wasmtime_wasi_http::WasiHttpCtx::new();
        let bindings = TractorNativeBindings::new(&plugin_id, sync.clone(), self.telemetry.clone());

        let component = Component::from_file(&self.engine, path)?;
        let mut store = Store::new(&self.engine, TractorStore { wasi, http, bindings, table });

        let plugin =
            RefarmPluginHost::instantiate_async(&mut store, &component, &self.linker).await?;

        if let Some(manifest) = read_runtime_plugin_manifest(path)? {
            let metadata = plugin.refarm_plugin_integration().call_metadata(&mut store).await?;
            validate_manifest_runtime_alignment(&plugin_id, &metadata, &manifest)?;
        } else {
            tracing::warn!(
                plugin_id = %plugin_id,
                path = %path.display(),
                "plugin manifest not found near wasm; skipping manifest/runtime alignment checks"
            );
        }

        let mut handle = PluginInstanceHandle::new(
            plugin_id.clone(),
            plugin,
            store,
            self.telemetry.clone(),
        );
        handle.call_setup().await?;

        if let Err(e) = store_refarm_config_node(sync, &plugin_id, &base, &env_vars, config_json.as_ref()) {
            tracing::warn!(plugin_id = %plugin_id, error = %e, "failed to store RefarmConfig node");
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

    /// Load agent-tools.wasm — the composition component that exports agent-fs + agent-shell.
    ///
    /// Uses a dedicated linker with WASI + host-spawn (no tractor-bridge).
    /// The returned `AgentToolsHandle` is stored by the caller (daemon/manager)
    /// for future Fase 3 composition with pi-agent.wasm.
    pub async fn load_agent_tools(&self, path: &Path, sync: &NativeSync) -> Result<AgentToolsHandle> {
        let plugin_id = "agent-tools".to_string();

        tracing::info!(path = %path.display(), "Loading agent-tools.wasm");
        anyhow::ensure!(path.exists(), "agent-tools.wasm not found: {}", path.display());

        let bytes = tokio::fs::read(path).await?;
        let wasm_hash = hex::encode(Sha256::digest(&bytes));

        let wasi = WasiCtxBuilder::new().inherit_stderr().build();
        let table = ResourceTable::new();
        let http = wasmtime_wasi_http::WasiHttpCtx::new();
        let bindings = TractorNativeBindings::new(&plugin_id, sync.clone(), self.telemetry.clone());

        let component = Component::from_file(&self.engine, path)?;
        let mut store = Store::new(&self.engine, TractorStore { wasi, http, bindings, table });

        let agent_tools = atb::AgentToolsHost::instantiate_async(
            &mut store,
            &component,
            &self.agent_tools_linker,
        )
        .await?;

        self.telemetry.emit_named(
            "agent-tools:loaded",
            Some(plugin_id.clone()),
            Some(serde_json::json!({ "wasm_hash": wasm_hash })),
        );

        tracing::info!(wasm_hash = %wasm_hash, "agent-tools.wasm loaded");
        Ok(AgentToolsHandle::new(plugin_id, agent_tools, store))
    }
}

#[cfg(test)]
#[path = "../plugin_host_tests.rs"]
mod tests;
