// Agent tool bridge — host implementations of `agent-fs`, `agent-shell`, and `host-spawn`.
//
// Pi Agent's 4 primitives exposed to WASM plugins:
//   read, write, edit  → `agent-fs`
//   spawn              → `agent-shell`
//
// `host-spawn` is the mechanism import for agent-tools.wasm:
//   the WASM component enforces policy; `spawn_process` does the actual OS fork/exec.

use std::io::Write as _;
use std::path::{Path, PathBuf};

use tokio::io::{AsyncRead, AsyncReadExt as _, AsyncWriteExt as _};
use tokio::process::Command;
use tokio::time::{timeout, Duration};

use crate::host::agent_tools_bindings::refarm::agent_tools::host_spawn::Host as HostSpawnHost;
use crate::host::plugin_host::refarm::plugin::{
    agent_fs::Host as AgentFsHost,
    agent_shell::{Host as AgentShellHost, SpawnRequest, SpawnResult},
};
use crate::host::wasi_bridge::TractorNativeBindings;

// ── agent-fs ──────────────────────────────────────────────────────────────────

#[wasmtime::component::__internal::async_trait]
impl AgentFsHost for TractorNativeBindings {
    async fn read(&mut self, path: String) -> Result<Vec<u8>, String> {
        enforce_fs_root(&path)?;
        tokio::fs::read(&path)
            .await
            .map_err(|e| format!("read({path}): {e}"))
    }

    async fn write(&mut self, path: String, content: Vec<u8>) -> Result<(), String> {
        enforce_fs_root(&path)?;
        atomic_write(&path, &content)
            .await
            .map_err(|e| format!("write({path}): {e}"))
    }

    async fn edit(&mut self, path: String, diff: String) -> Result<(), String> {
        enforce_fs_root(&path)?;

        let original = tokio::fs::read_to_string(&path)
            .await
            .map_err(|e| format!("edit/read({path}): {e}"))?;

        let patch = diffy::Patch::from_str(&diff)
            .map_err(|e| format!("edit/parse-diff: {e}"))?;

        let patched = diffy::apply(&original, &patch)
            .map_err(|e| format!("edit/apply({path}): {e}"))?;

        atomic_write(&path, patched.as_bytes())
            .await
            .map_err(|e| format!("edit/write({path}): {e}"))
    }
}

// ── agent-shell (host primitive — Fase 1 fallback) ────────────────────────────
//
// When agent-tools.wasm is NOT loaded, TractorNativeBindings satisfies this
// import directly. When agent-tools.wasm IS loaded, its exports replace this
// via Component Model composition (Fase 3 — see HANDOFF.md Tarefa 2B).

#[wasmtime::component::__internal::async_trait]
impl AgentShellHost for TractorNativeBindings {
    async fn spawn(&mut self, req: SpawnRequest) -> Result<SpawnResult, String> {
        enforce_trusted_plugin_for_shell(&self.plugin_id)?;
        if req.argv.is_empty() {
            return Err("spawn: argv must be non-empty".into());
        }
        let (stdout, stderr, exit_code, timed_out) =
            spawn_process(&req.argv, &req.env, req.cwd.as_deref(), req.timeout_ms, req.stdin.as_deref()).await?;
        Ok(SpawnResult { stdout, stderr, exit_code, timed_out })
    }
}

// ── host-spawn (mechanism import for agent-tools.wasm) ───────────────────────
//
// agent-tools.wasm enforces policy (argv non-empty, timeout cap) then calls
// this import. The host does the actual OS fork/exec — no second check needed.

#[wasmtime::component::__internal::async_trait]
impl HostSpawnHost for TractorNativeBindings {
    async fn do_spawn(
        &mut self,
        argv: Vec<String>,
        env: Vec<(String, String)>,
        cwd: Option<String>,
        timeout_ms: u32,
        stdin: Option<Vec<u8>>,
    ) -> Result<(Vec<u8>, Vec<u8>, i32, bool), String> {
        spawn_process(&argv, &env, cwd.as_deref(), timeout_ms, stdin.as_deref()).await
    }
}

// ── Core spawn logic ──────────────────────────────────────────────────────────
//
// Shared by AgentShellHost::spawn (direct host primitive) and HostSpawnHost::do_spawn
// (mechanism import for agent-tools.wasm). Callers must pre-validate argv.

