/// Shared compact-alias catalog for host-side security boundaries.
///
/// Goal: keep compact variants (without `_` / `-`) in one place so
/// spawn/plugin/wasi policies stay in lockstep with lower maintenance churn.

// NOTE: Keep this catalog focused on *compact aliases* for multi-part sensitive
// names (e.g. HTTP_METHOD_OVERRIDE -> HTTPMETHODOVERRIDE).
// Intentionally excluded generic canonical tokens (TOKEN, SECRET, SESSION, JWT,
// HMAC, AUTHORIZATION, etc.) remain enforced directly in boundary code to avoid
// over-expanding this compact-alias helper.
const COMPACT_ENV_ALIAS_TOKENS: &[&str] = &[
    // Cloud metadata / workload identity compact aliases
    "AWSEC2METADATATOKEN",
    "AWSEC2METADATATOKENTTLSECONDS",
    "AWSCONTAINERCREDENTIALSRELATIVEURI",
    "AWSCONTAINERCREDENTIALSFULLURI",
    "AWSCONTAINERAUTHORIZATIONTOKEN",
    "AWSWEBIDENTITYTOKENFILE",
    "METADATAFLAVOR",
    "GOOGLEMETADATAREQUEST",
    "GOOGLEAPPLICATIONCREDENTIALS",
    "GCEMETADATAHOST",
    "CLOUDSDKAUTHCREDENTIALFILEOVERRIDE",
    "AZUREFEDERATEDTOKENFILE",
    "IDENTITYENDPOINT",
    "IDENTITYHEADER",
    "IMDSENDPOINT",
    "MSIENDPOINT",
    // Kubernetes / registry compact aliases
    "KUBECONFIGPATH",
    "K8SAWSID",
    "DOCKERHOST",
    "REGISTRYURL",
    "CONTAINERSREGISTRIESCONF",
    "GHCRHOST",
    "QUAYORGANIZATION",
    "HARBORURL",
    "ARTIFACTORYURL",
    "JFROGURL",
    // CF Access / IAP compact aliases
    "CFACCESSJWTASSERTION",
    "GOOGIAPJWTASSERTION",
    "CFACCESSCLIENTID",
    "CFACCESSCLIENTSECRET",
    "CLOUDFLAREACCESSCLIENTID",
    "CLOUDFLAREACCESSCLIENTSECRET",
    // Git provider compact aliases
    "GITHUBTOKEN",
    "GITHUBPAT",
    "GITHUBUSERID",
    "GITHUBUSEREMAIL",
    "GITHUBLOGIN",
    "GITLABTOKEN",
    "GITLABPRIVATETOKEN",
    "GITLABCITOKEN",
    "GITLABWEBHOOKSECRETTOKEN",
    "GITLABUSERID",
    "GITLABUSERNAME",
    "GITLABUSERLOGIN",
    "GITLABUSEREMAIL",
    "BITBUCKETTOKEN",
    "BITBUCKETAPPPASSWORD",
    "BITBUCKETUSER",
    "BITBUCKETUUID",
    "BITBUCKETUSEREMAIL",
    // Slack / Discord / Stripe compact aliases
    "SLACKBOTTOKEN",
    "SLACKAPPTOKEN",
    "SLACKSIGNINGSECRET",
    "SLACKSIGNATURE",
    "SLACKREQUESTTIMESTAMP",
    "SLACKWEBHOOKURL",
    "DISCORDTOKEN",
    "DISCORDWEBHOOKURL",
    "STRIPEAPIKEY",
    "STRIPESECRETKEY",
    "STRIPESIGNATURE",
    "STRIPEWEBHOOKSECRET",
    // Forwarded / routing compact aliases
    "FORWARDEDURI",
    "ORIGINALURL",
    "ORIGINALURI",
    "ORIGINALPATH",
    "REWRITEURL",
    "REWRITEURI",
    "REALIP",
    "CLIENTIP",
    "TRUECLIENTIP",
    "CFCONNECTINGIP",
    "CLUSTERCLIENTIP",
    "ENVOYEXTERNALADDRESS",
    "ENVOYORIGINALPATH",
    "ENVOYORIGINALURL",
    "ENVOYPEERMETADATA",
    "ENVOYPEERMETADATAID",
    // Method / proxy transport compact aliases
    "HTTPMETHODOVERRIDE",
    "METHODOVERRIDE",
    "HTTPMETHOD",
    "FORWARDEDMETHOD",
    "ORIGINALMETHOD",
    "PROXYAUTHORIZATION",
    "PROXYAUTHENTICATE",
    "PROXYAUTHENTICATIONINFO",
    "PROXYSTATUS",
    "AUTHENTICATIONINFO",
    "PROXYCONNECTION",
    "KEEPALIVE",
    // OIDC / database / identity compact aliases
    "OIDCDATA",
    "OIDCIDENTITY",
    "OIDCISSUER",
    "AMZNOIDCDATA",
    "AMZNOIDCIDENTITY",
    "AMZNOIDCACCESSTOKEN",
    "USERINFO",
    "DATABASEURL",
    "DATABASEDSN",
    "REDISURL",
    "MONGODBURI",
    "POSTGRESURL",
    "MYSQLURL",
    "SUPABASEDBURL",
    "METABASEDBCONNECTIONURI",
    "MBDBCONNECTIONURI",
    // Webhook / session / auth compact aliases
    "AUTHORIZATIONHEADER",
    "REQUESTTIMESTAMP",
    "SESSIONID",
    "SIGNATURETIMESTAMP",
    "HMACSHA256",
    "WEBHOOKSECRET",
    "WEBHOOKSECRETTOKEN",
    "WEBHOOKURL",
    // Proxy / TLS / transport compact aliases
    "PROXYURL",
    "NOPROXY",
    "CABUNDLE",
    "CAFILE",
    "CAPATH",
    "SOCK",
    "SOCKET",
    "NETRC",
    "WGETRC",
    "TLSINSECURE",
    "INSECURE",
    "SSLVERIFY",
    "VERIFYSSL",
    // Credential / kube compact aliases
    "APIKEY",
    "AUTHKEY",
    "AUTHTOKEN",
    "KEYFILE",
    "TOKENFILE",
    "CREDENTIALFILE",
    "CREDENTIALSFILE",
    "ACCESSKEY",
    "SIGNINGKEY",
    "PRIVATEKEY",
    "URLSCHEME",
    "KUBECONFIG",
    "KUBETOKEN",
    "KUBEAPISERVER",
    "KUBECAFILE",
    // Client cert / principal compact aliases
    "FORWARDEDCLIENTCERT",
    "CLIENTCERT",
    "SSLCLIENTCERT",
    "CLIENTCERTCHAIN",
    "CLIENTDN",
    "CLIENTSAN",
    "CLIENTVERIFY",
    "SSLCLIENTVERIFY",
    "SSLCLIENTDN",
    "SSLCLIENTSDN",
    "SSLCLIENTIDN",
    "SSLCLIENTSAN",
    "CLIENTPRINCIPAL",
    "CLIENTPRINCIPALID",
    "CLIENTPRINCIPALNAME",
    "CLIENTPRINCIPALIDP",
    "PRINCIPALID",
    "PRINCIPALNAME",
    "PRINCIPALIDP",
];

