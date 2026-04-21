//! PluginHost — wasmtime Component loader + Linker + lifecycle orchestration.
//!
//! Phase 4: wasmtime Component Model, WIT bindings via `bindgen!` macro.
//!
//! Two bindgen worlds:
//!   - `refarm-plugin-host`  → regular integration plugins (tractor-bridge, agent-fs/shell)
//!   - `agent-tools-host`    → the agent-tools.wasm composition component (host-spawn)

use std::path::Path;
use std::sync::Arc;

use anyhow::Result;
use sha2::{Digest, Sha256};
use wasmtime::component::{Component, Linker};
use wasmtime::{Config, Engine, Store};
use wasmtime_wasi::{ResourceTable, WasiCtx, WasiCtxBuilder, WasiView};

use crate::host::instance::PluginInstanceHandle;
use crate::host::wasi_bridge::TractorNativeBindings;
use crate::sync::NativeSync;
use crate::telemetry::TelemetryBus;
use crate::trust::{SecurityMode, TrustManager};

// ── WIT Bindings: regular integration plugins ─────────────────────────────────
//
// Reads `wit/host/refarm-plugin-host.wit`.
// Generates RefarmPluginHost + host traits for tractor-bridge, agent-fs, agent-shell.

wasmtime::component::bindgen!({
    world: "refarm-plugin-host",
    path: "wit/host",
    async: true,
});

// agent_tools_bindings is defined in agent_tools_bindings.rs — kept separate
// so the two bindgen! expansions live in different Rust modules (both generate
// a `refarm` root and would collide if in the same file/scope).
use crate::host::agent_tools_bindings as atb;

// ── TractorStore ──────────────────────────────────────────────────────────────

pub(crate) struct TractorStore {
    pub wasi: WasiCtx,
    pub http: wasmtime_wasi_http::WasiHttpCtx,
    pub bindings: TractorNativeBindings,
    pub table: ResourceTable,
}

impl WasiView for TractorStore {
    fn ctx(&mut self) -> &mut WasiCtx { &mut self.wasi }
    fn table(&mut self) -> &mut ResourceTable { &mut self.table }
}

impl wasmtime_wasi_http::WasiHttpView for TractorStore {
    fn ctx(&mut self) -> &mut wasmtime_wasi_http::WasiHttpCtx { &mut self.http }
    fn table(&mut self) -> &mut ResourceTable { &mut self.table }
}

// ── AgentToolsHandle ──────────────────────────────────────────────────────────
//
// A loaded agent-tools.wasm instance. Holds the typed caller (AgentToolsHost)
// and the store. Future Fase 3 composition will extract Func refs from here
// to wire into pi-agent's linker — see HANDOFF.md Tarefa 2B / 2C.

pub struct AgentToolsHandle {
    pub id: String,
    /// Typed caller for agent-fs + agent-shell exports on the component.
    #[allow(dead_code)]
    pub(crate) component: atb::AgentToolsHost,
    /// Isolated store for agent-tools.wasm (each plugin owns its store).
    #[allow(dead_code)]
    pub(crate) store: Store<TractorStore>,
}

impl AgentToolsHandle {
    pub(crate) fn new(
        id: String,
        component: atb::AgentToolsHost,
        store: Store<TractorStore>,
    ) -> Self {
        Self { id, component, store }
    }
}

impl std::fmt::Debug for AgentToolsHandle {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("AgentToolsHandle").field("id", &self.id).finish()
    }
}

// ── PluginHost ────────────────────────────────────────────────────────────────

/// Orchestrates WASM plugin loading and lifecycle via wasmtime.
pub struct PluginHost {
    trust: TrustManager,
    telemetry: TelemetryBus,
    engine: Arc<Engine>,
    /// Linker for regular integration plugins (tractor-bridge, agent-fs, agent-shell host primitives).
    linker: Arc<Linker<TractorStore>>,
    /// Linker for agent-tools.wasm (WASI + host-spawn; no tractor-bridge).
    agent_tools_linker: Arc<Linker<TractorStore>>,
}

