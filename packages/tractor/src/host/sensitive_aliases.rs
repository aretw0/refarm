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