const GENERIC_ENV_SENSITIVE_TOKENS: &[&str] = &[
    "ASSERTION",
    "AUTH",
    "AUTHORIZATION",
    "BEARER",
    "CERT",
    "CERTIFICATE",
    "COOKIE",
    "CREDENTIALS",
    "HMAC",
    "JWT",
    "PASSWORD",
    "PROXY",
    "SECRET",
    "SESSION",
    "SIGNATURE",
    "TE",
    "TOKEN",
    "TRAILER",
    "UPGRADE",
];

const SHARED_CANONICAL_ENV_SUFFIX_NAMES: &[&str] = &[
    "ACCESS_KEY",
    "API_HASH",
    "API_KEY",
    "ARR_CLIENTCERT",
    "ARTIFACTORY_URL",
    "AUTHENTICATION_INFO",
    "AUTHORIZATION_HEADER",
    "AUTH_HEADER",
    "CA_BUNDLE",
    "CA_FILE",
    "CA_PATH",
    "CF_CONNECTING_IP",
    "CLIENT_CERT",
    "CLIENT_CERT_CHAIN",
    "CLIENT_DN",
    "CLIENT_IP",
    "CLIENT_SAN",
    "CLIENT_VERIFY",
    "CLUSTER_CLIENT_IP",
    "CONTAINERS_REGISTRIES_CONF",
    "CREDENTIALS_FILE",
    "CREDENTIAL_FILE",
    "DATABASE_DSN",
    "DATABASE_URL",
    "DOCKER_HOST",
    "ENVOY_EXTERNAL_ADDRESS",
    "ENVOY_PEER_METADATA",
    "ENVOY_PEER_METADATA_ID",
    "FORWARDED_CLIENT_CERT",
    "FORWARDED_METHOD",
    "FORWARDED_PORT",
    "FORWARDED_PREFIX",
    "FORWARDED_PROTO",
    "FORWARDED_PROTOCOL",
    "FORWARDED_SERVER",
    "FORWARDED_SSL",
    "FORWARDED_URI",
    "GHCR_HOST",
    "HARBOR_URL",
    "HMAC_SHA256",
    "HTTP_METHOD",
    "HTTP_METHOD_OVERRIDE",
    "JFROG_URL",
    "K8S_AWS_ID",
    "KEEP_ALIVE",
    "KEY_FILE",
    "KUBE_CONFIG_PATH",
    "MB_DB_CONNECTION_URI",
    "METABASE_DB_CONNECTION_URI",
    "METHOD_OVERRIDE",
    "MONGODB_URI",
    "MYSQL_URL",
    "NO_PROXY",
    "ORIGINAL_FORWARDED_FOR",
    "ORIGINAL_FORWARDED_HOST",
    "ORIGINAL_FORWARDED_PORT",
    "ORIGINAL_FORWARDED_PREFIX",
    "ORIGINAL_FORWARDED_PROTO",
    "ORIGINAL_FORWARDED_PROTOCOL",
    "ORIGINAL_FORWARDED_SCHEME",
    "ORIGINAL_FORWARDED_SERVER",
    "ORIGINAL_HOST",
    "ORIGINAL_METHOD",
    "ORIGINAL_PATH",
    "ORIGINAL_URI",
    "ORIGINAL_URL",
    "POSTGRES_URL",
    "PRIVATE_KEY",
    "PROXY_AUTHENTICATE",
    "PROXY_AUTHENTICATION_INFO",
    "PROXY_AUTHORIZATION",
    "PROXY_CONNECTION",
    "PROXY_STATUS",
    "PROXY_URL",
    "QUAY_ORGANIZATION",
    "REAL_IP",
    "REDIS_URL",
    "REGISTRY_URL",
    "REQUEST_TIMESTAMP",
    "REWRITE_URI",
    "REWRITE_URL",
    "SESSION_ID",
    "SIGNING_KEY",
    "SQLITE_FILE",
    "SQLITE_HISTORY",
    "SQLITE_PATH",
    "SQLITE_TMPDIR",
    "SQLITE_URL",
    "SSL_CLIENT_CERT",
    "SSL_CLIENT_DN",
    "SSL_CLIENT_I_DN",
    "SSL_CLIENT_SAN",
    "SSL_CLIENT_S_DN",
    "SSL_CLIENT_VERIFY",
    "SSL_VERIFY",
    "SUPABASE_DB_URL",
    "TLS_INSECURE",
    "TOKEN_FILE",
    "TRUE_CLIENT_IP",
    "URL_SCHEME",
    "VERIFY_SSL",
    "WEBHOOK_SECRET",
    "WEBHOOK_SECRET_TOKEN",
    "WEBHOOK_URL",
];

