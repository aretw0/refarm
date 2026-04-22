fn sanitized_plugin_headers(headers: &[(String, String)]) -> Vec<(&str, &str)> {
    const MAX_FORWARDED_HEADER_COUNT: usize = 64;
    const MAX_HEADER_SCAN: usize = 256;
    const MAX_HEADER_NAME_LEN: usize = 128;
    const MAX_HEADER_PAIR_BYTES: usize = 16 * 1024;
    const MAX_HEADER_TOTAL_BYTES: usize = 256 * 1024;

    let mut out = Vec::new();
    let mut seen_names = std::collections::HashSet::new();
    let mut total_bytes = 0usize;

    for (name, value) in headers.iter().take(MAX_HEADER_SCAN) {
        if out.len() >= MAX_FORWARDED_HEADER_COUNT {
            break;
        }

        let trimmed_name = name.trim();
        if trimmed_name.is_empty() || trimmed_name.len() > MAX_HEADER_NAME_LEN {
            continue;
        }

        let n = trimmed_name.to_ascii_lowercase();
        if n.is_empty()
            || n == "authorization"
            || n == "x-authorization"
            || n.starts_with("x-authorization-")
            || n == "authentication"
            || n == "x-api-key"
            || n == "x-api-token"
            || n == "x-api-secret"
            || n == "x-auth-secret"
            || n.starts_with("x-auth-")
            || n == "x-webhook-secret"
            || n.starts_with("x-bearer-")
            || n.starts_with("x-token-")
            || n.starts_with("x-secret-")
            || n.starts_with("x-access-key-")
            || n.starts_with("x-signing-key-")
            || n.starts_with("x-credential-")
            || n.starts_with("x-credentials-")
            || n.starts_with("x-key-file-")
            || n.starts_with("x-token-file-")
            || n.starts_with("x-password-")
            || n.starts_with("x-cookie-")
            || n.starts_with("x-proxy-")
            || n.starts_with("x-no-proxy-")
            || n.starts_with("x-ca-bundle-")
            || n.starts_with("x-ca-file-")
            || n.starts_with("x-ca-path-")
            || n.starts_with("x-jwt-")
            || n.starts_with("x-sock-")
            || n.starts_with("x-socket-")
            || n == "api-key"
            || n == "x-datadog-api-key"
            || n.starts_with("x-datadog-")
            || n == "x-honeycomb-team"
            || n.starts_with("x-honeycomb-")
            || n == "x-newrelic-api-key"
            || n.starts_with("x-newrelic-")
            || n == "x-logdna-apikey"
            || n.starts_with("x-logdna-")
            || n == "x-rollbar-access-token"
            || n.starts_with("x-rollbar-")
            || n == "x-bugsnag-api-key"
            || n.starts_with("x-bugsnag-")
            || n == "x-pagerduty-token"
            || n.starts_with("x-pagerduty-")
            || n == "x-grafana-api-key"
            || n.starts_with("x-grafana-")
            || n == "x-otlp-api-key"
            || n.starts_with("x-otlp-")
            || n.starts_with("x-otel-")
            || n.starts_with("x-sentry-")
            || n.starts_with("x-sendgrid-")
            || n.starts_with("x-mailgun-")
            || n.starts_with("x-postmark-")
            || n.starts_with("x-resend-")
            || n == "x-auth-token"
            || n == "x-authentication-token"
            || n == "x-github-token"
            || n.starts_with("x-github-")
            || n == "x-gitlab-token"
            || n == "x-gitlab-webhook-token"
            || n.starts_with("x-gitlab-")
            || n == "x-bitbucket-token"
            || n.starts_with("x-bitbucket-")
            || n.starts_with("x-actions-")
            || n == "x-vault-token"
            || n.starts_with("x-vault-")
            || n.starts_with("x-kube-")
            || n.starts_with("x-helm-")
            || n.starts_with("x-docker-")
            || n.starts_with("x-registry-")
            || n.starts_with("x-containers-")
            || n.starts_with("x-ghcr-")
            || n.starts_with("x-quay-")
            || n.starts_with("x-harbor-")
            || n.starts_with("x-artifactory-")
            || n.starts_with("x-jfrog-")
            || n.starts_with("x-oci-cli-")
            || n.starts_with("x-oci-")
            || n.starts_with("x-netrc-")
            || n.starts_with("x-curl-")
            || n.starts_with("x-wget-")
            || n.starts_with("x-wgetrc-")
            || n.starts_with("x-argocd-")
            || n.starts_with("x-terraform-")
            || n.starts_with("x-pulumi-")
            || n.starts_with("x-doppler-")
            || n.starts_with("x-infisical-")
            || n.starts_with("x-op-service-")
            || n.starts_with("x-sops-")
            || n.starts_with("x-sigstore-")
            || n.starts_with("x-cosign-")
            || n == "x-k8s-aws-id"
            || n.starts_with("x-k8s-")
            || n == "ngrok-authtoken"
            || n == "x-ngrok-authtoken"
            || n.starts_with("x-ngrok-")
            || n == "x-tailscale-authkey"
            || n.starts_with("x-tailscale-")
            || n.starts_with("x-ts-")
            || n == "x-telegram-bot-api-secret-token"
            || n == "x-telegram-api-hash"
            || n.starts_with("x-telegram-")
            || n == "x-twitter-bearer-token"
            || n == "x-twitter-webhooks-signature"
            || n.starts_with("x-twitter-")
            || n == "x-facebook-signature"
            || n.starts_with("x-facebook-")
            || n == "x-whatsapp-signature"
            || n.starts_with("x-whatsapp-")
            || n.starts_with("x-instagram-")
            || n.starts_with("x-meta-")
            || n == "x-cloudflare-tunnel-token"
            || n.starts_with("x-cloudflare-tunnel-")
            || n == "x-matrix-access-token"
            || n.starts_with("x-matrix-")
            || n == "x-discord-token"
            || n.starts_with("x-discord-")
            || n == "x-signature-ed25519"
            || n == "x-signature-timestamp"
            || n == "x-hub-signature"
            || n == "x-hub-signature-256"
            || n.starts_with("x-webhook-")
            || n == "x-gitea-signature"
            || n.starts_with("x-gitea-")
            || n == "x-gogs-signature"
            || n.starts_with("x-gogs-")
            || n == "x-stripe-signature"
            || n.starts_with("x-stripe-")
            || n == "x-twilio-signature"
            || n.starts_with("x-twilio-")
            || n.starts_with("x-signal-")
            || n == "x-line-signature"
            || n.starts_with("x-line-")
            || n == "x-shopify-hmac-sha256"
            || n.starts_with("x-shopify-")
            || n == "x-slack-signature"
            || n == "x-slack-request-timestamp"
            || n == "x-request-timestamp"
            || n.starts_with("x-request-timestamp-")
            || n.starts_with("x-slack-")
            || n == "x-ci-job-token"
            || n.starts_with("x-ci-")
            || n == "x-circleci-token"
            || n.starts_with("x-circleci-")
            || n.starts_with("x-buildkite-")
            || n.starts_with("x-drone-")
            || n.starts_with("x-jenkins-")
            || n.starts_with("x-codecov-")
            || n.starts_with("x-sonar-")
            || n.starts_with("x-git-")
            || n.starts_with("x-ssh-")
            || n.starts_with("x-npm-config-")
            || n.starts_with("x-npm-")
            || n.starts_with("x-node-auth-")
            || n.starts_with("x-yarn-")
            || n.starts_with("x-pnpm-")
            || n.starts_with("x-pip-")
            || n.starts_with("x-uv-")
            || n.starts_with("x-poetry-")
            || n.starts_with("x-bundle-")
            || n.starts_with("x-cargo-")
            || n.starts_with("x-rustup-")
            || n.starts_with("x-gem-")
            || n.starts_with("x-bun-")
            || n.starts_with("x-pypi-")
            || n.starts_with("x-twine-")
            || n.starts_with("x-rubygems-")
            || n.starts_with("x-nuget-")
            || n.starts_with("x-fastly-")
            || n.starts_with("x-akamai-")
            || n.starts_with("x-netlify-")
            || n.starts_with("x-vercel-")
            || n.starts_with("x-render-")
            || n.starts_with("x-railway-")
            || n.starts_with("x-heroku-")
            || n.starts_with("x-fly-")
            || n.starts_with("x-digitalocean-")
            || n.starts_with("x-linode-")
            || n.starts_with("x-hcloud-")
            || n.starts_with("x-vultr-")
            || n.starts_with("x-scw-")
            || n == "x-access-token"
            || n == "x-session-token"
            || n == "x-id-token"
            || n == "x-amz-security-token"
            || n.starts_with("x-aws-")
            || n == "x-aws-ec2-metadata-token"
            || n == "x-aws-ec2-metadata-token-ttl-seconds"
            || n.starts_with("x-azure-")
            || n.starts_with("x-arm-")
            || n.starts_with("x-google-")
            || n.starts_with("x-gcp-")
            || n.starts_with("x-cloudsdk-")
            || n.starts_with("x-msi-")
            || n.starts_with("x-imds-")
            || n.starts_with("x-identity-")
            || n == "metadata-flavor"
            || n == "x-google-metadata-request"
            || n == "cf-access-client-id"
            || n == "cf-access-client-secret"
            || n.starts_with("cf-access-client-")
            || n.starts_with("x-cf-access-client-")
            || n.starts_with("cf-access-")
            || n.starts_with("x-cf-access-")
            || n.starts_with("x-cf-api-")
            || n.starts_with("x-cloudflare-api-")
            || n == "x-database-url"
            || n.starts_with("x-database-")
            || n.starts_with("x-dsn-")
            || n == "x-redis-url"
            || n.starts_with("x-redis-")
            || n == "x-mongodb-uri"
            || n.starts_with("x-mongodb-")
            || n == "x-postgres-url"
            || n.starts_with("x-postgres-")
            || n == "x-mysql-url"
            || n.starts_with("x-mysql-")
            || n == "x-broker-url"
            || n.starts_with("x-broker-")
            || n == "x-amqp-url"
            || n.starts_with("x-amqp-")
            || n.starts_with("x-kafka-")
            || n.starts_with("x-nats-")
            || n.starts_with("x-rabbitmq-")
            || n.starts_with("x-redpanda-")
            || n == "x-sqlite-url"
            || n == "x-sqlite-path"
            || n == "x-sqlite-file"
            || n == "x-sqlite-tmpdir"
            || n == "x-sqlite-history"
            || n.starts_with("x-sqlite-")
            || n == "x-sqlcipher-key"
            || n.starts_with("x-sqlcipher-")
            || n == "x-libsql-auth-token"
            || n.starts_with("x-libsql-")
            || n.starts_with("x-neon-")
            || n.starts_with("x-planetscale-")
            || n.starts_with("x-upstash-")
            || n == "x-turso-auth-token"
            || n.starts_with("x-turso-")
            || n == "x-pglite-data-dir"
            || n == "x-pglite-db-path"
            || n == "x-pglite-opfs-path"
            || n.starts_with("x-pglite-")
            || n == "x-opfs-path"
            || n == "x-opfs-root"
            || n.starts_with("x-opfs-")
            || n == "cf-access-jwt-assertion"
            || n == "x-goog-iap-jwt-assertion"
            || n.starts_with("x-assertion-")
            || n == "x-goog-authenticated-user-email"
            || n == "x-goog-authenticated-user-id"
            || n.starts_with("x-goog-authenticated-user-")
            || n.starts_with("x-supabase-")
            || n.starts_with("x-metabase-")
            || n == "x-google-authenticated-user-email"
            || n == "x-google-authenticated-user-id"
            || n.starts_with("x-google-authenticated-user-")
            || n == "x-userinfo"
            || n.starts_with("x-userinfo-")
            || n == "x-amzn-oidc-data"
            || n == "x-amzn-oidc-identity"
            || n == "x-amzn-oidc-accesstoken"
            || n.starts_with("x-amzn-oidc-")
            || n.starts_with("x-oidc-")
            || n == "x-forwarded-user"
            || n == "x-forwarded-user-id"
            || n == "x-forwarded-userid"
            || n == "x-forwarded-user-email"
            || n.starts_with("x-forwarded-user-")
            || n == "x-forwarded-groups"
            || n == "x-remote-user"
            || n == "x-remote-userid"
            || n.starts_with("x-remote-user-")
            || n == "x-remote-email"
            || n == "x-remote-groups"
            || n == "x-original-user"
            || n == "x-original-groups"
            || n == "x-auth-user"
            || n == "x-auth-userid"
            || n.starts_with("x-auth-user-")
            || n == "x-auth-email"
            || n == "x-auth-request-user"
            || n == "x-auth-request-user-id"
            || n == "x-auth-request-uid"
            || n == "x-auth-request-name"
            || n == "x-auth-request-email"
            || n == "x-auth-request-preferred-username"
            || n == "x-auth-request-groups"
            || n == "x-auth-request-access-token"
            || n.starts_with("x-auth-request-")
            || n == "impersonate-user"
            || n == "impersonate-group"
            || n == "impersonate-uid"
            || n.starts_with("impersonate-extra-")
            || n == "x-forwarded-email"
            || n == "x-forwarded-access-token"
            || n == "cf-access-authenticated-user-email"
            || n == "cf-access-authenticated-user-id"
            || n.starts_with("cf-access-authenticated-user-")
            || n == "x-authenticated-userid"
            || n == "x-authenticated-user-id"
            || n == "x-authenticated-user"
            || n == "x-authenticated-user-name"
            || n.starts_with("x-authenticated-user-")
            || n == "x-authenticated-user-email"
            || n == "x-authenticated-email"
            || n == "x-authenticated-groups"
            || n.starts_with("x-session-")
            || n == "x-verified-user"
            || n == "x-verified-email"
            || n.starts_with("x-verified-")
            || n == "x-end-user"
            || n == "x-end-userid"
            || n.starts_with("x-end-user-")
            || n == "x-end-user-email"
            || n == "x-user-id"
            || n == "x-userid"
            || n == "x-user"
            || n == "x-user-name"
            || n == "x-user-email"
            || n.starts_with("x-user-")
            || n == "x-user-groups"
            || n == "x-principal"
            || n == "x-principal-id"
            || n == "x-principal-name"
            || n.starts_with("x-principal-")
            || n == "x-gitlab-user-id"
            || n == "x-gitlab-username"
            || n == "x-gitlab-user-login"
            || n == "x-gitlab-user-email"
            || n.starts_with("x-gitlab-user-")
            || n == "x-github-user-id"
            || n == "x-github-login"
            || n == "x-github-user-email"
            || n.starts_with("x-github-user-")
            || n == "x-bitbucket-user"
            || n == "x-bitbucket-uuid"
            || n == "x-bitbucket-user-email"
            || n.starts_with("x-bitbucket-user-")
            || n == "x-ms-client-principal"
            || n == "x-ms-client-principal-id"
            || n == "x-ms-client-principal-name"
            || n == "metadata"
            || n == "x-identity-header"
            || n == "x-msi-secret"
            || n == "x-ms-client-principal-idp"
            || n.starts_with("x-ms-client-principal-")
            || n.starts_with("x-client-principal-")
            || n == "x-ms-token-aad-id-token"
            || n == "x-ms-token-aad-access-token"
            || n == "x-ms-token-aad-refresh-token"
            || n == "x-ms-token-aad-expires-on"
            || n.starts_with("x-ms-token-aad-")
            || n == "x-client-verify"
            || n == "x-client-dn"
            || n == "x-client-cert-chain"
            || n.starts_with("x-certificate-")
            || n.starts_with("x-private-key-")
            || n == "x-ssl-client-verify"
            || n == "x-ssl-client-dn"
            || n == "x-ssl-client-s-dn"
            || n == "x-ssl-client-i-dn"
            || n == "x-ssl-client-san"
            || n == "cookie"
            || n == "set-cookie"
            || n == "host"
            || n == "content-length"
            || n == "transfer-encoding"
            || n == "connection"
            || n == "forwarded"
            || n == "via"
            || n == "x-forwarded-for"
            || n == "x-forwarded-host"
            || n == "x-forwarded-proto"
            || n.starts_with("x-forwarded-")
            || n == "x-forwarded-protocol"
            || n == "x-forwarded-scheme"
            || n == "x-forwarded-ssl"
            || n == "x-url-scheme"
            || n.starts_with("x-url-scheme-")
            || n.starts_with("x-tls-insecure-")
            || n.starts_with("x-insecure-")
            || n.starts_with("x-verify-ssl-")
            || n.starts_with("x-ssl-verify-")
            || n == "x-forwarded-port"
            || n == "x-forwarded-server"
            || n == "x-forwarded-prefix"
            || n == "x-original-forwarded-host"
            || n == "x-original-forwarded-proto"
            || n == "x-original-forwarded-protocol"
            || n.starts_with("x-original-")
            || n == "x-original-forwarded-scheme"
            || n == "x-original-forwarded-port"
            || n == "x-original-forwarded-prefix"
            || n == "x-original-forwarded-server"
            || n == "x-original-host"
            || n == "x-host"
            || n == "front-end-https"
            || n == "x-real-ip"
            || n == "x-forwarded-client-ip"
            || n == "x-original-forwarded-for"
            || n == "x-cluster-client-ip"
            || n == "x-envoy-external-address"
            || n == "x-envoy-peer-metadata"
            || n == "x-envoy-peer-metadata-id"
            || n.starts_with("x-envoy-")
            || n == "fastly-client-ip"
            || n == "x-forwarded-client-cert"
            || n == "x-forwardedclientcert"
            || n == "x-client-cert"
            || n == "x-clientcert"
            || n.starts_with("x-client-")
            || n == "x-ssl-client-cert"
            || n == "x-sslclientcert"
            || n.starts_with("x-ssl-client-")
            || n == "x-arr-clientcert"
            || n == "ssl-client-cert"
            || n == "x-http-method-override"
            || n.starts_with("x-http-method-")
            || n == "x-method-override"
            || n.starts_with("x-method-override-")
            || n == "x-forwarded-method"
            || n.starts_with("x-forwarded-method-")
            || n == "x-original-method"
            || n.starts_with("x-original-method-")
            || n == "x-http-method"
            || n == "x-original-url"
            || n == "x-original-uri"
            || n == "x-original-path"
            || n == "x-forwarded-uri"
            || n == "x-rewrite-url"
            || n == "x-rewrite-uri"
            || n.starts_with("x-rewrite-")
            || n == "x-envoy-original-path"
            || n == "x-envoy-original-url"
            || n == "x-client-ip"
            || n == "true-client-ip"
            || n == "cf-connecting-ip"
            || n == "proxy-authorization"
            || n == "proxy-authenticate"
            || n == "proxy-authentication-info"
            || n.starts_with("proxy-")
            || n == "proxy-status"
            || n == "authentication-info"
            || n == "proxy-connection"
            || n == "te"
            || n == "trailer"
            || n == "upgrade"
            || n == "keep-alive"
            || !is_safe_header_name(trimmed_name)
            || !is_safe_header_value(value)
        {
            continue;
        }

        let pair_bytes = trimmed_name.len().saturating_add(value.len());
        if pair_bytes > MAX_HEADER_PAIR_BYTES {
            continue;
        }
        if !seen_names.insert(n) {
            continue;
        }
        let next_total = total_bytes.saturating_add(pair_bytes);
        if next_total > MAX_HEADER_TOTAL_BYTES {
            continue;
        }
        total_bytes = next_total;
        out.push((trimmed_name, value.as_str()));
    }

    out
}

