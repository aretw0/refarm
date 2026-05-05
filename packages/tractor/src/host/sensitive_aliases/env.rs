// Shared env-sensitive alias and namespace policies extracted from
// sensitive_aliases.rs to keep domain-focused ownership.

// Shared compact-alias catalog for host-side security boundaries.
// Goal: keep compact variants (without `_` / `-`) in one place so
// spawn/plugin/wasi policies stay in lockstep with lower maintenance churn.
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
    // `WEBHOOK_TOKEN` is treated as a dedicated alias family (not a generic
    // token hit) to avoid broad false positives in generic-token matching.
    if env_suffix_matches_token(upper_env_key, "WEBHOOK_TOKEN")
        || env_segment_matches_token(upper_env_key, "WEBHOOK_TOKEN")
    {
        return false;
    }

    is_generic_sensitive_env_token_suffix(upper_env_key)
        || GENERIC_ENV_SENSITIVE_TOKENS
            .iter()
            .copied()
            .any(|token| env_segment_matches_token(upper_env_key, token))
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
    is_shared_sensitive_env_canonical_suffix(upper_env_key)
        || SHARED_CANONICAL_ENV_SUFFIX_NAMES
            .iter()
            .copied()
            .any(|name| env_segment_matches_token(upper_env_key, name))
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
