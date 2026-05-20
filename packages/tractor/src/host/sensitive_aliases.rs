mod env;
mod headers;
mod policy;

pub(crate) fn is_compact_sensitive_env_alias_suffix(upper_env_key: &str) -> bool {
    env::is_compact_sensitive_env_alias_suffix(upper_env_key)
}

pub(crate) fn is_compact_sensitive_env_alias_suffix_or_segment(upper_env_key: &str) -> bool {
    env::is_compact_sensitive_env_alias_suffix_or_segment(upper_env_key)
}

#[cfg(test)]
pub(crate) fn is_generic_sensitive_env_token_suffix(upper_env_key: &str) -> bool {
    env::is_generic_sensitive_env_token_suffix(upper_env_key)
}

pub(crate) fn is_generic_sensitive_env_token_suffix_or_segment(upper_env_key: &str) -> bool {
    env::is_generic_sensitive_env_token_suffix_or_segment(upper_env_key)
}

#[cfg(test)]
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

pub(crate) fn is_disallowed_model_forward_env_upper(upper: &str) -> bool {
    policy::is_disallowed_model_forward_env_upper(upper)
}

/// Shared plugin-forwarding policy for `MODEL_*` env keys.
pub(crate) fn is_forwardable_model_env_key(key: &str) -> bool {
    policy::is_forwardable_model_env_key(key)
}

/// Shared plugin-forwarding policy for `MODEL_*` env values.
pub(crate) fn is_forwardable_model_env_value(value: &str) -> bool {
    policy::is_forwardable_model_env_value(value)
}

/// Shared spawn boundary env-key policy (exact keys + prefixes + shared alias catalogs).
pub(crate) fn is_spawn_sensitive_env_key(key: &str) -> bool {
    policy::is_spawn_sensitive_env_key(key)
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
            "MODEL_FOO_GITLABTOKEN_BAR",
            "MODEL_FOO_CLOUDFLAREACCESSCLIENTSECRET_BAR",
            "MODEL_FOO_SLACKREQUESTTIMESTAMP_BAR",
        ];
        for key in blocked {
            assert!(
                is_compact_sensitive_env_alias_suffix_or_segment(key),
                "expected compact env segment match: {key}"
            );
        }

        let allowed = ["MODEL_FOO_GITLAB_TOKEN_BAR", "MODEL_PROVIDER_BASE_URL"];
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
            "MODEL_FOO_TOKEN_BAR",
            "MODEL_FOO_SECRET_BAR",
            "MODEL_FOO_PROXY_BAR",
            "MODEL_FOO_AUTHORIZATION_BAR",
        ];
        for key in segment_blocked {
            assert!(
                is_generic_sensitive_env_token_suffix_or_segment(key),
                "expected generic env segment match: {key}"
            );
        }

        let allowed = ["SERVICE_WEBHOOK_TOKEN", "TOKEN", "MODEL_PROVIDER_BASE_URL"];
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
            "MODEL_FOO_WEBHOOK_SECRET_BAR",
            "MODEL_FOO_PROXY_AUTHORIZATION_BAR",
            "MODEL_FOO_DATABASE_URL_BAR",
            "MODEL_FOO_SSL_CLIENT_CERT_BAR",
        ];
        for key in blocked {
            assert!(
                is_shared_sensitive_env_canonical_suffix_or_segment(key),
                "expected shared canonical env segment match: {key}"
            );
        }

        let allowed = ["MODEL_FOO_WEBHOOKSECRET_BAR", "MODEL_PROVIDER_BASE_URL"];
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

        let segment_blocked = ["MODEL_FOO_AWS_BAR", "MODEL_FOO_GITHUB_BAR", "MODEL_FOO_KUBE_BAR"];
        for key in segment_blocked {
            assert!(
                is_shared_sensitive_env_namespace_segment(key),
                "expected shared namespace segment match: {key}"
            );
        }

        let allowed = ["MODEL_FOO_AWSBAR_BAZ", "SERVICE_PROVIDER_BASE_URL"];
        for key in allowed {
            assert!(
                !is_shared_sensitive_env_namespace_segment(key),
                "expected shared namespace segment helper NOT to match: {key}"
            );
        }
    }

    #[test]
    fn disallowed_model_forward_env_helper_matches_expected_cases() {
        let blocked = [
            "MODEL_GITHUB_TOKEN",
            "MODEL_PROVIDER_WEBHOOK_SECRET",
            "MODEL_AWS_EC2_METADATA_TOKEN",
            "MODEL_AUTH_REQUEST_USER",
        ];
        for key in blocked {
            assert!(
                is_disallowed_model_forward_env_upper(key),
                "expected disallowed model forward env key: {key}"
            );
        }

        let allowed = ["MODEL_ID", "MODEL_PROVIDER_BASE_URL", "MODEL_TEMPERATURE"];
        for key in allowed {
            assert!(
                !is_disallowed_model_forward_env_upper(key),
                "expected allowed model forward env key: {key}"
            );
        }
    }

    #[test]
    fn model_forwardable_helpers_match_expected_cases() {
        let key_allowed = ["MODEL_ID", "MODEL_PROVIDER_BASE_URL", "MODEL_TEMPERATURE"];
        for key in key_allowed {
            assert!(
                is_forwardable_model_env_key(key),
                "expected MODEL env key to be forwardable: {key}"
            );
        }

        let key_blocked = ["MODEL_GITHUB_TOKEN", "MODEL_USER", "MODEL_AWS_FOO_BAR"];
        for key in key_blocked {
            assert!(
                !is_forwardable_model_env_key(key),
                "expected MODEL env key to be blocked: {key}"
            );
        }

        let value_allowed = ["gpt-4.1", "openai", "0.2"];
        for value in value_allowed {
            assert!(
                is_forwardable_model_env_value(value),
                "expected MODEL env value to be forwardable: {value}"
            );
        }

        let value_blocked = ["", " has-space", "line\nfeed"];
        for value in value_blocked {
            assert!(
                !is_forwardable_model_env_value(value),
                "expected MODEL env value to be blocked: {value:?}"
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