fn env_suffix_matches_token(upper_env_key: &str, token: &str) -> bool {
    upper_env_key
        .strip_suffix(token)
        .is_some_and(|prefix| prefix.ends_with('_'))
}

fn env_segment_matches_token(upper_env_key: &str, token: &str) -> bool {
    upper_env_key.contains(&format!("_{token}_"))
}

/// Matches compact env aliases used as trailing token (e.g. `SERVICE_GITHUBTOKEN`).
pub(crate) fn is_compact_sensitive_env_alias_suffix(upper_env_key: &str) -> bool {
    COMPACT_ENV_ALIAS_TOKENS
        .iter()
        .copied()
        .any(|token| env_suffix_matches_token(upper_env_key, token))
}

/// Matches compact env aliases as suffix or middle segment
/// (e.g. `LLM_FOO_GITHUBTOKEN_BAR`).
pub(crate) fn is_compact_sensitive_env_alias_suffix_or_segment(upper_env_key: &str) -> bool {
    COMPACT_ENV_ALIAS_TOKENS.iter().copied().any(|token| {
        env_suffix_matches_token(upper_env_key, token)
            || env_segment_matches_token(upper_env_key, token)
    })
}

/// Matches generic sensitive env tokens as trailing token
/// (e.g. `SERVICE_TOKEN`, `SERVICE_SESSION`).
pub(crate) fn is_generic_sensitive_env_token_suffix(upper_env_key: &str) -> bool {
    GENERIC_ENV_SENSITIVE_TOKENS
        .iter()
        .copied()
        .any(|token| env_suffix_matches_token(upper_env_key, token))
}

