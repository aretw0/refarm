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
        || upper.ends_with("_API_HASH")
        || upper.ends_with("_KEY")
        || upper.contains("_KEY_")
        || is_compact_sensitive_env_alias_suffix_or_segment(&upper)
        || is_generic_sensitive_env_token_suffix_or_segment(&upper)
        || upper.ends_with("_WEBHOOK_URL")
        || upper.ends_with("_WEBHOOK_SECRET")
        || upper.ends_with("_WEBHOOK_SECRET_TOKEN")
        || upper.ends_with("_HMAC_SHA256")
        || upper.ends_with("_REQUEST_TIMESTAMP")
        || upper.contains("_REQUEST_TIMESTAMP_")
        || upper.ends_with("_PRIVATE_KEY")
        || upper.contains("_PRIVATE_KEY_")
        || upper.ends_with("_KEY_FILE")
        || upper.contains("_KEY_FILE_")
        || upper.ends_with("_TOKEN_FILE")
        || upper.contains("_TOKEN_FILE_")
        || upper.ends_with("_CREDENTIAL_FILE")
        || upper.contains("_CREDENTIAL_FILE_")
        || upper.ends_with("_CREDENTIALS_FILE")
        || upper.contains("_CREDENTIALS_FILE_")
        || upper.ends_with("_ACCESS_KEY")
        || upper.contains("_ACCESS_KEY_")
        || upper.ends_with("_SIGNING_KEY")
        || upper.contains("_SIGNING_KEY_")
        || upper.ends_with("_AUTH_HEADER")
        || upper.ends_with("_AUTHORIZATION_HEADER")
        || upper.ends_with("_HONEYCOMB_TEAM")
        || upper.ends_with("_OTEL_EXPORTER_OTLP_HEADERS")
        || upper.ends_with("_OTEL_EXPORTER_OTLP_TRACES_HEADERS")
        || upper.ends_with("_OTEL_EXPORTER_OTLP_METRICS_HEADERS")
        || upper.ends_with("_OTEL_EXPORTER_OTLP_LOGS_HEADERS")
        || upper.ends_with("_DATABASE_URL")
        || upper.contains("_DATABASE_URL_")
        || upper.ends_with("_DATABASE_DSN")
        || upper.contains("_DATABASE_DSN_")
        || upper.ends_with("_REDIS_URL")
        || upper.contains("_REDIS_URL_")
        || upper.ends_with("_MONGODB_URI")
        || upper.contains("_MONGODB_URI_")
        || upper.ends_with("_POSTGRES_URL")
        || upper.contains("_POSTGRES_URL_")
        || upper.ends_with("_MYSQL_URL")
        || upper.contains("_MYSQL_URL_")
        || upper.ends_with("_SUPABASE_DB_URL")
        || upper.contains("_SUPABASE_DB_URL_")
        || upper.ends_with("_METABASE_DB_CONNECTION_URI")
        || upper.contains("_METABASE_DB_CONNECTION_URI_")
        || upper.ends_with("_MB_DB_CONNECTION_URI")
        || upper.contains("_MB_DB_CONNECTION_URI_")
        || upper.ends_with("_SQLITE_URL")
        || upper.ends_with("_SQLITE_PATH")
        || upper.ends_with("_SQLITE_FILE")
        || upper.ends_with("_SQLITE_TMPDIR")
        || upper.ends_with("_SQLITE_HISTORY")
        || upper.contains("_SQLITE_")
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
        || upper.ends_with("_PROXY_URL")
        || upper.contains("_PROXY_URL_")
        || upper.ends_with("_NO_PROXY")
        || upper.contains("_NO_PROXY_")
        || upper.ends_with("_CA_BUNDLE")
        || upper.contains("_CA_BUNDLE_")
        || upper.ends_with("_CA_FILE")
        || upper.contains("_CA_FILE_")
        || upper.ends_with("_CA_PATH")
        || upper.contains("_CA_PATH_")
        || upper.ends_with("_TLS_INSECURE")
        || upper.contains("_TLS_INSECURE_")
        || upper.ends_with("_SSL_VERIFY")
        || upper.contains("_SSL_VERIFY_")
        || upper.ends_with("_VERIFY_SSL")
        || upper.contains("_VERIFY_SSL_")
        || upper.ends_with("_SESSION_ID")
        || upper.ends_with("_OIDC")
        || upper.ends_with("_OIDC_DATA")
        || upper.ends_with("_OIDC_IDENTITY")
        || upper.ends_with("_ACCESSTOKEN")
        || upper.contains("_OIDC_")
        || upper.contains("_AMZN_OIDC_")
        || upper.ends_with("_CLIENT_PRINCIPAL")
        || upper.ends_with("_CLIENT_PRINCIPAL_ID")
        || upper.ends_with("_CLIENT_PRINCIPAL_NAME")
        || upper.ends_with("_CLIENT_PRINCIPAL_IDP")
        || upper.contains("_CLIENT_PRINCIPAL_")
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
        || upper.contains("_CF_API_")
        || upper.contains("_CLOUDFLARE_ACCESS_")
        || upper.contains("_CLOUDFLARE_API_")
        || upper.contains("_SUPABASE_")
        || upper.contains("_METABASE_")
        || upper.contains("_MB_DB_")
        || upper.contains("_DATABASE_")
        || upper.contains("_REDIS_")
        || upper.contains("_MONGODB_")
        || upper.contains("_POSTGRES_")
        || upper.contains("_MYSQL_")
        || upper.contains("_BROKER_")
        || upper.contains("_AMQP_")
        || upper.contains("_KAFKA_")
        || upper.contains("_NATS_")
        || upper.contains("_RABBITMQ_")
        || upper.contains("_REDPANDA_")
        || upper.contains("_NEON_")
        || upper.contains("_PLANETSCALE_")
        || upper.contains("_UPSTASH_")
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
        || upper.contains("_SIGNAL_")
        || upper.contains("_TWILIO_")
        || upper.contains("_STRIPE_")
        || upper.contains("_SHOPIFY_")
        || upper.contains("_GITEA_")
        || upper.contains("_GOGS_")
        || upper.contains("_SENDGRID_")
        || upper.contains("_K8S_")
        || upper.contains("_KUBE_")
        || upper.contains("_HELM_")
        || upper.contains("_DOCKER_")
        || upper.contains("_REGISTRY_")
        || upper.contains("_CONTAINERS_")
        || upper.contains("_GHCR_")
        || upper.contains("_QUAY_")
        || upper.contains("_HARBOR_")
        || upper.contains("_ARTIFACTORY_")
        || upper.contains("_JFROG_")
        || upper.contains("_MAILGUN_")
        || upper.contains("_POSTMARK_")
        || upper.contains("_RESEND_")
        || upper.contains("_NGROK_")
        || upper.contains("_VAULT_")
        || upper.contains("_ARGOCD_")
        || upper.contains("_TERRAFORM_")
        || upper.contains("_PULUMI_")
        || upper.contains("_DOPPLER_")
        || upper.contains("_INFISICAL_")
        || upper.contains("_OP_SERVICE_")
        || upper.contains("_SOPS_")
        || upper.contains("_SIGSTORE_")
        || upper.contains("_COSIGN_")
        || upper.contains("_TAILSCALE_")
        || upper.contains("_TS_")
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
        || upper.contains("_ACTIONS_")
        || upper.contains("_CI_")
        || upper.contains("_RUNNER_")
        || upper.contains("_GITHUB_")
        || upper.contains("_GITLAB_")
        || upper.contains("_BITBUCKET_")
        || upper.contains("_CIRCLECI_")
        || upper.contains("_BUILDKITE_")
        || upper.contains("_DRONE_")
        || upper.contains("_JENKINS_")
        || upper.contains("_CODECOV_")
        || upper.contains("_SONAR_")
        || upper.contains("_OCI_CLI_")
        || upper.contains("_OCI_")
        || upper.contains("_PROXY_")
        || upper.contains("_FORWARDED_")
        || upper.contains("_ORIGINAL_")
        || upper.contains("_ENVOY_")
        || upper.contains("_CURL_")
        || upper.contains("_WGET_")
        || upper.contains("_GIT_")
        || upper.contains("_SSH_")
        || upper.contains("_NPM_CONFIG_")
        || upper.contains("_NPM_")
        || upper.contains("_NODE_AUTH_")
        || upper.contains("_YARN_")
        || upper.contains("_YARN_NPM_")
        || upper.contains("_PNPM_")
        || upper.contains("_PIP_")
        || upper.contains("_UV_")
        || upper.contains("_POETRY_")
        || upper.contains("_BUNDLE_")
        || upper.contains("_CARGO_")
        || upper.contains("_RUSTUP_")
        || upper.contains("_GEM_")
        || upper.contains("_BUN_")
        || upper.contains("_PYPI_")
        || upper.contains("_TWINE_")
        || upper.contains("_RUBYGEMS_")
        || upper.contains("_NUGET_")
        || upper.contains("_FASTLY_")
        || upper.contains("_AKAMAI_")
        || upper.contains("_NETLIFY_")
        || upper.contains("_VERCEL_")
        || upper.contains("_RENDER_")
        || upper.contains("_RAILWAY_")
        || upper.contains("_HEROKU_")
        || upper.contains("_FLY_")
        || upper.contains("_DIGITALOCEAN_")
        || upper.contains("_LINODE_")
        || upper.contains("_HCLOUD_")
        || upper.contains("_VULTR_")
        || upper.contains("_SCW_")
        || upper.contains("_AWS_")
        || upper.contains("_AZURE_")
        || upper.contains("_ARM_")
        || upper.contains("_GOOGLE_")
        || upper.contains("_GCP_")
        || upper.contains("_CLOUDSDK_")
        || upper.contains("_MSI_")
        || upper.contains("_IMDS_")
        || upper.contains("_IDENTITY_")
        || upper.contains("_MB_JWT_")
        || upper.contains("_MB_ENCRYPTION_")
        || upper.ends_with("_FORWARDED_IP")
        || upper.ends_with("_FORWARDED_FOR")
        || upper.ends_with("_FORWARDED_HOST")
        || upper.contains("_FORWARDED_HOST_")
        || upper.ends_with("_FORWARDED_PROTO")
        || upper.contains("_FORWARDED_PROTO_")
        || upper.ends_with("_FORWARDED_PROTOCOL")
        || upper.contains("_FORWARDED_PROTOCOL_")
        || upper.ends_with("_FORWARDED_PORT")
        || upper.contains("_FORWARDED_PORT_")
        || upper.ends_with("_ORIGINAL_FORWARDED_FOR")
        || upper.contains("_ORIGINAL_FORWARDED_FOR_")
        || upper.ends_with("_ORIGINAL_FORWARDED_HOST")
        || upper.contains("_ORIGINAL_FORWARDED_HOST_")
        || upper.ends_with("_ORIGINAL_FORWARDED_PROTO")
        || upper.contains("_ORIGINAL_FORWARDED_PROTO_")
        || upper.ends_with("_ORIGINAL_FORWARDED_PROTOCOL")
        || upper.contains("_ORIGINAL_FORWARDED_PROTOCOL_")
        || upper.ends_with("_ORIGINAL_FORWARDED_SCHEME")
        || upper.contains("_ORIGINAL_FORWARDED_SCHEME_")
        || upper.ends_with("_ORIGINAL_FORWARDED_PORT")
        || upper.contains("_ORIGINAL_FORWARDED_PORT_")
        || upper.ends_with("_ORIGINAL_FORWARDED_PREFIX")
        || upper.contains("_ORIGINAL_FORWARDED_PREFIX_")
        || upper.ends_with("_ORIGINAL_FORWARDED_SERVER")
        || upper.contains("_ORIGINAL_FORWARDED_SERVER_")
        || upper.ends_with("_ORIGINAL_HOST")
        || upper.contains("_ORIGINAL_HOST_")
        || upper.ends_with("_FORWARDED_PREFIX")
        || upper.contains("_FORWARDED_PREFIX_")
        || upper.ends_with("_FORWARDED_SERVER")
        || upper.contains("_FORWARDED_SERVER_")
        || upper.ends_with("_FORWARDED_SSL")
        || upper.contains("_FORWARDED_SSL_")
        || upper.ends_with("_FORWARDED_CLIENT_IP")
        || upper.ends_with("_FORWARDED_SCHEME")
        || upper.ends_with("_FORWARDED_URI")
        || upper.ends_with("_URL_SCHEME")
        || upper.contains("_URL_SCHEME_")
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
        || upper.contains("_REWRITE_URL_")
        || upper.ends_with("_REWRITE_URI")
        || upper.contains("_REWRITE_URI_")
        || upper.ends_with("_REAL_IP")
        || upper.contains("_REAL_IP_")
        || upper.ends_with("_CLIENT_IP")
        || upper.ends_with("_TRUE_CLIENT_IP")
        || upper.ends_with("_CF_CONNECTING_IP")
        || upper.contains("_CF_CONNECTING_IP_")
        || upper.ends_with("_CLUSTER_CLIENT_IP")
        || upper.ends_with("_ENVOY_EXTERNAL_ADDRESS")
        || upper.contains("_ENVOY_EXTERNAL_ADDRESS_")
        || upper.ends_with("_ENVOY_PEER_METADATA")
        || upper.ends_with("_ENVOY_PEER_METADATA_ID")
        || upper.contains("_ENVOY_PEER_METADATA_")
        || upper.ends_with("_FASTLY_CLIENT_IP")
        || upper.ends_with("_CLIENT_DN")
        || upper.ends_with("_CLIENT_SAN")
        || upper.ends_with("_CLIENT_CERT_CHAIN")
        || upper.ends_with("_KUBE_CONFIG_PATH")
        || upper.ends_with("_K8S_AWS_ID")
        || upper.ends_with("_DOCKER_HOST")
        || upper.ends_with("_REGISTRY_URL")
        || upper.ends_with("_CONTAINERS_REGISTRIES_CONF")
        || upper.ends_with("_GHCR_HOST")
        || upper.ends_with("_QUAY_ORGANIZATION")
        || upper.ends_with("_HARBOR_URL")
        || upper.ends_with("_ARTIFACTORY_URL")
        || upper.ends_with("_JFROG_URL")
        || upper.ends_with("_CLIENT_VERIFY")
        || upper.ends_with("_SSL_CLIENT_VERIFY")
        || upper.ends_with("_FORWARDED_CLIENT_CERT")
        || upper.contains("_FORWARDED_CLIENT_CERT_")
        || upper.ends_with("_CLIENT_CERT")
        || upper.ends_with("_SSL_CLIENT_CERT")
        || upper.contains("_SSL_CLIENT_CERT_")
        || upper.ends_with("_ARR_CLIENTCERT")
        || upper.ends_with("_HTTP_METHOD_OVERRIDE")
        || upper.contains("_HTTP_METHOD_OVERRIDE_")
        || upper.ends_with("_METHOD_OVERRIDE")
        || upper.contains("_METHOD_OVERRIDE_")
        || upper.ends_with("_HTTP_METHOD")
        || upper.ends_with("_FORWARDED_METHOD")
        || upper.contains("_FORWARDED_METHOD_")
        || upper.ends_with("_ORIGINAL_METHOD")
        || upper.contains("_ORIGINAL_METHOD_")
        || upper.ends_with("_ORIGINAL_PATH")
        || upper.contains("_ORIGINAL_PATH_")
        || upper.ends_with("_PROXY_AUTHORIZATION")
        || upper.ends_with("_PROXY_AUTHENTICATE")
        || upper.ends_with("_PROXY_AUTHENTICATION_INFO")
        || upper.ends_with("_PROXY_STATUS")
        || upper.contains("_PROXY_STATUS_")
        || upper.ends_with("_AUTHENTICATION_INFO")
        || upper.contains("_AUTHENTICATION_INFO_")
        || upper.ends_with("_PROXY_CONNECTION")
        || upper.contains("_PROXY_CONNECTION_")
        || upper.ends_with("_KEEP_ALIVE")
        || upper.contains("_KEEP_ALIVE_")
        || upper.ends_with("_SSL_CLIENT_DN")
        || upper.ends_with("_SSL_CLIENT_S_DN")
        || upper.ends_with("_SSL_CLIENT_I_DN")
        || upper.ends_with("_SSL_CLIENT_SAN"))
}