fn is_safe_header_name(name: &str) -> bool {
    let trimmed = name.trim();
    const MAX_HEADER_NAME_LEN: usize = 128;
    !trimmed.is_empty()
        && trimmed.len() <= MAX_HEADER_NAME_LEN
        && trimmed
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"!#$%&'*+-.^_`|~".contains(&b))
}

fn is_safe_header_value(value: &str) -> bool {
    const MAX_HEADER_VALUE_LEN: usize = 16 * 1024;
    value.len() <= MAX_HEADER_VALUE_LEN
        && value.is_ascii()
        && value.trim() == value
        && !value.chars().any(|c| c.is_control())
}

fn join_base_url_and_path(base_url: &str, path: &str) -> String {
    let left = base_url.trim().trim_end_matches('/');
    let right = path.trim();
    if right.starts_with('/') {
        format!("{left}{right}")
    } else {
        format!("{left}/{right}")
    }
}

fn read_response_bytes(resp: ureq::Response) -> Result<Vec<u8>, String> {
    const MAX_LLM_RESPONSE_BODY_LEN: usize = 2 * 1024 * 1024;
    let reader = resp.into_reader();
    read_limited_bytes(reader, MAX_LLM_RESPONSE_BODY_LEN, "llm-bridge response body")
}

fn read_limited_bytes(
    mut reader: impl std::io::Read,
    max_len: usize,
    label: &str,
) -> Result<Vec<u8>, String> {
    let mut out = Vec::new();
    (&mut reader)
        .take(max_len as u64 + 1)
        .read_to_end(&mut out)
        .map_err(|e| format!("response read: {e}"))?;
    if out.len() > max_len {
        return Err(format!("{label} too large"));
    }
    Ok(out)
}

#[cfg(test)]
#[path = "../wasi_bridge_tests.rs"]
mod tests;
