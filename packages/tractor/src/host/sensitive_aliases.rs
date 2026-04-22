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
