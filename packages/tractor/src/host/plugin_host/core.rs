// PluginHost — wasmtime Component loader + Linker + lifecycle orchestration.
//
// Phase 4: wasmtime Component Model, WIT bindings via `bindgen!` macro.
//
// Two bindgen worlds:
//   - `refarm-plugin-host`  → regular integration plugins (tractor-bridge, agent-fs/shell)
//   - `agent-tools-host`    → the agent-tools.wasm composition component (host-spawn)

use std::path::Path;
use std::sync::Arc;

use anyhow::Result;
use sha2::{Digest, Sha256};
use wasmtime::component::{Component, Linker};
use wasmtime::{Config, Engine, Store};
use wasmtime_wasi::{ResourceTable, WasiCtx, WasiCtxBuilder, WasiView};

use crate::host::instance::PluginInstanceHandle;
use crate::host::sensitive_aliases::{
    is_compact_sensitive_env_alias_suffix_or_segment,
    is_generic_sensitive_env_token_suffix_or_segment,
    is_shared_sensitive_env_canonical_suffix_or_segment,
    is_shared_sensitive_env_namespace_segment,
};
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
    forwarded_llm_env_vars_from_iter(std::env::vars())
}

fn forwarded_llm_env_vars_from_iter<I>(vars: I) -> Vec<(String, String)>
where
    I: IntoIterator<Item = (String, String)>,
{
    const MAX_FORWARDED_LLM_ENV_VARS: usize = 128;
    const MAX_FORWARDED_LLM_ENV_SCAN: usize = 512;
    const MAX_FORWARDED_LLM_ENV_TOTAL_BYTES: usize = 64 * 1024;

    let mut out = Vec::new();
    let mut total_bytes = 0usize;
    let mut seen_keys = std::collections::HashSet::new();

    for (k, v) in vars.into_iter().take(MAX_FORWARDED_LLM_ENV_SCAN) {
        if out.len() >= MAX_FORWARDED_LLM_ENV_VARS {
            break;
        }
        if !is_forwardable_llm_env_key(&k) || !is_forwardable_llm_env_value(&v) {
            continue;
        }
        if seen_keys.contains(&k) {
            continue;
        }
        let next_total = total_bytes.saturating_add(k.len() + v.len());
        if next_total > MAX_FORWARDED_LLM_ENV_TOTAL_BYTES {
            continue;
        }
        seen_keys.insert(k.clone());
        total_bytes = next_total;
        out.push((k, v));
    }

    out
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
    if matches!(
        upper.as_str(),
        "LLM_SHELL_ALLOWLIST"
            | "LLM_FS_ROOT"
            | "LLM_TRUSTED_PLUGINS"
            | "LLM_USER"
            | "LLM_USER_NAME"
            | "LLM_EMAIL"
            | "LLM_AUTHENTICATION"
    ) {
        return false;
    }
    !(upper.ends_with("_API_KEY")
        || upper.ends_with("_KEY")
        || upper.contains("_KEY_")
        || is_compact_sensitive_env_alias_suffix_or_segment(&upper)
        || is_generic_sensitive_env_token_suffix_or_segment(&upper)
        || is_shared_sensitive_env_canonical_suffix_or_segment(&upper)
        || is_shared_sensitive_env_namespace_segment(&upper)
        || upper.ends_with("_HONEYCOMB_TEAM")
        || upper.ends_with("_OTEL_EXPORTER_OTLP_HEADERS")
        || upper.ends_with("_OTEL_EXPORTER_OTLP_TRACES_HEADERS")
        || upper.ends_with("_OTEL_EXPORTER_OTLP_METRICS_HEADERS")
        || upper.ends_with("_OTEL_EXPORTER_OTLP_LOGS_HEADERS")
        || upper.ends_with("_SQLCIPHER_KEY")
        || upper.ends_with("_LIBSQL_AUTH_TOKEN")
        || upper.ends_with("_TURSO_AUTH_TOKEN")
        || upper.ends_with("_PGLITE_DATA_DIR")
        || upper.ends_with("_PGLITE_DB_PATH")
        || upper.ends_with("_PGLITE_OPFS_PATH")
        || upper.ends_with("_OPFS_PATH")
        || upper.ends_with("_OPFS_ROOT")
        || upper.ends_with("_BROKER_URL")
        || upper.ends_with("_AMQP_URL")
        || upper.ends_with("_OIDC")
        || upper.ends_with("_OIDC_DATA")
        || upper.ends_with("_OIDC_IDENTITY")
        || upper.ends_with("_ACCESSTOKEN")
        || upper.ends_with("_CLIENT_PRINCIPAL")
        || upper.ends_with("_CLIENT_PRINCIPAL_ID")
        || upper.ends_with("_CLIENT_PRINCIPAL_NAME")
        || upper.ends_with("_CLIENT_PRINCIPAL_IDP")
        || upper.contains("_MS_TOKEN_AAD_")
        || upper.ends_with("_PRINCIPAL")
        || upper.ends_with("_PRINCIPAL_ID")
        || upper.ends_with("_PRINCIPAL_NAME")
        || upper.ends_with("_PRINCIPAL_IDP")
        || upper.ends_with("_GITLAB_USER_ID")
        || upper.ends_with("_GITLAB_USERNAME")
        || upper.ends_with("_GITLAB_USER_LOGIN")
        || upper.ends_with("_GITLAB_USER_EMAIL")
        || upper.contains("_GITLAB_USER_")
        || upper.ends_with("_USERID")
        || upper.ends_with("_USERNAME")
        || upper.ends_with("_USER_LOGIN")
        || upper.ends_with("_GITHUB_USER_ID")
        || upper.ends_with("_GITHUB_LOGIN")
        || upper.ends_with("_GITHUB_USER_EMAIL")
        || upper.contains("_GITHUB_USER_")
        || upper.ends_with("_BITBUCKET_USER")
        || upper.ends_with("_BITBUCKET_UUID")
        || upper.ends_with("_BITBUCKET_USER_EMAIL")
        || upper.contains("_BITBUCKET_USER_")
        || upper.ends_with("_USER_ID")
        || upper.ends_with("_USER_EMAIL")
        || upper.ends_with("_GROUPS")
        || upper.ends_with("_FORWARDED_USER")
        || upper.ends_with("_FORWARDED_GROUPS")
        || upper.contains("_FORWARDED_USER_")
        || upper.ends_with("_REMOTE_USER")
        || upper.ends_with("_REMOTE_EMAIL")
        || upper.ends_with("_REMOTE_GROUPS")
        || upper.contains("_REMOTE_USER_")
        || upper.ends_with("_ORIGINAL_USER")
        || upper.ends_with("_ORIGINAL_GROUPS")
        || upper.ends_with("_AUTH_REQUEST_USER")
        || upper.ends_with("_AUTH_REQUEST_USER_ID")
        || upper.ends_with("_AUTH_REQUEST_UID")
        || upper.ends_with("_AUTH_REQUEST_NAME")
        || upper.ends_with("_AUTH_REQUEST_EMAIL")
        || upper.contains("_AUTH_REQUEST_")
        || upper.ends_with("_AUTH_REQUEST_GROUPS")
        || upper.ends_with("_AUTH_REQUEST_PREFERRED_USERNAME")
        || upper.ends_with("_IMPERSONATE_USER")
        || upper.ends_with("_IMPERSONATE_GROUP")
        || upper.ends_with("_IMPERSONATE_UID")
        || upper.ends_with("_IMPERSONATE_EXTRA")
        || upper.contains("_IMPERSONATE_EXTRA_")
        || upper.ends_with("_FORWARDED_EMAIL")
        || upper.ends_with("_AUTH_USER")
        || upper.ends_with("_AUTH_EMAIL")
        || upper.contains("_AUTH_USER_")
        || upper.ends_with("_AUTHENTICATED_USERID")
        || upper.ends_with("_AUTHENTICATED_USER_ID")
        || upper.ends_with("_AUTHENTICATED_USER_EMAIL")
        || upper.ends_with("_AUTHENTICATED_EMAIL")
        || upper.ends_with("_AUTHENTICATED_USER")
        || upper.ends_with("_AUTHENTICATED_USER_NAME")
        || upper.ends_with("_AUTHENTICATED_GROUPS")
        || upper.contains("_AUTHENTICATED_USER_")
        || upper.ends_with("_VERIFIED_USER")
        || upper.ends_with("_VERIFIED_USER_ID")
        || upper.ends_with("_VERIFIED_USERID")
        || upper.ends_with("_VERIFIED_USERNAME")
        || upper.ends_with("_VERIFIED_EMAIL")
        || upper.contains("_VERIFIED_USER_")
        || upper.ends_with("_GOOG_AUTHENTICATED_USER_EMAIL")
        || upper.ends_with("_GOOG_AUTHENTICATED_USER_ID")
        || upper.contains("_GOOG_AUTHENTICATED_USER_")
        || upper.ends_with("_GOOGLE_AUTHENTICATED_USER_EMAIL")
        || upper.ends_with("_GOOGLE_AUTHENTICATED_USER_ID")
        || upper.contains("_GOOGLE_AUTHENTICATED_USER_")
        || upper.ends_with("_END_USER")
        || upper.ends_with("_END_USER_EMAIL")
        || upper.contains("_END_USER_")
        || upper.ends_with("_CF_ACCESS_AUTHENTICATED_USER_ID")
        || upper.contains("_CF_ACCESS_AUTHENTICATED_USER_")
        || upper.contains("_CF_ACCESS_CLIENT_")
        || upper.contains("_CLOUDFLARE_ACCESS_CLIENT_")
        || upper.contains("_CF_ACCESS_")
        || upper.contains("_CF_API_")
        || upper.contains("_CLOUDFLARE_ACCESS_")
        || upper.contains("_CLOUDFLARE_API_")
        || upper.contains("_MB_DB_")
        || upper.contains("_OP_SERVICE_")
        || upper.contains("_CLOUDFLARE_TUNNEL_")
        || upper.contains("_NEW_RELIC_")
        || upper.contains("_OCI_CLI_")
        || upper.contains("_NPM_CONFIG_")
        || upper.contains("_NODE_AUTH_")
        || upper.contains("_YARN_NPM_")
        || upper.contains("_MB_JWT_")
        || upper.contains("_MB_ENCRYPTION_")
        || upper.ends_with("_FORWARDED_IP")
        || upper.ends_with("_FORWARDED_FOR")
        || upper.ends_with("_FORWARDED_HOST")
        || upper.contains("_FORWARDED_HOST_")
        || upper.ends_with("_FORWARDED_CLIENT_IP")
        || upper.ends_with("_FORWARDED_SCHEME")
        || upper.ends_with("_AWS_EC2_METADATA_TOKEN")
        || upper.ends_with("_AWS_EC2_METADATA_TOKEN_TTL_SECONDS")
        || upper.ends_with("_AWS_CONTAINER_CREDENTIALS_RELATIVE_URI")
        || upper.ends_with("_AWS_CONTAINER_CREDENTIALS_FULL_URI")
        || upper.ends_with("_AWS_CONTAINER_AUTHORIZATION_TOKEN")
        || upper.ends_with("_AWS_WEB_IDENTITY_TOKEN_FILE")
        || upper.ends_with("_METADATA_FLAVOR")
        || upper.ends_with("_GOOGLE_METADATA_REQUEST")
        || upper.ends_with("_GOOGLE_APPLICATION_CREDENTIALS")
        || upper.ends_with("_GCE_METADATA_HOST")
        || upper.ends_with("_CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE")
        || upper.ends_with("_AZURE_FEDERATED_TOKEN_FILE")
        || upper.ends_with("_IDENTITY_ENDPOINT")
        || upper.ends_with("_IDENTITY_HEADER")
        || upper.ends_with("_IMDS_ENDPOINT")
        || upper.ends_with("_MSI_ENDPOINT")
        || upper.ends_with("_ENVOY_ORIGINAL_PATH")
        || upper.ends_with("_ENVOY_ORIGINAL_URL")
        || upper.ends_with("_FASTLY_CLIENT_IP")
        || upper.ends_with("_SSL_CLIENT_SAN"))
}

