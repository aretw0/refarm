mod env;
mod headers;

pub(crate) fn is_compact_sensitive_env_alias_suffix(upper_env_key: &str) -> bool {
    env::is_compact_sensitive_env_alias_suffix(upper_env_key)
}

pub(crate) fn is_compact_sensitive_env_alias_suffix_or_segment(upper_env_key: &str) -> bool {
    env::is_compact_sensitive_env_alias_suffix_or_segment(upper_env_key)
}

#[allow(dead_code)]
pub(crate) fn is_generic_sensitive_env_token_suffix(upper_env_key: &str) -> bool {
    env::is_generic_sensitive_env_token_suffix(upper_env_key)
}

pub(crate) fn is_generic_sensitive_env_token_suffix_or_segment(upper_env_key: &str) -> bool {
    env::is_generic_sensitive_env_token_suffix_or_segment(upper_env_key)
}

#[allow(dead_code)]
pub(crate) fn is_shared_sensitive_env_canonical_suffix(upper_env_key: &str) -> bool {
    env::is_shared_sensitive_env_canonical_suffix(upper_env_key)
}

pub(crate) fn is_shared_sensitive_env_canonical_suffix_or_segment(upper_env_key: &str) -> bool {
    env::is_shared_sensitive_env_canonical_suffix_or_segment(upper_env_key)
}

pub(crate) fn is_shared_sensitive_env_namespace_prefix(upper_env_key: &str) -> bool {
    env::is_shared_sensitive_env_namespace_prefix(upper_env_key)
}

pub(crate) fn is_shared_sensitive_env_namespace_segment(upper_env_key: &str) -> bool {
    env::is_shared_sensitive_env_namespace_segment(upper_env_key)
}

pub(crate) fn is_disallowed_llm_forward_env_upper(upper: &str) -> bool {
    matches!(
        upper,
        "LLM_SHELL_ALLOWLIST"
            | "LLM_FS_ROOT"
            | "LLM_TRUSTED_PLUGINS"
            | "LLM_USER"
            | "LLM_USER_NAME"
            | "LLM_EMAIL"
            | "LLM_AUTHENTICATION"
    ) || upper.ends_with("_API_KEY")
        || upper.ends_with("_KEY")
        || upper.contains("_KEY_")
        || is_compact_sensitive_env_alias_suffix_or_segment(upper)
        || is_generic_sensitive_env_token_suffix_or_segment(upper)
        || is_shared_sensitive_env_canonical_suffix_or_segment(upper)
        || is_shared_sensitive_env_namespace_segment(upper)
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
        || upper.ends_with("_SSL_CLIENT_SAN")
}

fn is_safe_llm_forward_env_key_format(key: &str) -> bool {
    const MAX_SUFFIX_LEN: usize = 96;
    let suffix = &key["LLM_".len()..];
    !suffix.is_empty()
        && suffix.len() <= MAX_SUFFIX_LEN
        && suffix
            .bytes()
            .all(|b| b.is_ascii_uppercase() || b.is_ascii_digit() || b == b'_')
}

/// Shared plugin-forwarding policy for `LLM_*` env keys.
pub(crate) fn is_forwardable_llm_env_key(key: &str) -> bool {
    if !key.starts_with("LLM_") {
        return false;
    }
    if key.len() <= "LLM_".len() {
        return false;
    }
    if !is_safe_llm_forward_env_key_format(key) {
        return false;
    }
    let upper = key.to_ascii_uppercase();
    !is_disallowed_llm_forward_env_upper(&upper)
}

/// Shared plugin-forwarding policy for `LLM_*` env values.
pub(crate) fn is_forwardable_llm_env_value(value: &str) -> bool {
    const MAX_LLM_ENV_VALUE_LEN: usize = 4096;
    !value.trim().is_empty()
        && value.trim() == value
        && value.len() <= MAX_LLM_ENV_VALUE_LEN
        && value.is_ascii()
        && !value.chars().any(|c| c.is_whitespace())
        && !value.chars().any(|c| c.is_control())
}