/// Matches generic sensitive env tokens as suffix or middle segment
/// (e.g. `LLM_FOO_TOKEN_BAR`).
pub(crate) fn is_generic_sensitive_env_token_suffix_or_segment(upper_env_key: &str) -> bool {
    GENERIC_ENV_SENSITIVE_TOKENS.iter().copied().any(|token| {
        env_suffix_matches_token(upper_env_key, token)
            || env_segment_matches_token(upper_env_key, token)
    })
}

/// Matches shared canonical sensitive env names as trailing suffix
/// (e.g. `SERVICE_WEBHOOK_URL`, `SERVICE_PROXY_AUTHORIZATION`).
pub(crate) fn is_shared_sensitive_env_canonical_suffix(upper_env_key: &str) -> bool {
    SHARED_CANONICAL_ENV_SUFFIX_NAMES
        .iter()
        .copied()
        .any(|name| env_suffix_matches_token(upper_env_key, name))
}

/// Matches shared canonical sensitive env names as trailing suffix or middle
/// segment (e.g. `SERVICE_WEBHOOK_SECRET` or `LLM_FOO_WEBHOOK_SECRET_BAR`).
pub(crate) fn is_shared_sensitive_env_canonical_suffix_or_segment(upper_env_key: &str) -> bool {
    SHARED_CANONICAL_ENV_SUFFIX_NAMES
        .iter()
        .copied()
        .any(|name| {
            env_suffix_matches_token(upper_env_key, name)
                || env_segment_matches_token(upper_env_key, name)
        })
}

const SHARED_SENSITIVE_ENV_NAMESPACES: &[&str] = &[
    "ACTIONS",
    "AKAMAI",
    "AMQP",
    "ARGOCD",
    "ARM",
    "ARTIFACTORY",
    "AWS",
    "AZURE",
    "BITBUCKET",
    "BROKER",
    "BUGSNAG",
    "BUILDKITE",
    "BUN",
    "BUNDLE",
    "CARGO",
    "CI",
    "CIRCLECI",
    "CLOUDSDK",
    "CODECOV",
    "CONTAINERS",
    "COSIGN",
    "CURL",
    "DATABASE",
    "DATADOG",
    "DIGITALOCEAN",
    "DISCORD",
    "DOCKER",
    "DOPPLER",
    "DRONE",
    "ENVOY",
    "FACEBOOK",
    "FASTLY",
    "FLY",
    "FORWARDED",
    "GCP",
    "GEM",
    "GHCR",
    "GIT",
    "GITEA",
    "GITHUB",
    "GITLAB",
    "GOGS",
    "GOOGLE",
    "GRAFANA",
    "HARBOR",
    "HCLOUD",
    "HELM",
    "HEROKU",
    "HONEYCOMB",
    "IDENTITY",
    "IMDS",
    "INFISICAL",
    "INSTAGRAM",
    "JENKINS",
    "JFROG",
    "K8S",
    "KAFKA",
    "KUBE",
    "LIBSQL",
    "LINE",
    "LINODE",
    "LOGDNA",
    "MAILGUN",
    "MATRIX",
    "META",
    "METABASE",
    "MONGODB",
    "MSI",
    "MYSQL",
    "NATS",
    "NEON",
    "NETLIFY",
    "NGROK",
    "NPM",
    "NUGET",
    "OCI",
    "OIDC",
    "OPFS",
    "ORIGINAL",
    "OTEL",
    "OTLP",
    "PAGERDUTY",
    "PGLITE",
    "PIP",
    "PLANETSCALE",
    "PNPM",
    "POETRY",
    "POSTGRES",
    "POSTMARK",
    "PRINCIPAL",
    "PULUMI",
    "PYPI",
    "QUAY",
    "RABBITMQ",
    "RAILWAY",
    "REDIS",
    "REDPANDA",
    "REGISTRY",
    "RENDER",
    "RESEND",
    "ROLLBAR",
    "RUBYGEMS",
    "RUNNER",
    "RUSTUP",
    "SCW",
    "SENDGRID",
    "SENTRY",
    "SHOPIFY",
    "SIGNAL",
    "SIGSTORE",
    "SLACK",
    "SONAR",
    "SOPS",
    "SQLCIPHER",
    "SQLITE",
    "SSH",
    "STRIPE",
    "SUPABASE",
    "TAILSCALE",
    "TELEGRAM",
    "TERRAFORM",
    "TS",
    "TURSO",
    "TWILIO",
    "TWINE",
    "TWITTER",
    "UPSTASH",
    "UV",
    "VAULT",
    "VERCEL",
    "VULTR",
    "WGET",
    "WHATSAPP",
    "YARN",
];

