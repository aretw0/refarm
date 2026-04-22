/// Shared compact-alias catalog for host-side security boundaries.
///
/// Goal: keep compact variants (without `_` / `-`) in one place so
/// spawn/plugin/wasi policies stay in lockstep with lower maintenance churn.

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