/// Shared spawn boundary env-key policy (exact keys + prefixes + shared alias catalogs).
pub(crate) fn is_spawn_sensitive_env_key(key: &str) -> bool {
    let upper = key.to_ascii_uppercase();
    if upper.starts_with("LD_")
        || upper.starts_with("DYLD_")
        || upper.starts_with("MALLOC_")
        || upper.starts_with("GIT_CONFIG_")
        || upper.starts_with("NPM_CONFIG_")
        || upper.starts_with("PROXY_")
        || upper.starts_with("REMOTE_USER_")
        || upper.starts_with("AUTH_REQUEST_")
        || upper.starts_with("AUTH_USER_")
        || upper.starts_with("AUTHENTICATED_USER_")
        || upper.starts_with("END_USER_")
        || upper.starts_with("CLIENT_PRINCIPAL_")
        || upper.starts_with("VERIFIED_USER_")
        || upper.starts_with("IMPERSONATE_EXTRA_")
        || upper.starts_with("OCI_CLI_")
        || upper.starts_with("NETRC_")
        || upper.starts_with("MB_DB_")
        || upper.starts_with("CF_ACCESS_")
        || upper.starts_with("CF_API_")
        || upper.starts_with("CLOUDFLARE_ACCESS_")
        || upper.starts_with("CLOUDFLARE_API_")
        || upper.starts_with("MB_JWT_")
        || upper.starts_with("MB_ENCRYPTION_")
        || upper.starts_with("CLOUDFLARE_TUNNEL_")
        || is_compact_sensitive_env_alias_suffix(&upper)
        || is_generic_sensitive_env_token_suffix_or_segment(&upper)
        || is_shared_sensitive_env_canonical_suffix_or_segment(&upper)
        || is_shared_sensitive_env_namespace_prefix(&upper)
        || upper.starts_with("AMZN_OIDC_")
        || upper.starts_with("GOOG_")
        || upper.starts_with("MS_TOKEN_AAD_")
        || upper.starts_with("NEW_RELIC_")
        || upper.starts_with("NODE_AUTH_")
        || upper.starts_with("YARN_NPM_")
        || upper.starts_with("OP_SERVICE_")
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

/// Matches any sensitive plugin header by canonical exact/prefix policies
/// plus compact alias normalization policy.
pub(crate) fn is_sensitive_plugin_header_name(lower_header_name: &str) -> bool {
    headers::is_sensitive_plugin_header_name(lower_header_name)
        || is_compact_sensitive_header_alias(lower_header_name)
}

/// Matches compact header aliases (without `-` / `_`) used for sensitive data.
pub(crate) fn is_compact_sensitive_header_alias(lower_header_name: &str) -> bool {
    headers::is_compact_sensitive_header_alias(lower_header_name)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn compact_env_alias_suffix_matches_expected_keys() {
        let blocked = [
            "SERVICE_GITHUBTOKEN",
            "SERVICE_CFACCESSJWTASSERTION",
            "SERVICE_KUBECONFIGPATH",
            "SERVICE_SLACKBOTTOKEN",
            "SERVICE_STRIPEWEBHOOKSECRET",
            "SERVICE_PROXYAUTHORIZATION",
            "SERVICE_HTTPMETHODOVERRIDE",
            "SERVICE_OIDCDATA",
            "SERVICE_DATABASEURL",
            "SERVICE_WEBHOOKURL",
            "SERVICE_SESSIONID",
            "SERVICE_PROXYURL",
            "SERVICE_TLSINSECURE",
            "SERVICE_NETRC",
            "SERVICE_ACCESSKEY",
            "SERVICE_KEYFILE",
            "SERVICE_KUBECAFILE",
        ];
        for key in blocked {
            assert!(
                is_compact_sensitive_env_alias_suffix(key),
                "expected compact env suffix match: {key}"
            );
        }

        let allowed = ["SERVICE_GITHUB_TOKEN", "GITHUBTOKEN", "SERVICE_PROVIDER"];
        for key in allowed {
            assert!(
                !is_compact_sensitive_env_alias_suffix(key),
                "expected compact env suffix NOT to match: {key}"
            );
        }
    }

    #[test]
    fn compact_env_alias_segment_matches_expected_keys() {
        let blocked = [
            "LLM_FOO_GITLABTOKEN_BAR",
            "LLM_FOO_CLOUDFLAREACCESSCLIENTSECRET_BAR",
            "LLM_FOO_SLACKREQUESTTIMESTAMP_BAR",
        ];
        for key in blocked {
            assert!(
                is_compact_sensitive_env_alias_suffix_or_segment(key),
                "expected compact env segment match: {key}"
            );
        }

        let allowed = ["LLM_FOO_GITLAB_TOKEN_BAR", "LLM_PROVIDER_BASE_URL"];
        for key in allowed {
            assert!(
                !is_compact_sensitive_env_alias_suffix_or_segment(key),
                "expected compact env segment NOT to match: {key}"
            );
        }
    }

    #[test]
    fn generic_env_sensitive_token_matches_suffix_and_segment() {
        let suffix_blocked = [
            "SERVICE_TOKEN",
            "SERVICE_SECRET",
            "SERVICE_SESSION",
            "SERVICE_JWT",
            "SERVICE_HMAC",
            "SERVICE_AUTHORIZATION",
            "SERVICE_TRAILER",
            "SERVICE_UPGRADE",
        ];
        for key in suffix_blocked {
            assert!(
                is_generic_sensitive_env_token_suffix(key),
                "expected generic env suffix match: {key}"
            );
        }

        let segment_blocked = [
            "LLM_FOO_TOKEN_BAR",
            "LLM_FOO_SECRET_BAR",
            "LLM_FOO_PROXY_BAR",
            "LLM_FOO_AUTHORIZATION_BAR",
        ];
        for key in segment_blocked {
            assert!(
                is_generic_sensitive_env_token_suffix_or_segment(key),
                "expected generic env segment match: {key}"
            );
        }

        let allowed = ["SERVICE_WEBHOOK_TOKEN", "TOKEN", "LLM_PROVIDER_BASE_URL"];
        for key in allowed {
            assert!(
                !is_generic_sensitive_env_token_suffix_or_segment(key),
                "expected generic env helper NOT to match: {key}"
            );
        }
    }

    #[test]
    fn shared_canonical_env_suffix_matches_expected_keys() {
        let blocked = [
            "SERVICE_WEBHOOK_URL",
            "SERVICE_PROXY_AUTHORIZATION",
            "SERVICE_DATABASE_URL",
            "SERVICE_KUBE_CONFIG_PATH",
            "SERVICE_SSL_CLIENT_CERT",
        ];
        for key in blocked {
            assert!(
                is_shared_sensitive_env_canonical_suffix(key),
                "expected shared canonical env suffix match: {key}"
            );
        }

        let allowed = [
            "SERVICE_WEBHOOKURL",
            "SERVICE_PROXYAUTHORIZATION",
            "WEBHOOK_URL",
            "SERVICE_PROVIDER_BASE_URL",
        ];
        for key in allowed {
            assert!(
                !is_shared_sensitive_env_canonical_suffix(key),
                "expected shared canonical env helper NOT to match: {key}"
            );
        }
    }

    #[test]
    fn shared_canonical_env_segment_matches_expected_keys() {
        let blocked = [
            "LLM_FOO_WEBHOOK_SECRET_BAR",
            "LLM_FOO_PROXY_AUTHORIZATION_BAR",
            "LLM_FOO_DATABASE_URL_BAR",
            "LLM_FOO_SSL_CLIENT_CERT_BAR",
        ];
        for key in blocked {
            assert!(
                is_shared_sensitive_env_canonical_suffix_or_segment(key),
                "expected shared canonical env segment match: {key}"
            );
        }

        let allowed = ["LLM_FOO_WEBHOOKSECRET_BAR", "LLM_PROVIDER_BASE_URL"];
        for key in allowed {
            assert!(
                !is_shared_sensitive_env_canonical_suffix_or_segment(key),
                "expected shared canonical env segment helper NOT to match: {key}"
            );
        }
    }

    #[test]
    fn shared_sensitive_env_namespace_matches_prefix_and_segment() {
        let prefix_blocked = ["AWS_SECRET_ACCESS_KEY", "GITHUB_TOKEN", "KUBE_TOKEN"];
        for key in prefix_blocked {
            assert!(
                is_shared_sensitive_env_namespace_prefix(key),
                "expected shared namespace prefix match: {key}"
            );
        }

        let segment_blocked = ["LLM_FOO_AWS_BAR", "LLM_FOO_GITHUB_BAR", "LLM_FOO_KUBE_BAR"];
        for key in segment_blocked {
            assert!(
                is_shared_sensitive_env_namespace_segment(key),
                "expected shared namespace segment match: {key}"
            );
        }

        let allowed = ["LLM_FOO_AWSBAR_BAZ", "SERVICE_PROVIDER_BASE_URL"];
        for key in allowed {
            assert!(
                !is_shared_sensitive_env_namespace_segment(key),
                "expected shared namespace segment helper NOT to match: {key}"
            );
        }
    }

    #[test]
    fn disallowed_llm_forward_env_helper_matches_expected_cases() {
        let blocked = [
            "LLM_SHELL_ALLOWLIST",
            "LLM_GITHUB_TOKEN",
            "LLM_PROVIDER_WEBHOOK_SECRET",
            "LLM_AWS_EC2_METADATA_TOKEN",
            "LLM_AUTH_REQUEST_USER",
        ];
        for key in blocked {
            assert!(
                is_disallowed_llm_forward_env_upper(key),
                "expected disallowed llm forward env key: {key}"
            );
        }

        let allowed = ["LLM_MODEL", "LLM_PROVIDER_BASE_URL", "LLM_TEMPERATURE"];
        for key in allowed {
            assert!(
                !is_disallowed_llm_forward_env_upper(key),
                "expected allowed llm forward env key: {key}"
            );
        }
    }

    #[test]
    fn llm_forwardable_helpers_match_expected_cases() {
        let key_allowed = ["LLM_MODEL", "LLM_PROVIDER_BASE_URL", "LLM_TEMPERATURE"];
        for key in key_allowed {
            assert!(
                is_forwardable_llm_env_key(key),
                "expected LLM env key to be forwardable: {key}"
            );
        }

        let key_blocked = ["LLM_GITHUB_TOKEN", "LLM_SHELL_ALLOWLIST", "LLM_AWS_FOO_BAR"];
        for key in key_blocked {
            assert!(
                !is_forwardable_llm_env_key(key),
                "expected LLM env key to be blocked: {key}"
            );
        }

        let value_allowed = ["gpt-4.1", "openai", "0.2"];
        for value in value_allowed {
            assert!(
                is_forwardable_llm_env_value(value),
                "expected LLM env value to be forwardable: {value}"
            );
        }

        let value_blocked = ["", " has-space", "line\nfeed"];
        for value in value_blocked {
            assert!(
                !is_forwardable_llm_env_value(value),
                "expected LLM env value to be blocked: {value:?}"
            );
        }
    }

    #[test]
    fn spawn_sensitive_env_key_helper_matches_expected_cases() {
        let blocked = [
            "AWS_SECRET_ACCESS_KEY",
            "service_githubtoken",
            "llm_foo_webhook_secret_bar",
            "NODE_AUTH_TOKEN",
            "DYLD_INSERT_LIBRARIES",
            "PATH",
            "HOME",
        ];
        for key in blocked {
            assert!(
                is_spawn_sensitive_env_key(key),
                "expected spawn sensitive env key to be blocked: {key}"
            );
        }

        let allowed = ["RUST_LOG", "TERM", "LANG", "SERVICE_PROVIDER_BASE_URL"];
        for key in allowed {
            assert!(
                !is_spawn_sensitive_env_key(key),
                "expected spawn sensitive env key helper NOT to block: {key}"
            );
        }
    }

    #[test]
    fn compact_alias_catalog_excludes_generic_canonical_tokens() {
        let env_not_compact = [
            "SERVICE_ASSERTION",
            "SERVICE_AUTH",
            "SERVICE_AUTHORIZATION",
            "SERVICE_BEARER",
            "SERVICE_CERT",
            "SERVICE_CERTIFICATE",
            "SERVICE_COOKIE",
            "SERVICE_CREDENTIALS",
            "SERVICE_HMAC",
            "SERVICE_JWT",
            "SERVICE_PASSWORD",
            "SERVICE_PROXY",
            "SERVICE_SECRET",
            "SERVICE_SESSION",
            "SERVICE_SIGNATURE",
            "SERVICE_TE",
            "SERVICE_TOKEN",
            "SERVICE_TRAILER",
            "SERVICE_UPGRADE",
        ];
        for key in env_not_compact {
            assert!(
                !is_compact_sensitive_env_alias_suffix(key),
                "generic canonical token must stay outside compact catalog: {key}"
            );
        }

        let header_not_compact = [
            "x-token",
            "x-secret",
            "x-session",
            "x-jwt",
            "x-hmac",
            "authorization",
            "authentication",
            "connection",
            "cookie",
            "forwarded",
            "host",
            "metadata",
            "te",
            "trailer",
            "upgrade",
            "via",
        ];
        for header in header_not_compact {
            assert!(
                !is_compact_sensitive_header_alias(header),
                "generic canonical header must stay outside compact catalog: {header}"
            );
        }
    }

    #[test]
    fn sensitive_plugin_header_name_matches_canonical_and_compact_forms() {
        let blocked = [
            "authorization",
            "x-authorization",
            "x-auth-token",
            "x-github-token",
            "x-aws-ec2-metadata-token",
            "x-forwarded-for",
            "x-original-forwarded-host",
            "x-webhook-secret",
            "x-kube-token",
            "x-http-method-override",
            "x-request-timestamp",
            "x-githubtoken",
        ];
        for header in blocked {
            assert!(
                is_sensitive_plugin_header_name(header),
                "expected sensitive plugin header match: {header}"
            );
        }

        let allowed = ["x-openai-model", "x-provider", "x-safe-header"];
        for header in allowed {
            assert!(
                !is_sensitive_plugin_header_name(header),
                "expected non-sensitive plugin header: {header}"
            );
        }
    }

    #[test]
    fn compact_header_alias_matches_normalized_forms() {
        let blocked = [
            "x-githubtoken",
            "X-GitLabUserId",
            "x-slack-requesttimestamp",
            "x-stripe-api-key",
            "x-kubeconfig-path",
            "x-msisecret",
            "proxyauthorization",
            "x-httpmethodoverride",
            "x-oidcdata",
            "x-databaseurl",
            "x-webhookurl",
            "x-requesttimestamp",
            "x-proxyurl",
            "x-cabundle",
            "x-tlsinsecure",
            "x-netrc-profile",
            "x-accesskey-profile",
            "x-keyfile-main",
            "x-urlscheme",
        ];
        for header in blocked {
            assert!(
                is_compact_sensitive_header_alias(header),
                "expected compact header alias match: {header}"
            );
        }

        let allowed = ["x-github-token-legacy", "x-provider", "x-openai-model"];
        for header in allowed {
            assert!(
                !is_compact_sensitive_header_alias(header),
                "expected compact header alias NOT to match: {header}"
            );
        }
    }
}