/// Matches shared sensitive env namespaces as prefix (e.g. `AWS_...`).
pub(crate) fn is_shared_sensitive_env_namespace_prefix(upper_env_key: &str) -> bool {
    SHARED_SENSITIVE_ENV_NAMESPACES
        .iter()
        .copied()
        .any(|ns| upper_env_key.starts_with(&format!("{ns}_")))
}

/// Matches shared sensitive env namespaces as middle segment (e.g.
/// `LLM_FOO_AWS_BAR`).
pub(crate) fn is_shared_sensitive_env_namespace_segment(upper_env_key: &str) -> bool {
    SHARED_SENSITIVE_ENV_NAMESPACES
        .iter()
        .copied()
        .any(|ns| upper_env_key.contains(&format!("_{ns}_")))
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
    )
        || upper.ends_with("_API_KEY")
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

const COMPACT_HEADER_EXACT: &[&str] = &[
    // CF Access / IAP
    "cfaccessjwtassertion",
    "xcfaccessjwtassertion",
    "xgoogiapjwtassertion",
    "cfaccessclientid",
    "cfaccessclientsecret",
    "xcfaccessclientid",
    "xcfaccessclientsecret",
    // Metadata compact headers
    "xawsec2metadatatoken",
    "xawsec2metadatatokenttlseconds",
    "metadataflavor",
    "xgooglemetadatarequest",
    "xidentityheader",
    "xmsisecret",
    // K8s / registry compact headers
    "xkubeconfigpath",
    "xkubetoken",
    "xkubecafile",
    "xk8sawsid",
    "xdockerhost",
    "xregistryurl",
    "xcontainersregistriesconf",
    "xghcrhost",
    "xquayorganization",
    "xharborurl",
    "xartifactoryurl",
    "xjfrogurl",
    // Git provider compact headers
    "xgithubtoken",
    "xgithubpat",
    "xgitlabtoken",
    "xgitlabprivatetoken",
    "xgitlabcitoken",
    "xgitlabwebhooksecrettoken",
    "xbitbuckettoken",
    "xbitbucketapppassword",
    "xgitlabuserid",
    "xgitlabusername",
    "xgitlabuserlogin",
    "xgitlabuseremail",
    "xgithubuserid",
    "xgithublogin",
    "xgithubuseremail",
    "xbitbucketuser",
    "xbitbucketuuid",
    "xbitbucketuseremail",
    // Slack / Discord / Stripe compact headers
    "xslacksignature",
    "xslackrequesttimestamp",
    "xslackbottoken",
    "xslackapptoken",
    "xslackwebhookurl",
    "xdiscordtoken",
    "xdiscordwebhookurl",
    "xstripesignature",
    "xstripeapikey",
    "xstripesecretkey",
    "xstripewebhooksecret",
    // Forwarded / routing compact headers
    "xforwardeduri",
    "xoriginalurl",
    "xoriginaluri",
    "xoriginalpath",
    "xrewriteurl",
    "xrewriteuri",
    "xrealip",
    "xclientip",
    "trueclientip",
    "cfconnectingip",
    "xclusterclientip",
    "xenvoyexternaladdress",
    "xenvoyoriginalpath",
    "xenvoyoriginalurl",
    "xenvoypeermetadata",
    "xenvoypeermetadataid",
    "xforwardedclientip",
    "fastlyclientip",
    // Method / proxy transport compact headers
    "xhttpmethodoverride",
    "xmethodoverride",
    "xforwardedmethod",
    "xoriginalmethod",
    "xhttpmethod",
    "proxyauthorization",
    "proxyauthenticate",
    "proxyauthenticationinfo",
    "proxystatus",
    "authenticationinfo",
    "proxyconnection",
    "keepalive",
    // OIDC / database / identity compact headers
    "xoidcdata",
    "xoidcidentity",
    "xamznoidcdata",
    "xamznoidcidentity",
    "xamznoidcaccesstoken",
    "xuserinfo",
    "xdatabaseurl",
    "xdatabasedsn",
    "xredisurl",
    "xmongodburi",
    "xpostgresurl",
    "xmysqlurl",
    "xsupabasedburl",
    "xmetabasedbconnectionuri",
    "xmbdbconnectionuri",
    // Webhook / session / auth compact headers
    "xrequesttimestamp",
    "xsignaturetimestamp",
    "xhmacsha256",
    "xwebhooksecret",
    "xwebhooksecrettoken",
    "xwebhookurl",
    // Client cert / principal compact headers
    "xforwardedclientcert",
    "xclientcert",
    "xsslclientcert",
    "xclientcertchain",
    "xclientdn",
    "xclientsan",
    "xclientverify",
    "xsslclientverify",
    "xsslclientdn",
    "xsslclientsdn",
    "xsslclientidn",
    "xsslclientsan",
    "xmsclientprincipal",
    "xmsclientprincipalid",
    "xmsclientprincipalname",
    "xmsclientprincipalidp",
];

