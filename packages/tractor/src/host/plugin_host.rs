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
        || upper.ends_with("_APIKEY")
        || upper.ends_with("_API_HASH")
        || upper.ends_with("_KEY")
        || upper.ends_with("_AUTHKEY")
        || upper.ends_with("_TOKEN")
        || upper.ends_with("_AUTHTOKEN")
        || upper.ends_with("_WEBHOOK_URL")
        || upper.ends_with("_SIGNATURE")
        || upper.ends_with("_HMAC")
        || upper.ends_with("_HMAC_SHA256")
        || upper.ends_with("_REQUEST_TIMESTAMP")
        || upper.ends_with("_SECRET")
        || upper.ends_with("_COOKIE")
        || upper.ends_with("_PASSWORD")
        || upper.ends_with("_CREDENTIALS")
        || upper.ends_with("_CERT")
        || upper.ends_with("_CERTIFICATE")
        || upper.ends_with("_PRIVATE_KEY")
        || upper.ends_with("_KEY_FILE")
        || upper.ends_with("_TOKEN_FILE")
        || upper.ends_with("_CREDENTIAL_FILE")
        || upper.ends_with("_CREDENTIALS_FILE")
        || upper.ends_with("_ACCESS_KEY")
        || upper.ends_with("_SIGNING_KEY")
        || upper.ends_with("_AUTH")
        || upper.ends_with("_AUTH_HEADER")
        || upper.ends_with("_AUTHORIZATION")
        || upper.ends_with("_AUTHORIZATION_HEADER")
        || upper.ends_with("_BEARER")
        || upper.ends_with("_HONEYCOMB_TEAM")
        || upper.ends_with("_OTEL_EXPORTER_OTLP_HEADERS")
        || upper.ends_with("_OTEL_EXPORTER_OTLP_TRACES_HEADERS")
        || upper.ends_with("_OTEL_EXPORTER_OTLP_METRICS_HEADERS")
        || upper.ends_with("_OTEL_EXPORTER_OTLP_LOGS_HEADERS")
        || upper.ends_with("_DATABASE_URL")
        || upper.ends_with("_DATABASE_DSN")
        || upper.ends_with("_REDIS_URL")
        || upper.ends_with("_MONGODB_URI")
        || upper.ends_with("_POSTGRES_URL")
        || upper.ends_with("_MYSQL_URL")
        || upper.ends_with("_SUPABASE_DB_URL")
        || upper.ends_with("_METABASE_DB_CONNECTION_URI")
        || upper.ends_with("_MB_DB_CONNECTION_URI")
        || upper.ends_with("_SQLITE_URL")
        || upper.ends_with("_SQLITE_PATH")
        || upper.ends_with("_SQLITE_FILE")
        || upper.ends_with("_SQLITE_TMPDIR")
        || upper.ends_with("_SQLITE_HISTORY")
        || upper.ends_with("_SQLCIPHER_KEY")
        || upper.ends_with("_LIBSQL_AUTH_TOKEN")
        || upper.ends_with("_TURSO_AUTH_TOKEN")
        || upper.ends_with("_PGLITE_DATA_DIR")
        || upper.ends_with("_PGLITE_DB_PATH")
        || upper.ends_with("_PGLITE_OPFS_PATH")
        || upper.contains("_PGLITE_")
        || upper.contains("_LIBSQL_")
        || upper.contains("_TURSO_")
        || upper.contains("_SQLCIPHER_")
        || upper.ends_with("_OPFS_PATH")
        || upper.ends_with("_OPFS_ROOT")
        || upper.contains("_OPFS_")
        || upper.ends_with("_BROKER_URL")
        || upper.ends_with("_AMQP_URL")
        || upper.ends_with("_PROXY")
        || upper.ends_with("_PROXY_URL")
        || upper.ends_with("_NO_PROXY")
        || upper.ends_with("_CA_BUNDLE")
        || upper.ends_with("_CA_FILE")
        || upper.ends_with("_CA_PATH")
        || upper.ends_with("_TLS_INSECURE")
        || upper.ends_with("_INSECURE")
        || upper.ends_with("_SSL_VERIFY")
        || upper.ends_with("_VERIFY_SSL")
        || upper.ends_with("_SOCK")
        || upper.ends_with("_SOCKET")
        || upper.ends_with("_JWT")
        || upper.ends_with("_ASSERTION")
        || upper.ends_with("_SESSION")
        || upper.ends_with("_SESSION_ID")
        || upper.ends_with("_OIDC")
        || upper.ends_with("_OIDC_DATA")
        || upper.ends_with("_OIDC_IDENTITY")
        || upper.ends_with("_ACCESSTOKEN")
        || upper.contains("_AMZN_OIDC_")
        || upper.ends_with("_USERINFO")
        || upper.ends_with("_CLIENT_PRINCIPAL")
        || upper.ends_with("_CLIENT_PRINCIPAL_ID")
        || upper.ends_with("_CLIENT_PRINCIPAL_NAME")
        || upper.ends_with("_CLIENT_PRINCIPAL_IDP")
        || upper.contains("_MS_TOKEN_AAD_")
        || upper.ends_with("_PRINCIPAL")
        || upper.ends_with("_PRINCIPAL_ID")
        || upper.ends_with("_PRINCIPAL_NAME")
        || upper.ends_with("_PRINCIPAL_IDP")
        || upper.contains("_PRINCIPAL_")
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
        || upper.contains("_CLOUDFLARE_ACCESS_")
        || upper.contains("_SUPABASE_")
        || upper.contains("_METABASE_")
        || upper.contains("_MB_DB_")
        || upper.contains("_TWITTER_")
        || upper.contains("_FACEBOOK_")
        || upper.contains("_WHATSAPP_")
        || upper.contains("_INSTAGRAM_")
        || upper.contains("_META_")
        || upper.contains("_TELEGRAM_")
        || upper.contains("_SLACK_")
        || upper.contains("_DISCORD_")
        || upper.contains("_LINE_")
        || upper.contains("_MATRIX_")
        || upper.contains("_NGROK_")
        || upper.contains("_TAILSCALE_")
        || upper.contains("_CLOUDFLARE_TUNNEL_")
        || upper.contains("_SENTRY_")
        || upper.contains("_DATADOG_")
        || upper.contains("_NEW_RELIC_")
        || upper.contains("_HONEYCOMB_")
        || upper.contains("_LOGDNA_")
        || upper.contains("_ROLLBAR_")
        || upper.contains("_BUGSNAG_")
        || upper.contains("_PAGERDUTY_")
        || upper.contains("_GRAFANA_")
        || upper.contains("_OTEL_")
        || upper.contains("_OTLP_")
        || upper.contains("_CIRCLECI_")
        || upper.contains("_BUILDKITE_")
        || upper.contains("_DRONE_")
        || upper.contains("_JENKINS_")
        || upper.contains("_CODECOV_")
        || upper.contains("_SONAR_")
        || upper.contains("_MB_JWT_")
        || upper.contains("_MB_ENCRYPTION_")
        || upper.ends_with("_FORWARDED_IP")
        || upper.ends_with("_FORWARDED_FOR")
        || upper.ends_with("_FORWARDED_HOST")
        || upper.ends_with("_FORWARDED_PROTO")
        || upper.ends_with("_FORWARDED_PROTOCOL")
        || upper.ends_with("_FORWARDED_PORT")
        || upper.ends_with("_ORIGINAL_FORWARDED_FOR")
        || upper.ends_with("_ORIGINAL_FORWARDED_HOST")
        || upper.ends_with("_ORIGINAL_FORWARDED_PROTO")
        || upper.ends_with("_ORIGINAL_FORWARDED_PROTOCOL")
        || upper.ends_with("_ORIGINAL_FORWARDED_SCHEME")
        || upper.ends_with("_ORIGINAL_FORWARDED_PORT")
        || upper.ends_with("_ORIGINAL_FORWARDED_PREFIX")
        || upper.ends_with("_ORIGINAL_FORWARDED_SERVER")
        || upper.ends_with("_ORIGINAL_HOST")
        || upper.ends_with("_FORWARDED_PREFIX")
        || upper.ends_with("_FORWARDED_SERVER")
        || upper.ends_with("_FORWARDED_SSL")
        || upper.ends_with("_FORWARDED_CLIENT_IP")
        || upper.ends_with("_FORWARDED_SCHEME")
        || upper.ends_with("_FORWARDED_URI")
        || upper.ends_with("_URL_SCHEME")
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
        || upper.ends_with("_ORIGINAL_URL")
        || upper.ends_with("_ORIGINAL_URI")
        || upper.ends_with("_ENVOY_ORIGINAL_PATH")
        || upper.ends_with("_ENVOY_ORIGINAL_URL")
        || upper.ends_with("_REWRITE_URL")
        || upper.ends_with("_REWRITE_URI")
        || upper.ends_with("_REAL_IP")
        || upper.ends_with("_CLIENT_IP")
        || upper.ends_with("_TRUE_CLIENT_IP")
        || upper.ends_with("_CF_CONNECTING_IP")
        || upper.ends_with("_CLUSTER_CLIENT_IP")
        || upper.ends_with("_ENVOY_EXTERNAL_ADDRESS")
        || upper.ends_with("_ENVOY_PEER_METADATA")
        || upper.ends_with("_ENVOY_PEER_METADATA_ID")
        || upper.contains("_ENVOY_PEER_METADATA_")
        || upper.ends_with("_FASTLY_CLIENT_IP")
        || upper.ends_with("_CLIENT_DN")
        || upper.ends_with("_CLIENT_SAN")
        || upper.ends_with("_CLIENT_CERT_CHAIN")
        || upper.ends_with("_KUBECONFIG")
        || upper.ends_with("_KUBE_CONFIG_PATH")
        || upper.ends_with("_KUBEAPISERVER")
        || upper.ends_with("_KUBETOKEN")
        || upper.ends_with("_KUBECAFILE")
        || upper.ends_with("_K8S_AWS_ID")
        || upper.ends_with("_CLIENT_VERIFY")
        || upper.ends_with("_SSL_CLIENT_VERIFY")
        || upper.ends_with("_FORWARDED_CLIENT_CERT")
        || upper.ends_with("_CLIENT_CERT")
        || upper.ends_with("_SSL_CLIENT_CERT")
        || upper.ends_with("_ARR_CLIENTCERT")
        || upper.ends_with("_HTTP_METHOD_OVERRIDE")
        || upper.ends_with("_METHOD_OVERRIDE")
        || upper.ends_with("_HTTP_METHOD")
        || upper.ends_with("_FORWARDED_METHOD")
        || upper.ends_with("_ORIGINAL_METHOD")
        || upper.ends_with("_ORIGINAL_PATH")
        || upper.ends_with("_PROXY_AUTHORIZATION")
        || upper.ends_with("_PROXY_AUTHENTICATE")
        || upper.ends_with("_PROXY_AUTHENTICATION_INFO")
        || upper.ends_with("_PROXY_STATUS")
        || upper.ends_with("_AUTHENTICATION_INFO")
        || upper.ends_with("_PROXY_CONNECTION")
        || upper.ends_with("_TRAILER")
        || upper.ends_with("_UPGRADE")
        || upper.ends_with("_KEEP_ALIVE")
        || upper.ends_with("_TE")
        || upper.ends_with("_SSL_CLIENT_DN")
        || upper.ends_with("_SSL_CLIENT_S_DN")
        || upper.ends_with("_SSL_CLIENT_I_DN")
        || upper.ends_with("_SSL_CLIENT_SAN"))
}

fn is_forwardable_llm_env_value(value: &str) -> bool {
    const MAX_LLM_ENV_VALUE_LEN: usize = 4096;
    !value.trim().is_empty()
        && value.trim() == value
        && value.len() <= MAX_LLM_ENV_VALUE_LEN
        && value.is_ascii()
        && !value.chars().any(|c| c.is_whitespace())
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
#[path = "plugin_host_tests.rs"]
mod tests;