/// Forward only LLM_* vars into plugin WASI env.
///
/// Security: avoids leaking unrelated host environment variables (credentials,
/// tokens, etc.) into the plugin sandbox.
fn forwarded_llm_env_vars() -> Vec<(String, String)> {
    std::env::vars()
        .filter(|(k, v)| is_forwardable_llm_env_key(k) && is_forwardable_llm_env_value(v))
        .collect()
}

fn is_forwardable_llm_env_key(key: &str) -> bool {
    if !key.starts_with("LLM_") {
        return false;
    }
    if key.len() <= "LLM_".len() {
        return false;
    }
    if !is_safe_llm_env_key_format(key) {
        return false;
    }
    let upper = key.to_ascii_uppercase();
    !(upper.ends_with("_API_KEY")
        || upper.ends_with("_TOKEN")
        || upper.ends_with("_SECRET")
        || upper.ends_with("_PASSWORD")
        || upper.ends_with("_CREDENTIALS")
        || upper.ends_with("_PRIVATE_KEY")
        || upper.ends_with("_ACCESS_KEY")
        || upper.ends_with("_SIGNING_KEY"))
}

fn is_forwardable_llm_env_value(value: &str) -> bool {
    const MAX_LLM_ENV_VALUE_LEN: usize = 4096;
    !value.trim().is_empty()
        && value.len() <= MAX_LLM_ENV_VALUE_LEN
        && !value.chars().any(|c| c.is_control())
}

fn is_safe_llm_env_key_format(key: &str) -> bool {
    const MAX_SUFFIX_LEN: usize = 96;
    let suffix = &key["LLM_".len()..];
    !suffix.is_empty()
        && suffix.len() <= MAX_SUFFIX_LEN
        && suffix
            .bytes()
            .all(|b| b.is_ascii_uppercase() || b.is_ascii_digit() || b == b'_')
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
    let mut merged = std::collections::BTreeMap::<String, String>::new();
    for (k, v) in llm_vars {
        merged.insert(k, v);
    }
    for (k, v) in config_vars {
        merged.insert(k, v);
    }
    merged.into_iter().collect()
}