const COMPACT_HEADER_PREFIX: &[&str] = &[
    "xproxyurl",
    "xnoproxy",
    "xcabundle",
    "xcafile",
    "xcapath",
    "xsock",
    "xsocket",
    "xnetrc",
    "xwgetrc",
    "xtlsinsecure",
    "xinsecure",
    "xverifyssl",
    "xsslverify",
    "xaccesskey",
    "xsigningkey",
    "xcredentialfile",
    "xcredentialsfile",
    "xkeyfile",
    "xtokenfile",
    "xprivatekey",
    "xurlscheme",
    "xkubeconfig",
    "xk8saws",
    "xdockerhost",
    "xregistryurl",
    "xcontainersregistriesconf",
    "xghcrhost",
    "xquayorganization",
    "xharborurl",
    "xartifactoryurl",
    "xjfrogurl",
    "xgitlabuser",
    "xgithubuser",
    "xbitbucketuser",
];

const SENSITIVE_HEADER_CANONICAL_EXACT: &[&str] = &[
    "api-key",
    "authentication",
    "authorization",
    "cf-access-authenticated-user-email",
    "cf-access-authenticated-user-id",
    "connection",
    "content-length",
    "cookie",
    "forwarded",
    "front-end-https",
    "host",
    "impersonate-group",
    "impersonate-uid",
    "impersonate-user",
    "metadata",
    "ngrok-authtoken",
    "set-cookie",
    "ssl-client-cert",
    "te",
    "trailer",
    "transfer-encoding",
    "upgrade",
    "via",
    "x-access-token",
    "x-amqp-url",
    "x-amz-security-token",
    "x-api-key",
    "x-api-secret",
    "x-api-token",
    "x-arr-clientcert",
    "x-auth-email",
    "x-auth-request-access-token",
    "x-auth-request-email",
    "x-auth-request-groups",
    "x-auth-request-name",
    "x-auth-request-preferred-username",
    "x-auth-request-uid",
    "x-auth-request-user",
    "x-auth-request-user-id",
    "x-auth-secret",
    "x-auth-token",
    "x-auth-user",
    "x-auth-userid",
    "x-authenticated-email",
    "x-authenticated-groups",
    "x-authenticated-user",
    "x-authenticated-user-email",
    "x-authenticated-user-id",
    "x-authenticated-user-name",
    "x-authenticated-userid",
    "x-authentication-token",
    "x-authorization",
    "x-broker-url",
    "x-bugsnag-api-key",
    "x-ci-job-token",
    "x-circleci-token",
    "x-cloudflare-tunnel-token",
    "x-datadog-api-key",
    "x-end-user",
    "x-end-user-email",
    "x-end-userid",
    "x-facebook-signature",
    "x-forwarded-access-token",
    "x-forwarded-email",
    "x-forwarded-for",
    "x-forwarded-groups",
    "x-forwarded-host",
    "x-forwarded-port",
    "x-forwarded-prefix",
    "x-forwarded-proto",
    "x-forwarded-protocol",
    "x-forwarded-scheme",
    "x-forwarded-server",
    "x-forwarded-ssl",
    "x-forwarded-user",
    "x-forwarded-user-email",
    "x-forwarded-user-id",
    "x-forwarded-userid",
    "x-forwardedfor",
    "x-forwardedhost",
    "x-forwardedport",
    "x-forwardedprefix",
    "x-forwardedproto",
    "x-forwardedprotocol",
    "x-forwardedserver",
    "x-forwardedssl",
    "x-gitea-signature",
    "x-gitlab-webhook-token",
    "x-gogs-signature",
    "x-goog-authenticated-user-email",
    "x-goog-authenticated-user-id",
    "x-googauthenticateduseremail",
    "x-googauthenticateduserid",
    "x-google-authenticated-user-email",
    "x-google-authenticated-user-id",
    "x-googleauthenticateduseremail",
    "x-googleauthenticateduserid",
    "x-grafana-api-key",
    "x-honeycomb-team",
    "x-host",
    "x-hub-signature",
    "x-hub-signature-256",
    "x-hubsignature",
    "x-hubsignature256",
    "x-id-token",
    "x-libsql-auth-token",
    "x-line-signature",
    "x-logdna-apikey",
    "x-matrix-access-token",
    "x-ms-token-aad-access-token",
    "x-ms-token-aad-expires-on",
    "x-ms-token-aad-id-token",
    "x-ms-token-aad-refresh-token",
    "x-newrelic-api-key",
    "x-ngrok-authtoken",
    "x-opfs-path",
    "x-opfs-root",
    "x-original-forwarded-for",
    "x-original-forwarded-host",
    "x-original-forwarded-port",
    "x-original-forwarded-prefix",
    "x-original-forwarded-proto",
    "x-original-forwarded-protocol",
    "x-original-forwarded-scheme",
    "x-original-forwarded-server",
    "x-original-groups",
    "x-original-host",
    "x-original-user",
    "x-originalforwardedfor",
    "x-originalforwardedhost",
    "x-originalforwardedport",
    "x-originalforwardedprefix",
    "x-originalforwardedproto",
    "x-originalforwardedprotocol",
    "x-originalforwardedscheme",
    "x-originalforwardedserver",
    "x-originalhost",
    "x-otlp-api-key",
    "x-pagerduty-token",
    "x-pglite-data-dir",
    "x-pglite-db-path",
    "x-pglite-opfs-path",
    "x-principal",
    "x-principal-id",
    "x-principal-name",
    "x-remote-email",
    "x-remote-groups",
    "x-remote-user",
    "x-remote-userid",
    "x-rollbar-access-token",
    "x-session-token",
    "x-shopify-hmac-sha256",
    "x-shopify-hmacsha256",
    "x-signature-ed25519",
    "x-sqlcipher-key",
    "x-sqlite-file",
    "x-sqlite-history",
    "x-sqlite-path",
    "x-sqlite-tmpdir",
    "x-sqlite-url",
    "x-tailscale-authkey",
    "x-telegram-api-hash",
    "x-telegram-bot-api-secret-token",
    "x-turso-auth-token",
    "x-twilio-signature",
    "x-twitter-bearer-token",
    "x-twitter-webhooks-signature",
    "x-user",
    "x-user-email",
    "x-user-groups",
    "x-user-id",
    "x-user-name",
    "x-userid",
    "x-vault-token",
    "x-verified-email",
    "x-verified-user",
    "x-whatsapp-signature",
];