pub(crate) async fn spawn_process(
    argv: &[String],
    env: &[(String, String)],
    cwd: Option<&str>,
    timeout_ms: u32,
    stdin: Option<&[u8]>,
) -> Result<(Vec<u8>, Vec<u8>, i32, bool), String> {
    debug_assert!(!argv.is_empty(), "spawn_process: argv must be non-empty");

    enforce_shell_allowlist(argv)?;
    enforce_spawn_env(env)?;

    if let Some(dir) = cwd {
        enforce_spawn_cwd(dir)?;
    }
    if let Some(stdin_bytes) = stdin {
        if stdin_bytes.len() > MAX_SPAWN_STDIN_LEN {
            return Err("spawn: stdin exceeds max length".to_string());
        }
    }

    let binary = &argv[0];
    let args = &argv[1..];
    let timeout_dur = Duration::from_millis(effective_spawn_timeout_ms(timeout_ms) as u64);

    let mut cmd = Command::new(binary);
    cmd.args(args)
        .env_clear()
        .envs(env.iter().map(|(k, v)| (k.as_str(), v.as_str())))
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .stdin(if stdin.is_some() {
            std::process::Stdio::piped()
        } else {
            std::process::Stdio::null()
        });

    if let Some(dir) = cwd {
        cmd.current_dir(dir);
    }

    let mut child = cmd.spawn().map_err(|e| format!("spawn({binary}): {e}"))?;

    if let Some(stdin_bytes) = stdin {
        if let Some(mut handle) = child.stdin.take() {
            handle
                .write_all(stdin_bytes)
                .await
                .map_err(|e| format!("spawn/stdin: {e}"))?;
        }
    }

    // Drain stdout/stderr on background tasks — lets us call child.kill()
    // if the timeout fires without consuming ownership via wait_with_output.
    let out_pipe = child.stdout.take();
    let err_pipe = child.stderr.take();

    let stdout_task = tokio::spawn(read_spawn_pipe_limited(out_pipe));
    let stderr_task = tokio::spawn(read_spawn_pipe_limited(err_pipe));

    match timeout(timeout_dur, child.wait()).await {
        Ok(Ok(status)) => {
            let stdout = stdout_task.await.unwrap_or_default();
            let stderr = stderr_task.await.unwrap_or_default();
            Ok((stdout, stderr, status.code().unwrap_or(-1), false))
        }
        Ok(Err(e)) => Err(format!("spawn/wait: {e}")),
        Err(_) => {
            stdout_task.abort();
            stderr_task.abort();
            let _ = child.kill().await;
            Ok((vec![], b"process killed: timeout exceeded".to_vec(), -1, true))
        }
    }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async fn atomic_write(path: &str, content: &[u8]) -> anyhow::Result<()> {
    let target = Path::new(path);
    let parent = target
        .parent()
        .ok_or_else(|| anyhow::anyhow!("path has no parent: {path}"))?;

    let tmp = tempfile::NamedTempFile::new_in(parent)?;
    {
        let mut f = tmp.as_file();
        f.write_all(content)?;
        f.sync_all()?;
    }
    tmp.persist(target)?;
    tracing::debug!(path, bytes = content.len(), "atomic_write: ok");
    Ok(())
}

fn enforce_shell_allowlist(argv: &[String]) -> Result<(), String> {
    let allowlist = shell_allowlist_from_env();
    // Backward-compatible default remains permissive for command selection when
    // env var is not set, but structural argv guards must still apply.
    enforce_shell_allowlist_with(argv, allowlist.as_ref())
}

fn enforce_trusted_plugin_for_shell(plugin_id: &str) -> Result<(), String> {
    let Some(allowed) = trusted_plugins_from_refarm_config()? else {
        // Backward-compatible default: permissive when trusted_plugins is not configured.
        return Ok(());
    };
    enforce_trusted_plugin_for_shell_with(plugin_id, Some(&allowed))
}

fn enforce_trusted_plugin_for_shell_with(
    plugin_id: &str,
    allowed: Option<&std::collections::HashSet<String>>,
) -> Result<(), String> {
    let Some(allowed) = allowed else {
        return Ok(());
    };
    let plugin_id = plugin_id.trim();
    if plugin_id.is_empty() {
        return Err("[blocked: plugin id is empty]".to_string());
    }
    if contains_control_chars(plugin_id) {
        return Err("[blocked: plugin id contains control characters]".to_string());
    }
    if !is_safe_plugin_id_token(plugin_id) {
        return Err("[blocked: plugin id has invalid characters]".to_string());
    }
    let normalized_plugin_id = plugin_id.to_ascii_lowercase();
    if allowed.contains("*") || allowed.contains(&normalized_plugin_id) {
        Ok(())
    } else {
        Err(format!("[blocked: plugin '{plugin_id}' not allowed to use agent-shell]"))
    }
}

fn contains_control_chars(value: &str) -> bool {
    value.chars().any(|c| c.is_control())
}

fn contains_whitespace(value: &str) -> bool {
    value.chars().any(|c| c.is_whitespace())
}

fn effective_spawn_timeout_ms(requested: u32) -> u32 {
    requested.clamp(1, MAX_SPAWN_TIMEOUT_MS)
}

const MAX_SHELL_TOKEN_LEN: usize = 256;
const MAX_SHELL_ALLOWLIST_ENTRIES: usize = 256;
const MAX_SHELL_ALLOWLIST_SCAN: usize = 512;
const MAX_SHELL_ALLOWLIST_RAW_LEN: usize = 16 * 1024;
const MAX_SPAWN_ARGV_COUNT: usize = 128;
const MAX_SPAWN_ARG_LEN: usize = 4096;
const MAX_SPAWN_ARGV_TOTAL_BYTES: usize = 64 * 1024;
const MAX_SPAWN_TIMEOUT_MS: u32 = 300_000;
const MAX_TRUSTED_PLUGINS: usize = 256;
const MAX_FS_PATH_LEN: usize = 4096;
const MAX_SPAWN_ENV_KEY_LEN: usize = 128;
const MAX_SPAWN_ENV_VALUE_LEN: usize = 4096;
const MAX_SPAWN_ENV_TOTAL_BYTES: usize = 128 * 1024;
const MAX_SPAWN_ENV_VARS: usize = 128;
const MAX_SPAWN_CWD_LEN: usize = 4096;
const MAX_SPAWN_STDIN_LEN: usize = 1024 * 1024;
const MAX_SPAWN_STDIO_LEN: usize = 1024 * 1024;

async fn read_spawn_pipe_limited<R>(pipe: Option<R>) -> Vec<u8>
where
    R: AsyncRead + Unpin,
{
    let mut buf = Vec::new();
    let Some(mut pipe) = pipe else {
        return buf;
    };
    if (&mut pipe)
        .take(MAX_SPAWN_STDIO_LEN as u64 + 1)
        .read_to_end(&mut buf)
        .await
        .is_err()
    {
        return Vec::new();
    }
    if buf.len() > MAX_SPAWN_STDIO_LEN {
        buf.truncate(MAX_SPAWN_STDIO_LEN);
        buf.extend_from_slice(b"\n[truncated: spawn output exceeded limit]");
    }
    buf
}

fn is_safe_spawn_env_key(key: &str) -> bool {
    if key.is_empty() || key.len() > MAX_SPAWN_ENV_KEY_LEN {
        return false;
    }
    if contains_control_chars(key) || contains_whitespace(key) {
        return false;
    }
    let mut chars = key.chars();
    let Some(first) = chars.next() else {
        return false;
    };
    if !(first.is_ascii_alphabetic() || first == '_') {
        return false;
    }
    chars.all(|c| c.is_ascii_alphanumeric() || c == '_')
}

fn is_blocked_spawn_env_key(key: &str) -> bool {
    let upper = key.to_ascii_uppercase();
    if upper.starts_with("LD_")
        || upper.starts_with("DYLD_")
        || upper.starts_with("MALLOC_")
        || upper.starts_with("GIT_CONFIG_")
        || upper.starts_with("GIT_")
        || upper.starts_with("SSH_")
        || upper.starts_with("NPM_CONFIG_")
        || upper.starts_with("YARN_")
        || upper.starts_with("PNPM_")
        || upper.starts_with("PROXY_")
        || upper.starts_with("FORWARDED_")
        || upper.starts_with("REMOTE_USER_")
        || upper.starts_with("AUTH_REQUEST_")
        || upper.starts_with("AUTH_USER_")
        || upper.starts_with("AUTHENTICATED_USER_")
        || upper.starts_with("END_USER_")
        || upper.starts_with("CLIENT_PRINCIPAL_")
        || upper.starts_with("PRINCIPAL_")
        || upper.starts_with("VERIFIED_USER_")
        || upper.starts_with("IMPERSONATE_EXTRA_")
        || upper.starts_with("ORIGINAL_")
        || upper.starts_with("ENVOY_")
        || upper.starts_with("PIP_")
        || upper.starts_with("UV_")
        || upper.starts_with("POETRY_")
        || upper.starts_with("BUNDLE_")
        || upper.starts_with("GEM_")
        || upper.starts_with("CARGO_")
        || upper.starts_with("RUSTUP_")
        || upper.starts_with("OCI_CLI_")
        || upper.starts_with("OCI_")
        || upper.starts_with("NETRC_")
        || upper.starts_with("CURL_")
        || upper.starts_with("WGET_")
        || upper.starts_with("PGLITE_")
        || upper.starts_with("OPFS_")
        || upper.starts_with("SUPABASE_")
        || upper.starts_with("METABASE_")
        || upper.starts_with("MB_DB_")
        || upper.starts_with("CF_ACCESS_")
        || upper.starts_with("CF_API_")
        || upper.starts_with("CLOUDFLARE_ACCESS_")
        || upper.starts_with("CLOUDFLARE_API_")
        || upper.starts_with("DATABASE_")
        || upper.starts_with("REDIS_")
        || upper.starts_with("MONGODB_")
        || upper.starts_with("POSTGRES_")
        || upper.starts_with("MYSQL_")
        || upper.starts_with("BROKER_")
        || upper.starts_with("AMQP_")
        || upper.starts_with("KAFKA_")
        || upper.starts_with("NATS_")
        || upper.starts_with("RABBITMQ_")
        || upper.starts_with("REDPANDA_")
        || upper.starts_with("MB_JWT_")
        || upper.starts_with("MB_ENCRYPTION_")
        || upper.starts_with("NEON_")
        || upper.starts_with("PLANETSCALE_")
        || upper.starts_with("UPSTASH_")
        || upper.starts_with("SQLITE_")
        || upper.starts_with("LIBSQL_")
        || upper.starts_with("TURSO_")
        || upper.starts_with("SQLCIPHER_")
        || upper.starts_with("TWITTER_")
        || upper.starts_with("FACEBOOK_")
        || upper.starts_with("WHATSAPP_")
        || upper.starts_with("INSTAGRAM_")
        || upper.starts_with("META_")
        || upper.starts_with("TELEGRAM_")
        || upper.starts_with("SLACK_")
        || upper.starts_with("DISCORD_")
        || upper.starts_with("LINE_")
        || upper.starts_with("MATRIX_")
        || upper.starts_with("SIGNAL_")
        || upper.starts_with("TWILIO_")
        || upper.starts_with("STRIPE_")
        || upper.starts_with("SHOPIFY_")
        || upper.starts_with("GITEA_")
        || upper.starts_with("GOGS_")
        || upper.starts_with("SENDGRID_")
        || upper.starts_with("MAILGUN_")
        || upper.starts_with("POSTMARK_")
        || upper.starts_with("RESEND_")
        || upper.starts_with("NGROK_")
        || upper.starts_with("TAILSCALE_")
        || upper.starts_with("TS_")
        || upper.starts_with("CLOUDFLARE_TUNNEL_")
        || upper.ends_with("_WEBHOOK_URL")
        || upper.ends_with("_WEBHOOKURL")
        || upper.ends_with("_WEBHOOK_SECRET")
        || upper.ends_with("_WEBHOOKSECRET")
        || upper.ends_with("_WEBHOOK_SECRET_TOKEN")
        || upper.ends_with("_WEBHOOKSECRETTOKEN")
        || upper.ends_with("_SIGNATURE")
        || upper.ends_with("_SIGNATURETIMESTAMP")
        || upper.ends_with("_HMAC")
        || upper.ends_with("_HMAC_SHA256")
        || upper.ends_with("_HMACSHA256")
        || upper.ends_with("_ASSERTION")
        || upper.ends_with("_JWT")
        || upper.ends_with("_OIDCDATA")
        || upper.ends_with("_OIDCIDENTITY")
        || upper.ends_with("_OIDCISSUER")
        || upper.ends_with("_AMZNOIDCDATA")
        || upper.ends_with("_AMZNOIDCIDENTITY")
        || upper.ends_with("_AMZNOIDCACCESSTOKEN")
        || upper.ends_with("_USERINFO")
        || upper.ends_with("_SESSION")
        || upper.ends_with("_SESSION_ID")
        || upper.ends_with("_SESSIONID")
        || upper.ends_with("_REQUEST_TIMESTAMP")
        || upper.ends_with("_REQUESTTIMESTAMP")
        || upper.ends_with("_INSECURE")
        || upper.ends_with("_TLS_INSECURE")
        || upper.ends_with("_TLSINSECURE")
        || upper.ends_with("_SSL_VERIFY")
        || upper.ends_with("_SSLVERIFY")
        || upper.ends_with("_VERIFY_SSL")
        || upper.ends_with("_VERIFYSSL")
        || upper.ends_with("_URL_SCHEME")
        || upper.ends_with("_URLSCHEME")
        || upper.ends_with("_HTTP_METHOD_OVERRIDE")
        || upper.ends_with("_HTTPMETHODOVERRIDE")
        || upper.ends_with("_METHOD_OVERRIDE")
        || upper.ends_with("_METHODOVERRIDE")
        || upper.ends_with("_HTTP_METHOD")
        || upper.ends_with("_HTTPMETHOD")
        || upper.ends_with("_FORWARDED_METHOD")
        || upper.ends_with("_FORWARDEDMETHOD")
        || upper.ends_with("_ORIGINAL_METHOD")
        || upper.ends_with("_ORIGINALMETHOD")
        || upper.ends_with("_ORIGINAL_PATH")
        || upper.ends_with("_ORIGINALURL")
        || upper.ends_with("_ORIGINALURI")
        || upper.ends_with("_ORIGINALPATH")
        || upper.ends_with("_FORWARDED_PROTO")
        || upper.ends_with("_FORWARDED_PROTOCOL")
        || upper.ends_with("_FORWARDED_PORT")
        || upper.ends_with("_FORWARDED_PREFIX")
        || upper.ends_with("_FORWARDED_SERVER")
        || upper.ends_with("_FORWARDED_SSL")
        || upper.ends_with("_ORIGINAL_FORWARDED_FOR")
        || upper.ends_with("_ORIGINAL_FORWARDED_HOST")
        || upper.ends_with("_ORIGINAL_FORWARDED_PROTO")
        || upper.ends_with("_ORIGINAL_FORWARDED_PROTOCOL")
        || upper.ends_with("_ORIGINAL_FORWARDED_SCHEME")
        || upper.ends_with("_ORIGINAL_FORWARDED_PORT")
        || upper.ends_with("_ORIGINAL_FORWARDED_PREFIX")
        || upper.ends_with("_ORIGINAL_FORWARDED_SERVER")
        || upper.ends_with("_ORIGINAL_HOST")
        || upper.ends_with("_FORWARDED_URI")
        || upper.ends_with("_FORWARDEDURI")
        || upper.ends_with("_ORIGINAL_URI")
        || upper.ends_with("_ORIGINAL_URL")
        || upper.ends_with("_REWRITE_URI")
        || upper.ends_with("_REWRITE_URL")
        || upper.ends_with("_REWRITEURI")
        || upper.ends_with("_REWRITEURL")
        || upper.ends_with("_REAL_IP")
        || upper.ends_with("_REALIP")
        || upper.ends_with("_CLIENT_IP")
        || upper.ends_with("_CLIENTIP")
        || upper.ends_with("_TRUE_CLIENT_IP")
        || upper.ends_with("_TRUECLIENTIP")
        || upper.ends_with("_CF_CONNECTING_IP")
        || upper.ends_with("_CFCONNECTINGIP")
        || upper.ends_with("_CLUSTER_CLIENT_IP")
        || upper.ends_with("_CLUSTERCLIENTIP")
        || upper.ends_with("_ENVOY_EXTERNAL_ADDRESS")
        || upper.ends_with("_ENVOYEXTERNALADDRESS")
        || upper.ends_with("_ENVOYORIGINALPATH")
        || upper.ends_with("_ENVOYORIGINALURL")
        || upper.ends_with("_ENVOY_PEER_METADATA")
        || upper.ends_with("_ENVOYPEERMETADATA")
        || upper.ends_with("_ENVOY_PEER_METADATA_ID")
        || upper.ends_with("_ENVOYPEERMETADATAID")
        || upper.ends_with("_TOKEN")
        || upper.ends_with("_AUTHTOKEN")
        || upper.ends_with("_AUTHKEY")
        || upper.ends_with("_API_KEY")
        || upper.ends_with("_APIKEY")
        || upper.ends_with("_API_HASH")
        || upper.ends_with("_SECRET")
        || upper.ends_with("_AUTH")
        || upper.ends_with("_AUTH_HEADER")
        || upper.ends_with("_AUTHORIZATION")
        || upper.ends_with("_AUTHORIZATION_HEADER")
        || upper.ends_with("_AUTHORIZATIONHEADER")
        || upper.ends_with("_BEARER")
        || upper.ends_with("_KEY_FILE")
        || upper.ends_with("_KEYFILE")
        || upper.ends_with("_TOKEN_FILE")
        || upper.ends_with("_TOKENFILE")
        || upper.ends_with("_CREDENTIAL_FILE")
        || upper.ends_with("_CREDENTIALFILE")
        || upper.ends_with("_CREDENTIALS_FILE")
        || upper.ends_with("_CREDENTIALSFILE")
        || upper.ends_with("_ACCESS_KEY")
        || upper.ends_with("_ACCESSKEY")
        || upper.ends_with("_SIGNING_KEY")
        || upper.ends_with("_SIGNINGKEY")
        || upper.ends_with("_PASSWORD")
        || upper.ends_with("_COOKIE")
        || upper.ends_with("_CREDENTIALS")
        || upper.ends_with("_DATABASE_URL")
        || upper.ends_with("_DATABASEURL")
        || upper.ends_with("_DATABASE_DSN")
        || upper.ends_with("_DATABASEDSN")
        || upper.ends_with("_REDIS_URL")
        || upper.ends_with("_REDISURL")
        || upper.ends_with("_MONGODB_URI")
        || upper.ends_with("_MONGODBURI")
        || upper.ends_with("_POSTGRES_URL")
        || upper.ends_with("_POSTGRESURL")
        || upper.ends_with("_MYSQL_URL")
        || upper.ends_with("_MYSQLURL")
        || upper.ends_with("_SUPABASE_DB_URL")
        || upper.ends_with("_SUPABASEDBURL")
        || upper.ends_with("_METABASE_DB_CONNECTION_URI")
        || upper.ends_with("_METABASEDBCONNECTIONURI")
        || upper.ends_with("_MB_DB_CONNECTION_URI")
        || upper.ends_with("_MBDBCONNECTIONURI")
        || upper.ends_with("_SQLITE_URL")
        || upper.ends_with("_SQLITE_PATH")
        || upper.ends_with("_SQLITE_FILE")
        || upper.ends_with("_SQLITE_TMPDIR")
        || upper.ends_with("_SQLITE_HISTORY")
        || upper.ends_with("_PROXY_AUTHORIZATION")
        || upper.ends_with("_PROXYAUTHORIZATION")
        || upper.ends_with("_PROXY_AUTHENTICATE")
        || upper.ends_with("_PROXYAUTHENTICATE")
        || upper.ends_with("_PROXY_AUTHENTICATION_INFO")
        || upper.ends_with("_PROXYAUTHENTICATIONINFO")
        || upper.ends_with("_PROXY_STATUS")
        || upper.ends_with("_PROXYSTATUS")
        || upper.ends_with("_AUTHENTICATION_INFO")
        || upper.ends_with("_AUTHENTICATIONINFO")
        || upper.ends_with("_PROXY_CONNECTION")
        || upper.ends_with("_PROXYCONNECTION")
        || upper.ends_with("_TRAILER")
        || upper.ends_with("_UPGRADE")
        || upper.ends_with("_KEEP_ALIVE")
        || upper.ends_with("_KEEPALIVE")
        || upper.ends_with("_TE")
        || upper.ends_with("_PROXY")
        || upper.ends_with("_PROXY_URL")
        || upper.ends_with("_PROXYURL")
        || upper.ends_with("_NO_PROXY")
        || upper.ends_with("_NOPROXY")
        || upper.ends_with("_NETRC")
        || upper.ends_with("_WGETRC")
        || upper.ends_with("_CA_BUNDLE")
        || upper.ends_with("_CABUNDLE")
        || upper.ends_with("_CA_FILE")
        || upper.ends_with("_CAFILE")
        || upper.ends_with("_CA_PATH")
        || upper.ends_with("_CAPATH")
        || upper.ends_with("_SOCK")
        || upper.ends_with("_SOCKET")
        || upper.ends_with("_FORWARDED_CLIENT_CERT")
        || upper.ends_with("_FORWARDEDCLIENTCERT")
        || upper.ends_with("_CLIENT_CERT")
        || upper.ends_with("_CLIENTCERT")
        || upper.ends_with("_SSL_CLIENT_CERT")
        || upper.ends_with("_SSLCLIENTCERT")
        || upper.ends_with("_ARR_CLIENTCERT")
        || upper.ends_with("_CLIENT_CERT_CHAIN")
        || upper.ends_with("_CLIENTCERTCHAIN")
        || upper.ends_with("_CLIENT_DN")
        || upper.ends_with("_CLIENTDN")
        || upper.ends_with("_CLIENT_SAN")
        || upper.ends_with("_CLIENTSAN")
        || upper.ends_with("_CLIENT_VERIFY")
        || upper.ends_with("_CLIENTVERIFY")
        || upper.ends_with("_SSL_CLIENT_VERIFY")
        || upper.ends_with("_SSLCLIENTVERIFY")
        || upper.ends_with("_SSL_CLIENT_DN")
        || upper.ends_with("_SSLCLIENTDN")
        || upper.ends_with("_SSL_CLIENT_S_DN")
        || upper.ends_with("_SSLCLIENTSDN")
        || upper.ends_with("_SSL_CLIENT_I_DN")
        || upper.ends_with("_SSLCLIENTIDN")
        || upper.ends_with("_SSL_CLIENT_SAN")
        || upper.ends_with("_SSLCLIENTSAN")
        || upper.ends_with("_CERT")
        || upper.ends_with("_CERTIFICATE")
        || upper.ends_with("_PRIVATE_KEY")
        || upper.ends_with("_PRIVATEKEY")
        || upper.contains("_CERTIFICATE_")
        || upper.contains("_PRIVATE_KEY_")
        || upper.starts_with("AWS_")
        || upper.starts_with("AZURE_")
        || upper.starts_with("ARM_")
        || upper.starts_with("OIDC_")
        || upper.starts_with("AMZN_OIDC_")
        || upper.starts_with("GOOGLE_")
        || upper.starts_with("GOOG_")
        || upper.starts_with("GCP_")
        || upper.starts_with("CLOUDSDK_")
        || upper.starts_with("MSI_")
        || upper.starts_with("MS_TOKEN_AAD_")
        || upper.starts_with("IMDS_")
        || upper.starts_with("IDENTITY_")
        || upper.starts_with("K8S_")
        || upper.starts_with("KUBE_")
        || upper.starts_with("HELM_")
        || upper.starts_with("DOCKER_")
        || upper.starts_with("REGISTRY_")
        || upper.starts_with("CONTAINERS_")
        || upper.starts_with("GHCR_")
        || upper.starts_with("QUAY_")
        || upper.starts_with("HARBOR_")
        || upper.starts_with("ARTIFACTORY_")
        || upper.starts_with("JFROG_")
        || upper.starts_with("VAULT_")
        || upper.starts_with("SENTRY_")
        || upper.starts_with("DATADOG_")
        || upper.starts_with("NEW_RELIC_")
        || upper.starts_with("HONEYCOMB_")
        || upper.starts_with("LOGDNA_")
        || upper.starts_with("ROLLBAR_")
        || upper.starts_with("BUGSNAG_")
        || upper.starts_with("PAGERDUTY_")
        || upper.starts_with("GRAFANA_")
        || upper.starts_with("OTEL_")
        || upper.starts_with("OTLP_")
        || upper.starts_with("GITHUB_")
        || upper.starts_with("GITLAB_")
        || upper.starts_with("BITBUCKET_")
        || upper.starts_with("ACTIONS_")
        || upper.starts_with("CI_")
        || upper.starts_with("RUNNER_")
        || upper.starts_with("CIRCLECI_")
        || upper.starts_with("BUILDKITE_")
        || upper.starts_with("DRONE_")
        || upper.starts_with("JENKINS_")
        || upper.starts_with("CODECOV_")
        || upper.starts_with("SONAR_")
        || upper.starts_with("NPM_")
        || upper.starts_with("NODE_AUTH_")
        || upper.starts_with("YARN_NPM_")
        || upper.starts_with("BUN_")
        || upper.starts_with("PYPI_")
        || upper.starts_with("TWINE_")
        || upper.starts_with("RUBYGEMS_")
        || upper.starts_with("NUGET_")
        || upper.starts_with("FASTLY_")
        || upper.starts_with("AKAMAI_")
        || upper.starts_with("NETLIFY_")
        || upper.starts_with("VERCEL_")
        || upper.starts_with("RENDER_")
        || upper.starts_with("RAILWAY_")
        || upper.starts_with("HEROKU_")
        || upper.starts_with("FLY_")
        || upper.starts_with("DIGITALOCEAN_")
        || upper.starts_with("LINODE_")
        || upper.starts_with("HCLOUD_")
        || upper.starts_with("VULTR_")
        || upper.starts_with("SCW_")
        || upper.starts_with("ARGOCD_")
        || upper.starts_with("TERRAFORM_")
        || upper.starts_with("PULUMI_")
        || upper.starts_with("DOPPLER_")
        || upper.starts_with("INFISICAL_")
        || upper.starts_with("OP_SERVICE_")
        || upper.starts_with("SOPS_")
        || upper.starts_with("SIGSTORE_")
        || upper.starts_with("COSIGN_")
    {
        return true;
    }
    matches!(
        upper.as_str(),
        "PATH"
            | "HOME"
            | "USERPROFILE"
            | "XDG_CONFIG_HOME"
            | "XDG_DATA_HOME"
            | "XDG_CACHE_HOME"
            | "IFS"
            | "SHELLOPTS"
            | "BASHOPTS"
            | "BASH_ENV"
            | "ENV"
            | "GCONV_PATH"
            | "GLIBC_TUNABLES"
            | "NODE_OPTIONS"
            | "NODE_PATH"
            | "CLASSPATH"
            | "JAVA_TOOL_OPTIONS"
            | "_JAVA_OPTIONS"
            | "PYTHONPATH"
            | "PYTHONHOME"
            | "PYTHONSTARTUP"
            | "PYTHONUSERBASE"
            | "RUBYOPT"
            | "RUBYLIB"
            | "PERL5OPT"
            | "PERL5LIB"
            | "GEM_HOME"
            | "GEM_PATH"
            | "LUA_PATH"
            | "LUA_CPATH"
            | "SSL_CERT_FILE"
            | "SSL_CERT_DIR"
            | "REQUESTS_CA_BUNDLE"
            | "CURL_CA_BUNDLE"
            | "GIT_SSL_CAINFO"
            | "HTTP_PROXY"
            | "HTTPS_PROXY"
            | "ALL_PROXY"
            | "NO_PROXY"
            | "SSH_AUTH_SOCK"
            | "SSH_AGENT_PID"
            | "SSH_ASKPASS"
            | "GIT_ASKPASS"
            | "GIT_SSH"
            | "GIT_SSH_COMMAND"
            | "AWS_SHARED_CREDENTIALS_FILE"
            | "AWS_CONFIG_FILE"
            | "AWS_ACCESS_KEY_ID"
            | "AWS_SECRET_ACCESS_KEY"
            | "AWS_SESSION_TOKEN"
            | "AWS_PROFILE"
            | "AWS_DEFAULT_PROFILE"
            | "AWS_ROLE_ARN"
            | "AWS_ROLE_SESSION_NAME"
            | "AWS_ROLE_SESSION_DURATION"
            | "AWS_WEB_IDENTITY_TOKEN_FILE"
            | "AWS_EC2_METADATA_DISABLED"
            | "AWS_EC2_METADATA_SERVICE_ENDPOINT"
            | "AWS_EC2_METADATA_SERVICE_ENDPOINT_MODE"
            | "AWS_METADATA_SERVICE_TIMEOUT"
            | "AWS_METADATA_SERVICE_NUM_ATTEMPTS"
            | "AWS_CONTAINER_CREDENTIALS_RELATIVE_URI"
            | "AWS_CONTAINER_CREDENTIALS_FULL_URI"
            | "AWS_CONTAINER_AUTHORIZATION_TOKEN"
            | "AWS_CONTAINER_AUTHORIZATION_TOKEN_FILE"
            | "BOTO_CONFIG"
            | "GOOGLE_APPLICATION_CREDENTIALS"
            | "GOOGLE_OAUTH_ACCESS_TOKEN"
            | "GOOGLE_OAUTH_REFRESH_TOKEN"
            | "GOOGLE_ID_TOKEN"
            | "GCP_ACCESS_TOKEN"
            | "GCP_ID_TOKEN"
            | "GOOGLE_GHA_CREDS_PATH"
            | "GOOGLE_CLOUD_PROJECT"
            | "GOOGLE_IMPERSONATE_SERVICE_ACCOUNT"
            | "GCE_METADATA_HOST"
            | "GCLOUD_PROJECT"
            | "CLOUDSDK_CONFIG"
            | "CLOUDSDK_AUTH_ACCESS_TOKEN"
            | "CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE"
            | "AZURE_CONFIG_DIR"
            | "AZURE_FEDERATED_TOKEN_FILE"
            | "AZURE_ACCESS_TOKEN"
            | "AZURE_ID_TOKEN"
            | "AZURE_CLIENT_ID"
            | "AZURE_TENANT_ID"
            | "AZURE_CLIENT_SECRET"
            | "AZURE_USERNAME"
            | "AZURE_PASSWORD"
            | "IDENTITY_ENDPOINT"
            | "IDENTITY_HEADER"
            | "IMDS_ENDPOINT"
            | "MSI_ENDPOINT"
            | "MSI_SECRET"
            | "ARM_CLIENT_ID"
            | "ARM_TENANT_ID"
            | "ARM_CLIENT_SECRET"
            | "ARM_ACCESS_KEY"
            | "ARM_SUBSCRIPTION_ID"
            | "ARM_USE_OIDC"
            | "ARM_OIDC_TOKEN"
            | "ARM_OIDC_TOKEN_FILE"
            | "ARM_USE_MSI"
            | "ARM_USE_AZUREAD"
            | "AZURE_SUBSCRIPTION_ID"
            | "KUBECONFIG"
            | "KUBE_CONFIG_PATH"
            | "HELM_KUBEAPISERVER"
            | "HELM_KUBETOKEN"
            | "HELM_KUBECAFILE"
            | "DOCKER_CONFIG"
            | "DOCKER_AUTH_CONFIG"
            | "DOCKER_USERNAME"
            | "DOCKER_PASSWORD"
            | "REGISTRY_AUTH_FILE"
            | "CONTAINERS_AUTH_FILE"
            | "HELM_REGISTRY_CONFIG"
            | "CR_PAT"
            | "GHCR_TOKEN"
            | "QUAY_TOKEN"
            | "QUAY_OAUTH_TOKEN"
            | "HARBOR_USERNAME"
            | "HARBOR_PASSWORD"
            | "ARTIFACTORY_API_KEY"
            | "JFROG_ACCESS_TOKEN"
            | "OCI_CLI_KEY_FILE"
            | "OCI_CLI_SECURITY_TOKEN_FILE"
            | "OCI_CLI_AUTH"
            | "NETRC"
            | "_NETRC"
            | "CURL_HOME"
            | "WGETRC"
            | "RUSTFLAGS"
            | "RUSTDOCFLAGS"
            | "RUSTC_WRAPPER"
            | "RUSTC_WORKSPACE_WRAPPER"
            | "GITHUB_TOKEN"
            | "GH_TOKEN"
            | "GH_ENTERPRISE_TOKEN"
            | "GITHUB_PAT"
            | "GITLAB_TOKEN"
            | "GITLAB_PRIVATE_TOKEN"
            | "GITLAB_CI_TOKEN"
            | "CI_JOB_TOKEN"
            | "CI_JOB_JWT"
            | "CI_JOB_JWT_V2"
            | "ACTIONS_ID_TOKEN_REQUEST_TOKEN"
            | "ACTIONS_ID_TOKEN_REQUEST_URL"
            | "ACTIONS_RUNTIME_TOKEN"
            | "GITLAB_OIDC_TOKEN"
            | "CIRCLE_OIDC_TOKEN"
            | "OIDC_TOKEN"
            | "CIRCLE_TOKEN"
            | "BUILDKITE_AGENT_ACCESS_TOKEN"
            | "BUILDKITE_API_TOKEN"
            | "DRONE_TOKEN"
            | "JENKINS_API_TOKEN"
            | "CI_REGISTRY_PASSWORD"
            | "CI_DEPLOY_PASSWORD"
            | "BITBUCKET_TOKEN"
            | "BITBUCKET_APP_PASSWORD"
            | "CODECOV_TOKEN"
            | "SENTRY_AUTH_TOKEN"
            | "SONAR_TOKEN"
            | "DATADOG_API_KEY"
            | "HONEYCOMB_API_KEY"
            | "NEW_RELIC_API_KEY"
            | "NEW_RELIC_LICENSE_KEY"
            | "LOGDNA_INGESTION_KEY"
            | "ROLLBAR_ACCESS_TOKEN"
            | "BUGSNAG_API_KEY"
            | "PAGERDUTY_API_TOKEN"
            | "GRAFANA_CLOUD_API_KEY"
            | "OTEL_EXPORTER_OTLP_HEADERS"
            | "OTEL_EXPORTER_OTLP_TRACES_HEADERS"
            | "OTEL_EXPORTER_OTLP_METRICS_HEADERS"
            | "OTEL_EXPORTER_OTLP_LOGS_HEADERS"
            | "CLOUDFLARE_API_TOKEN"
            | "CLOUDFLARE_API_KEY"
            | "CF_API_TOKEN"
            | "CF_ACCESS_CLIENT_ID"
            | "CF_ACCESS_CLIENT_SECRET"
            | "CLOUDFLARE_ACCESS_CLIENT_ID"
            | "CLOUDFLARE_ACCESS_CLIENT_SECRET"
            | "FASTLY_API_TOKEN"
            | "AKAMAI_CLIENT_TOKEN"
            | "AKAMAI_CLIENT_SECRET"
            | "AKAMAI_ACCESS_TOKEN"
            | "NETLIFY_AUTH_TOKEN"
            | "VERCEL_TOKEN"
            | "RENDER_API_KEY"
            | "RAILWAY_TOKEN"
            | "NGROK_AUTHTOKEN"
            | "NGROK_API_KEY"
            | "NGROK_AUTHTOKEN_FILE"
            | "NGROK_CONFIG"
            | "CLOUDFLARE_TUNNEL_TOKEN"
            | "TAILSCALE_AUTHKEY"
            | "TS_AUTHKEY"
            | "TAILSCALE_API_KEY"
            | "TAILSCALE_OAUTH_CLIENT_SECRET"
            | "HEROKU_API_KEY"
            | "FLY_API_TOKEN"
            | "DIGITALOCEAN_ACCESS_TOKEN"
            | "LINODE_TOKEN"
            | "HCLOUD_TOKEN"
            | "VULTR_API_KEY"
            | "SCW_ACCESS_KEY"
            | "SCW_SECRET_KEY"
            | "SUPABASE_ACCESS_TOKEN"
            | "SUPABASE_SERVICE_ROLE_KEY"
            | "SUPABASE_SERVICE_KEY"
            | "SUPABASE_ANON_KEY"
            | "SUPABASE_JWT_SECRET"
            | "SUPABASE_SECRET_KEY"
            | "SUPABASE_DB_PASSWORD"
            | "SUPABASE_URL"
            | "SUPABASE_DB_URL"
            | "METABASE_API_KEY"
            | "METABASE_SITE_URL"
            | "METABASE_DB_CONNECTION_URI"
            | "MB_DB_CONNECTION_URI"
            | "METABASE_DB_USER"
            | "METABASE_DB_PASS"
            | "MB_DB_USER"
            | "MB_DB_PASS"
            | "METABASE_ENCRYPTION_SECRET_KEY"
            | "METABASE_JWT_SHARED_SECRET"
            | "MB_ENCRYPTION_SECRET_KEY"
            | "MB_JWT_SHARED_SECRET"
            | "NEON_API_KEY"
            | "VAULT_TOKEN"
            | "SOPS_AGE_KEY"
            | "SOPS_AGE_KEY_FILE"
            | "AGE_SECRET_KEY"
            | "AGE_KEY_FILE"
            | "GPG_PRIVATE_KEY"
            | "GPG_PASSPHRASE"
            | "SIGSTORE_ID_TOKEN"
            | "COSIGN_PASSWORD"
            | "COSIGN_PRIVATE_KEY"
            | "KUBE_TOKEN"
            | "KUBE_BEARER_TOKEN"
            | "ARGOCD_AUTH_TOKEN"
            | "TF_TOKEN_APP_TERRAFORM_IO"
            | "TERRAFORM_CLOUD_TOKEN"
            | "TFC_TOKEN"
            | "PULUMI_ACCESS_TOKEN"
            | "DOPPLER_TOKEN"
            | "INFISICAL_TOKEN"
            | "OP_SERVICE_ACCOUNT_TOKEN"
            | "NODE_AUTH_TOKEN"
            | "NPM_TOKEN"
            | "YARN_NPM_AUTH_TOKEN"
            | "BUN_AUTH_TOKEN"
            | "PYPI_TOKEN"
            | "PYPI_API_TOKEN"
            | "TWINE_USERNAME"
            | "TWINE_PASSWORD"
            | "RUBYGEMS_API_KEY"
            | "NUGET_API_KEY"
            | "NUGET_AUTH_TOKEN"
            | "TELEGRAM_BOT_TOKEN"
            | "TELEGRAM_BOT_API_SECRET_TOKEN"
            | "TELEGRAM_API_HASH"
            | "TWITTER_BEARER_TOKEN"
            | "TWITTER_API_KEY"
            | "TWITTER_API_SECRET"
            | "TWITTER_ACCESS_TOKEN"
            | "TWITTER_ACCESS_TOKEN_SECRET"
            | "X_API_KEY"
            | "SIGNAL_CLI_PASSWORD"
            | "SIGNAL_CLI_USERNAME"
            | "TWILIO_AUTH_TOKEN"
            | "TWILIO_API_KEY"
            | "STRIPE_API_KEY"
            | "STRIPE_SECRET_KEY"
            | "STRIPE_WEBHOOK_SECRET"
            | "SHOPIFY_WEBHOOK_SECRET"
            | "SHOPIFY_API_SECRET"
            | "GITHUB_WEBHOOK_SECRET"
            | "GITLAB_WEBHOOK_SECRET_TOKEN"
            | "LINE_CHANNEL_SECRET"
            | "FACEBOOK_ACCESS_TOKEN"
            | "FACEBOOK_APP_SECRET"
            | "META_ACCESS_TOKEN"
            | "INSTAGRAM_ACCESS_TOKEN"
            | "WHATSAPP_TOKEN"
            | "WHATSAPP_VERIFY_TOKEN"
            | "MATRIX_ACCESS_TOKEN"
            | "MATRIX_HOMESERVER_TOKEN"
            | "MATRIX_REGISTRATION_SHARED_SECRET"
            | "MATRIX_MACAROON_SECRET_KEY"
            | "DISCORD_TOKEN"
            | "DISCORD_WEBHOOK_URL"
            | "SLACK_BOT_TOKEN"
            | "SLACK_APP_TOKEN"
            | "SLACK_SIGNING_SECRET"
            | "SLACK_WEBHOOK_URL"
            | "SENDGRID_API_KEY"
            | "MAILGUN_API_KEY"
            | "POSTMARK_API_TOKEN"
            | "RESEND_API_KEY"
            | "DATABASE_URL"
            | "DATABASE_DSN"
            | "REDIS_URL"
            | "MONGODB_URI"
            | "POSTGRES_URL"
            | "MYSQL_URL"
            | "BROKER_URL"
            | "AMQP_URL"
            | "SQLITE_URL"
            | "SQLITE_PATH"
            | "SQLITE_FILE"
            | "SQLITE_TMPDIR"
            | "SQLITE_HISTORY"
            | "SQLCIPHER_KEY"
            | "LIBSQL_AUTH_TOKEN"
            | "TURSO_AUTH_TOKEN"
            | "PGLITE_DATA_DIR"
            | "PGLITE_DB_PATH"
            | "PGLITE_OPFS_PATH"
            | "OPFS_ROOT"
            | "OPFS_PATH"
            | "OPENAI_API_KEY"
            | "OPENROUTER_API_KEY"
            | "AZURE_OPENAI_API_KEY"
            | "ANTHROPIC_API_KEY"
            | "GEMINI_API_KEY"
            | "MISTRAL_API_KEY"
            | "COHERE_API_KEY"
            | "GROQ_API_KEY"
            | "TOGETHER_API_KEY"
            | "PERPLEXITY_API_KEY"
            | "DEEPSEEK_API_KEY"
            | "XAI_API_KEY"
            | "FIREWORKS_API_KEY"
            | "HUGGINGFACEHUB_API_TOKEN"
            | "HF_TOKEN"
            | "REPLICATE_API_TOKEN"
            | "ELEVENLABS_API_KEY"
            | "ACCESS_TOKEN"
            | "ID_TOKEN"
            | "REFRESH_TOKEN"
            | "LD_PRELOAD"
            | "LD_AUDIT"
            | "LD_LIBRARY_PATH"
            | "DYLD_INSERT_LIBRARIES"
            | "DYLD_LIBRARY_PATH"
            | "DYLD_FRAMEWORK_PATH"
            | "DYLD_FALLBACK_LIBRARY_PATH"
    )
}