fn refarm_config_env_vars_from(base: &std::path::Path) -> Vec<(String, String)> {
    let path = base.join(".refarm/config.json");
    let Ok(bytes) = std::fs::read(&path) else { return vec![]; };
    let Ok(cfg) = serde_json::from_slice::<serde_json::Value>(&bytes) else {
        tracing::warn!(".refarm/config.json is not valid JSON — ignoring");
        return vec![];
    };
    let mut vars: Vec<(String, String)> = Vec::new();
    push_trimmed_lower_env_var(&mut vars, "LLM_PROVIDER", cfg["provider"].as_str());
    push_trimmed_env_var(&mut vars, "LLM_MODEL", cfg["model"].as_str());
    push_trimmed_lower_env_var(&mut vars, "LLM_DEFAULT_PROVIDER", cfg["default_provider"].as_str());
    if let Some(budgets) = cfg["budgets"].as_object() {
        for (provider, amount) in budgets {
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
    let Some(value) = value else { return; };
    let trimmed = value.trim();
    if !trimmed.is_empty() && !trimmed.chars().any(|c| c.is_control()) {
        upsert_env_var_vec(vars, key.to_string(), trimmed.to_string());
    }
}

fn push_trimmed_lower_env_var(vars: &mut Vec<(String, String)>, key: &str, value: Option<&str>) {
    let Some(value) = value else { return; };
    let trimmed = value.trim();
    if !trimmed.is_empty() && !trimmed.chars().any(|c| c.is_control()) {
        upsert_env_var_vec(vars, key.to_string(), trimmed.to_ascii_lowercase());
    }
}

fn upsert_env_var_vec(vars: &mut Vec<(String, String)>, key: String, value: String) {
    if vars.iter().all(|(k, _)| k != &key) {
        vars.push((key, value));
    }
}

fn refarm_config_json_from(base: &std::path::Path) -> Option<serde_json::Value> {
    let path = base.join(".refarm/config.json");
    let Ok(bytes) = std::fs::read(path) else { return None; };
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

        plugin
            .refarm_plugin_integration()
            .call_setup(&mut store)
            .await?
            .map_err(|e| anyhow::anyhow!("Plugin setup() failed: {:?}", e))?;

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
        Ok(PluginInstanceHandle::new(plugin_id, plugin, store))
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
mod tests {
    use super::*;
    use crate::storage::NativeStorage;

    #[test]
    fn refarm_config_env_vars_returns_empty_when_no_file() {
        // CWD in test environment has no .refarm/config.json — must not panic.
        let base = std::env::current_dir().unwrap_or_default();
        let vars = refarm_config_env_vars_from(&base);
        // Can't assert empty (dev machine might have a config), but must not error.
        let _ = vars;
    }

    #[test]
    fn forwardable_llm_env_key_filters_sensitive_suffixes() {
        assert!(!is_forwardable_llm_env_key("LLM_"));
        assert!(is_forwardable_llm_env_key("LLM_PROVIDER"));
        assert!(is_forwardable_llm_env_key("LLM_BASE_URL"));
        assert!(!is_forwardable_llm_env_key("LLM-provider"));
        assert!(!is_forwardable_llm_env_key("LLM_PROVIDER NAME"));
        assert!(!is_forwardable_llm_env_key("LLM_provider"));
        assert!(!is_forwardable_llm_env_key(&format!("LLM_{}", "A".repeat(97))));

        assert!(!is_forwardable_llm_env_key("OPENAI_API_KEY"));
        assert!(!is_forwardable_llm_env_key("LLM_OPENAI_API_KEY"));
        assert!(!is_forwardable_llm_env_key("LLM_SESSION_TOKEN"));
        assert!(!is_forwardable_llm_env_key("LLM_SHARED_SECRET"));
        assert!(!is_forwardable_llm_env_key("LLM_DB_PASSWORD"));
        assert!(!is_forwardable_llm_env_key("LLM_PROVIDER_CREDENTIALS"));
        assert!(!is_forwardable_llm_env_key("LLM_SSH_PRIVATE_KEY"));
        assert!(!is_forwardable_llm_env_key("LLM_AWS_ACCESS_KEY"));
        assert!(!is_forwardable_llm_env_key("LLM_REQUEST_SIGNING_KEY"));

        assert!(is_forwardable_llm_env_value("openai"));
        assert!(is_forwardable_llm_env_value("https://api.openai.com/v1"));
        assert!(!is_forwardable_llm_env_value("   "));
        assert!(!is_forwardable_llm_env_value(&"a".repeat(4097)));
        assert!(!is_forwardable_llm_env_value("open\nai"));
        assert!(!is_forwardable_llm_env_value("open\u{0000}ai"));
    }

    #[test]
    fn refarm_config_env_vars_maps_fields_correctly() {
        let dir = tempfile::tempdir().unwrap();
        let refarm_dir = dir.path().join(".refarm");
        std::fs::create_dir_all(&refarm_dir).unwrap();
        std::fs::write(
            refarm_dir.join("config.json"),
            r#"{"provider":"anthropic","model":"claude-opus-4-7","default_provider":"ollama","budgets":{"anthropic":5.0,"openai":2.5}}"#,
        ).unwrap();
        let vars = refarm_config_env_vars_from(dir.path());
        let map: std::collections::HashMap<_, _> = vars.into_iter().collect();
        assert_eq!(map["LLM_PROVIDER"], "anthropic");
        assert_eq!(map["LLM_MODEL"], "claude-opus-4-7");
        assert_eq!(map["LLM_DEFAULT_PROVIDER"], "ollama");
        assert_eq!(map["LLM_BUDGET_ANTHROPIC_USD"], "5");
        assert_eq!(map["LLM_BUDGET_OPENAI_USD"], "2.5");
    }

    #[test]
    fn refarm_config_env_vars_ignores_non_numeric_budgets() {
        let dir = tempfile::tempdir().unwrap();
        let refarm_dir = dir.path().join(".refarm");
        std::fs::create_dir_all(&refarm_dir).unwrap();
        std::fs::write(
            refarm_dir.join("config.json"),
            r#"{"budgets":{"anthropic":"5.0","openai":null,"ollama":1.25}}"#,
        )
        .unwrap();

        let vars = refarm_config_env_vars_from(dir.path());
        let map: std::collections::HashMap<_, _> = vars.into_iter().collect();

        assert!(!map.contains_key("LLM_BUDGET_ANTHROPIC_USD"));
        assert!(!map.contains_key("LLM_BUDGET_OPENAI_USD"));
        assert_eq!(map["LLM_BUDGET_OLLAMA_USD"], "1.25");
    }

    #[test]
    fn refarm_config_env_vars_trim_and_skip_empty_string_fields() {
        let dir = tempfile::tempdir().unwrap();
        let refarm_dir = dir.path().join(".refarm");
        std::fs::create_dir_all(&refarm_dir).unwrap();
        std::fs::write(
            refarm_dir.join("config.json"),
            r#"{"provider":"  openai  ","model":"   ","default_provider":"\tollama\t"}"#,
        )
        .unwrap();

        let vars = refarm_config_env_vars_from(dir.path());
        let map: std::collections::HashMap<_, _> = vars.into_iter().collect();

        assert_eq!(map["LLM_PROVIDER"], "openai");
        assert_eq!(map["LLM_DEFAULT_PROVIDER"], "ollama");
        assert!(!map.contains_key("LLM_MODEL"));
    }

    #[test]
    fn refarm_config_env_vars_skip_string_fields_with_control_chars() {
        let dir = tempfile::tempdir().unwrap();
        let refarm_dir = dir.path().join(".refarm");
        std::fs::create_dir_all(&refarm_dir).unwrap();
        std::fs::write(
            refarm_dir.join("config.json"),
            r#"{"provider":"open\nai","model":"gpt\u0000x","default_provider":" ollama "}"#,
        )
        .unwrap();

        let vars = refarm_config_env_vars_from(dir.path());
        let map: std::collections::HashMap<_, _> = vars.into_iter().collect();

        assert!(!map.contains_key("LLM_PROVIDER"));
        assert!(!map.contains_key("LLM_MODEL"));
        assert_eq!(map["LLM_DEFAULT_PROVIDER"], "ollama");
    }

    #[test]
    fn refarm_config_env_vars_normalize_provider_fields_to_lowercase() {
        let dir = tempfile::tempdir().unwrap();
        let refarm_dir = dir.path().join(".refarm");
        std::fs::create_dir_all(&refarm_dir).unwrap();
        std::fs::write(
            refarm_dir.join("config.json"),
            r#"{"provider":" OpenAI ","default_provider":" OLLAMA "}"#,
        )
        .unwrap();

        let vars = refarm_config_env_vars_from(dir.path());
        let map: std::collections::HashMap<_, _> = vars.into_iter().collect();

        assert_eq!(map["LLM_PROVIDER"], "openai");
        assert_eq!(map["LLM_DEFAULT_PROVIDER"], "ollama");
    }

    #[test]
    fn refarm_config_env_vars_trim_budget_provider_names() {
        let dir = tempfile::tempdir().unwrap();
        let refarm_dir = dir.path().join(".refarm");
        std::fs::create_dir_all(&refarm_dir).unwrap();
        std::fs::write(
            refarm_dir.join("config.json"),
            r#"{"budgets":{" openai ":2.5,"   ":1.0}}"#,
        )
        .unwrap();

        let vars = refarm_config_env_vars_from(dir.path());
        let map: std::collections::HashMap<_, _> = vars.into_iter().collect();

        assert_eq!(map["LLM_BUDGET_OPENAI_USD"], "2.5");
        assert!(!map.contains_key("LLM_BUDGET___USD"));
    }

    #[test]
    fn refarm_config_env_vars_sanitize_budget_provider_tokens() {
        let dir = tempfile::tempdir().unwrap();
        let refarm_dir = dir.path().join(".refarm");
        std::fs::create_dir_all(&refarm_dir).unwrap();
        std::fs::write(
            refarm_dir.join("config.json"),
            r#"{"budgets":{"openai-codex/v1":2.5,"***":1.0}}"#,
        )
        .unwrap();

        let vars = refarm_config_env_vars_from(dir.path());
        let map: std::collections::HashMap<_, _> = vars.into_iter().collect();

        assert_eq!(map["LLM_BUDGET_OPENAI_CODEX_V1_USD"], "2.5");
        assert!(!map.contains_key("LLM_BUDGET___USD"));
    }

    #[test]
    fn refarm_config_env_vars_skip_overlong_budget_provider_token() {
        let dir = tempfile::tempdir().unwrap();
        let refarm_dir = dir.path().join(".refarm");
        std::fs::create_dir_all(&refarm_dir).unwrap();
        let overlong = "a".repeat(65);
        std::fs::write(
            refarm_dir.join("config.json"),
            format!(r#"{{"budgets":{{"{overlong}":2.5,"openai":1.0}}}}"#),
        )
        .unwrap();

        let vars = refarm_config_env_vars_from(dir.path());
        let map: std::collections::HashMap<_, _> = vars.into_iter().collect();

        assert_eq!(map["LLM_BUDGET_OPENAI_USD"], "1");
        assert_eq!(map.len(), 1);
    }

    #[test]
    fn refarm_config_env_vars_skip_budget_provider_with_control_chars() {
        let dir = tempfile::tempdir().unwrap();
        let refarm_dir = dir.path().join(".refarm");
        std::fs::create_dir_all(&refarm_dir).unwrap();
        std::fs::write(
            refarm_dir.join("config.json"),
            r#"{"budgets":{"open\nai":2.5,"openai":1.0}}"#,
        )
        .unwrap();

        let vars = refarm_config_env_vars_from(dir.path());
        let map: std::collections::HashMap<_, _> = vars.into_iter().collect();

        assert_eq!(map["LLM_BUDGET_OPENAI_USD"], "1");
        assert_eq!(map.len(), 1);
    }

    #[test]
    fn refarm_config_env_vars_dedupe_provider_and_budget_keys_after_normalization() {
        let dir = tempfile::tempdir().unwrap();
        let refarm_dir = dir.path().join(".refarm");
        std::fs::create_dir_all(&refarm_dir).unwrap();
        std::fs::write(
            refarm_dir.join("config.json"),
            r#"{"provider":"openai","budgets":{"openai-codex/v1":1.0,"openai codex v1":2.5}}"#,
        )
        .unwrap();

        let vars = refarm_config_env_vars_from(dir.path());
        let map: std::collections::HashMap<_, _> = vars.into_iter().collect();

        assert_eq!(map["LLM_PROVIDER"], "openai");
        assert_eq!(map["LLM_BUDGET_OPENAI_CODEX_V1_USD"], "2.5");
    }

    #[test]
    fn refarm_config_env_vars_ignores_negative_budgets() {
        let dir = tempfile::tempdir().unwrap();
        let refarm_dir = dir.path().join(".refarm");
        std::fs::create_dir_all(&refarm_dir).unwrap();
        std::fs::write(
            refarm_dir.join("config.json"),
            r#"{"budgets":{"openai":-1.0,"ollama":0.0}}"#,
        )
        .unwrap();

        let vars = refarm_config_env_vars_from(dir.path());
        let map: std::collections::HashMap<_, _> = vars.into_iter().collect();

        assert!(!map.contains_key("LLM_BUDGET_OPENAI_USD"));
        assert_eq!(map["LLM_BUDGET_OLLAMA_USD"], "0");
    }

    #[test]
    fn refarm_config_env_vars_ignores_invalid_json() {
        let dir = tempfile::tempdir().unwrap();
        let refarm_dir = dir.path().join(".refarm");
        std::fs::create_dir_all(&refarm_dir).unwrap();
        std::fs::write(refarm_dir.join("config.json"), b"not json").unwrap();
        let vars = refarm_config_env_vars_from(dir.path());
        assert!(vars.is_empty());
    }

    #[test]
    fn refarm_config_env_vars_empty_when_no_file() {
        let dir = tempfile::tempdir().unwrap();
        let vars = refarm_config_env_vars_from(dir.path());
        assert!(vars.is_empty());
    }

    #[test]
    fn refarm_config_json_from_reads_valid_json() {
        let dir = tempfile::tempdir().unwrap();
        let refarm_dir = dir.path().join(".refarm");
        std::fs::create_dir_all(&refarm_dir).unwrap();
        std::fs::write(
            refarm_dir.join("config.json"),
            r#"{"provider":"openai","model":"gpt-4o-mini"}"#,
        )
        .unwrap();

        let cfg = refarm_config_json_from(dir.path()).expect("config should parse");
        assert_eq!(cfg["provider"], "openai");
        assert_eq!(cfg["model"], "gpt-4o-mini");
    }

    #[test]
    fn refarm_config_json_from_returns_none_on_invalid_json() {
        let dir = tempfile::tempdir().unwrap();
        let refarm_dir = dir.path().join(".refarm");
        std::fs::create_dir_all(&refarm_dir).unwrap();
        std::fs::write(refarm_dir.join("config.json"), b"not-json").unwrap();

        let cfg = refarm_config_json_from(dir.path());
        assert!(cfg.is_none());
    }

    #[test]
    fn merge_plugin_env_vars_config_overrides_llm_vars() {
        let llm = vec![
            ("LLM_PROVIDER".to_string(), "openai".to_string()),
            ("LLM_MODEL".to_string(), "gpt-4o-mini".to_string()),
        ];
        let cfg = vec![
            ("LLM_PROVIDER".to_string(), "ollama".to_string()),
            ("LLM_BASE_URL".to_string(), "http://127.0.0.1:11434".to_string()),
        ];

        let merged = merge_plugin_env_vars(llm, cfg);
        let map: std::collections::HashMap<_, _> = merged.into_iter().collect();

        assert_eq!(map["LLM_PROVIDER"], "ollama");
        assert_eq!(map["LLM_MODEL"], "gpt-4o-mini");
        assert_eq!(map["LLM_BASE_URL"], "http://127.0.0.1:11434");
    }

    #[test]
    fn refarm_config_node_payload_contains_expected_fields() {
        let dir = tempfile::tempdir().unwrap();
        let env_vars = vec![
            ("LLM_PROVIDER".to_string(), "ollama".to_string()),
            ("LLM_MODEL".to_string(), "llama3.2".to_string()),
        ];
        let cfg = serde_json::json!({"provider": "ollama", "model": "llama3.2"});

        let payload = refarm_config_node_payload("pi_agent", dir.path(), &env_vars, Some(&cfg));

        assert_eq!(payload["@type"], "RefarmConfig");
        assert_eq!(payload["plugin_id"], "pi_agent");
        assert_eq!(payload["llm_env"]["LLM_PROVIDER"], "ollama");
        assert_eq!(payload["config_json"]["model"], "llama3.2");
        assert!(payload["@id"].as_str().unwrap_or("").starts_with("urn:tractor:refarm-config:pi_agent:"));
    }

    #[test]
    fn store_refarm_config_node_persists_queryable_audit_record() {
        let storage = NativeStorage::open(":memory:").unwrap();
        let sync = NativeSync::new(storage, "test-refarm-config").unwrap();
        let dir = tempfile::tempdir().unwrap();
        let env_vars = vec![
            ("LLM_PROVIDER".to_string(), "ollama".to_string()),
            ("LLM_MODEL".to_string(), "llama3.2".to_string()),
        ];
        let cfg = serde_json::json!({"provider": "ollama", "model": "llama3.2"});

        store_refarm_config_node(&sync, "pi_agent", dir.path(), &env_vars, Some(&cfg)).unwrap();

        let rows = sync.query_nodes("RefarmConfig").unwrap();
        assert_eq!(rows.len(), 1);
        let row = &rows[0];
        assert_eq!(row.type_, "RefarmConfig");
        assert_eq!(row.source_plugin.as_deref(), Some("tractor-host"));

        let payload: serde_json::Value = serde_json::from_str(&row.payload).unwrap();
        assert_eq!(payload["@type"], "RefarmConfig");
        assert_eq!(payload["plugin_id"], "pi_agent");
        assert_eq!(payload["llm_env"]["LLM_PROVIDER"], "ollama");
    }

    #[test]
    fn refarm_config_node_payload_uses_null_config_when_missing() {
        let dir = tempfile::tempdir().unwrap();
        let env_vars = vec![("LLM_PROVIDER".to_string(), "ollama".to_string())];

        let payload = refarm_config_node_payload("pi_agent", dir.path(), &env_vars, None);

        assert_eq!(payload["@type"], "RefarmConfig");
        assert!(payload["config_json"].is_null());
    }
}