const SENSITIVE_HEADER_CANONICAL_PREFIX: &[&str] = &[
    "cf-access-",
    "cf-access-authenticated-user-",
    "cf-access-client-",
    "impersonate-extra-",
    "proxy-",
    "x-access-key-",
    "x-actions-",
    "x-akamai-",
    "x-amqp-",
    "x-amzn-oidc-",
    "x-argocd-",
    "x-arm-",
    "x-artifactory-",
    "x-assertion-",
    "x-auth-",
    "x-auth-request-",
    "x-auth-user-",
    "x-authenticated-user-",
    "x-authorization-",
    "x-aws-",
    "x-azure-",
    "x-bearer-",
    "x-bitbucket-",
    "x-bitbucket-user-",
    "x-broker-",
    "x-bugsnag-",
    "x-buildkite-",
    "x-bun-",
    "x-bundle-",
    "x-ca-bundle-",
    "x-ca-file-",
    "x-ca-path-",
    "x-cargo-",
    "x-certificate-",
    "x-certificatechain-",
    "x-cf-access-",
    "x-cf-access-client-",
    "x-cf-api-",
    "x-ci-",
    "x-circleci-",
    "x-client-",
    "x-client-principal-",
    "x-clientprincipal-",
    "x-cloudflare-api-",
    "x-cloudflare-tunnel-",
    "x-cloudsdk-",
    "x-codecov-",
    "x-containers-",
    "x-cookie-",
    "x-cosign-",
    "x-credential-",
    "x-credentials-",
    "x-curl-",
    "x-database-",
    "x-datadog-",
    "x-digitalocean-",
    "x-discord-",
    "x-docker-",
    "x-doppler-",
    "x-drone-",
    "x-dsn-",
    "x-end-user-",
    "x-envoy-",
    "x-facebook-",
    "x-fastly-",
    "x-fly-",
    "x-forwarded-",
    "x-forwarded-method-",
    "x-forwarded-user-",
    "x-gcp-",
    "x-gem-",
    "x-ghcr-",
    "x-git-",
    "x-gitea-",
    "x-github-",
    "x-github-user-",
    "x-gitlab-",
    "x-gitlab-user-",
    "x-gogs-",
    "x-goog-authenticated-user-",
    "x-google-",
    "x-google-authenticated-user-",
    "x-grafana-",
    "x-harbor-",
    "x-hcloud-",
    "x-helm-",
    "x-heroku-",
    "x-honeycomb-",
    "x-http-method-",
    "x-identity-",
    "x-imds-",
    "x-infisical-",
    "x-insecure-",
    "x-instagram-",
    "x-jenkins-",
    "x-jfrog-",
    "x-jwt-",
    "x-k8s-",
    "x-kafka-",
    "x-key-file-",
    "x-kube-",
    "x-libsql-",
    "x-line-",
    "x-linode-",
    "x-logdna-",
    "x-mailgun-",
    "x-matrix-",
    "x-meta-",
    "x-metabase-",
    "x-method-override-",
    "x-mongodb-",
    "x-ms-client-principal-",
    "x-ms-clientprincipal-",
    "x-ms-token-aad-",
    "x-msi-",
    "x-mysql-",
    "x-nats-",
    "x-neon-",
    "x-netlify-",
    "x-newrelic-",
    "x-ngrok-",
    "x-no-proxy-",
    "x-node-auth-",
    "x-npm-",
    "x-npm-config-",
    "x-nuget-",
    "x-oci-",
    "x-oci-cli-",
    "x-oidc-",
    "x-op-service-",
    "x-opfs-",
    "x-original-",
    "x-original-method-",
    "x-otel-",
    "x-otlp-",
    "x-pagerduty-",
    "x-password-",
    "x-pglite-",
    "x-pip-",
    "x-planetscale-",
    "x-pnpm-",
    "x-poetry-",
    "x-postgres-",
    "x-postmark-",
    "x-principal-",
    "x-private-key-",
    "x-proxy-",
    "x-pulumi-",
    "x-pypi-",
    "x-quay-",
    "x-rabbitmq-",
    "x-railway-",
    "x-redis-",
    "x-redpanda-",
    "x-registry-",
    "x-remote-user-",
    "x-render-",
    "x-request-timestamp-",
    "x-resend-",
    "x-rewrite-",
    "x-rollbar-",
    "x-rubygems-",
    "x-rustup-",
    "x-scw-",
    "x-secret-",
    "x-sendgrid-",
    "x-sentry-",
    "x-session-",
    "x-shopify-",
    "x-signal-",
    "x-signing-key-",
    "x-sigstore-",
    "x-slack-",
    "x-sonar-",
    "x-sops-",
    "x-sqlcipher-",
    "x-sqlite-",
    "x-ssh-",
    "x-ssl-client-",
    "x-ssl-verify-",
    "x-stripe-",
    "x-supabase-",
    "x-tailscale-",
    "x-telegram-",
    "x-terraform-",
    "x-tls-insecure-",
    "x-token-",
    "x-token-file-",
    "x-ts-",
    "x-turso-",
    "x-twilio-",
    "x-twine-",
    "x-twitter-",
    "x-upstash-",
    "x-url-scheme-",
    "x-user-",
    "x-userinfo-",
    "x-uv-",
    "x-vault-",
    "x-vercel-",
    "x-verified-",
    "x-verify-ssl-",
    "x-vultr-",
    "x-webhook-",
    "x-wget-",
    "x-whatsapp-",
    "x-yarn-",
];

/// Matches any sensitive plugin header by canonical exact/prefix policies
/// plus compact alias normalization policy.
pub(crate) fn is_sensitive_plugin_header_name(lower_header_name: &str) -> bool {
    SENSITIVE_HEADER_CANONICAL_EXACT
        .iter()
        .any(|v| lower_header_name == *v)
        || SENSITIVE_HEADER_CANONICAL_PREFIX
            .iter()
            .any(|v| lower_header_name.starts_with(v))
        || is_compact_sensitive_header_alias(lower_header_name)
}

fn normalized_header_compact(name: &str) -> String {
    name.chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .map(|c| c.to_ascii_lowercase())
        .collect()
}

/// Matches compact header aliases (without `-` / `_`) used for sensitive data.
pub(crate) fn is_compact_sensitive_header_alias(lower_header_name: &str) -> bool {
    let compact = normalized_header_compact(lower_header_name);
    COMPACT_HEADER_EXACT.iter().any(|v| compact == *v)
        || COMPACT_HEADER_PREFIX.iter().any(|v| compact.starts_with(v))
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

        let segment_blocked = [
            "LLM_FOO_AWS_BAR",
            "LLM_FOO_GITHUB_BAR",
            "LLM_FOO_KUBE_BAR",
        ];
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
