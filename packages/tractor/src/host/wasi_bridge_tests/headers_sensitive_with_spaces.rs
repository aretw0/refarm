    #[test]
    fn sanitized_headers_drop_sensitive_auth_keys_with_surrounding_spaces() {
        let headers = vec![
            (" content-type ".to_string(), "application/json".to_string()),
            (" authorization ".to_string(), "Bearer fake".to_string()),
            (" x-authorization ".to_string(), "Bearer fake".to_string()),
            (
                " x-authorization-header ".to_string(),
                "Bearer fake".to_string(),
            ),
            (" authentication ".to_string(), "Bearer fake".to_string()),
            (" x-api-key ".to_string(), "fake-key".to_string()),
            (" x-api-token ".to_string(), "fake-key".to_string()),
            (" x-api-secret ".to_string(), "fake-key".to_string()),
            (" x-auth-secret ".to_string(), "fake-key".to_string()),
            (
                " x-auth-header ".to_string(),
                "Bearer fake".to_string(),
            ),
            (" x-webhook-secret ".to_string(), "fake-key".to_string()),
            (" x-bearer-token ".to_string(), "fake-key".to_string()),
            (" x-token-path ".to_string(), "/tmp/evil-token".to_string()),
            (" x-secret-key ".to_string(), "secret-key-evil".to_string()),
            (
                " x-access-key-id ".to_string(),
                "access-key-id-evil".to_string(),
            ),
            (
                " x-accesskey-id ".to_string(),
                "access-key-id-evil".to_string(),
            ),
            (
                " x-signing-key-id ".to_string(),
                "signing-key-id-evil".to_string(),
            ),
            (
                " x-signingkey-id ".to_string(),
                "signing-key-id-evil".to_string(),
            ),
            (
                " x-credential-file ".to_string(),
                "/tmp/evil-credentials.json".to_string(),
            ),
            (
                " x-credentialfile-path ".to_string(),
                "/tmp/evil-credentials.json".to_string(),
            ),
            (
                " x-credentials-path ".to_string(),
                "/tmp/evil-credentials.json".to_string(),
            ),
            (
                " x-credentialsfile-path ".to_string(),
                "/tmp/evil-credentials.json".to_string(),
            ),
            (
                " x-key-file-path ".to_string(),
                "/tmp/evil-private.key".to_string(),
            ),
            (
                " x-keyfile-path ".to_string(),
                "/tmp/evil-private.key".to_string(),
            ),
            (
                " x-token-file-path ".to_string(),
                "/tmp/evil-token.txt".to_string(),
            ),
            (
                " x-tokenfile-path ".to_string(),
                "/tmp/evil-token.txt".to_string(),
            ),
            (
                " x-password-hint ".to_string(),
                "password-hint-evil".to_string(),
            ),
            (
                " x-cookie-name ".to_string(),
                "session".to_string(),
            ),
            (
                " x-proxy-url-primary ".to_string(),
                "http://127.0.0.1:9999".to_string(),
            ),
            (
                " x-proxyurl ".to_string(),
                "http://127.0.0.1:9999".to_string(),
            ),
            (
                " x-no-proxy-list ".to_string(),
                "localhost,127.0.0.1".to_string(),
            ),
            (
                " x-noproxy ".to_string(),
                "localhost,127.0.0.1".to_string(),
            ),
            (
                " x-ca-bundle-path ".to_string(),
                "/tmp/evil-ca.pem".to_string(),
            ),
            (" x-cabundle ".to_string(), "/tmp/evil-ca.pem".to_string()),
            (
                " x-ca-file-path ".to_string(),
                "/tmp/evil-ca-file.pem".to_string(),
            ),
            (
                " x-cafile ".to_string(),
                "/tmp/evil-ca-file.pem".to_string(),
            ),
            (
                " x-ca-path-dir ".to_string(),
                "/tmp/evil-ca-dir".to_string(),
            ),
            (" x-capath ".to_string(), "/tmp/evil-ca-dir".to_string()),
            (
                " x-jwt-assertion ".to_string(),
                "eyJhbGciOiJIUzI1NiJ9.evil.jwt".to_string(),
            ),
            (
                " x-sock-path ".to_string(),
                "/tmp/evil-service.sock".to_string(),
            ),
            (
                " x-socket-path ".to_string(),
                "/tmp/evil-service.socket".to_string(),
            ),
            (" api-key ".to_string(), "fake-key".to_string()),
            (" x-auth-token ".to_string(), "fake-key".to_string()),
            (
                " x-authentication-token ".to_string(),
                "fake-key".to_string(),
            ),
            (" x-github-token ".to_string(), "fake-key".to_string()),
            (
                " x-github-run-id ".to_string(),
                "123456789".to_string(),
            ),
            (" x-gitlab-token ".to_string(), "fake-key".to_string()),
            (
                " x-gitlab-project-id ".to_string(),
                "999999".to_string(),
            ),
            (" x-bitbucket-token ".to_string(), "fake-key".to_string()),
            (
                " x-bitbucket-workspace ".to_string(),
                "evil-workspace".to_string(),
            ),
            (
                " x-actions-runtime-url ".to_string(),
                "https://actions.evil".to_string(),
            ),
            (
                " x-cf-api-base-url ".to_string(),
                "https://api.cloudflare.evil".to_string(),
            ),
            (
                " x-cloudflare-api-base-url ".to_string(),
                "https://api.cloudflare.evil".to_string(),
            ),
            (
                " x-fastly-service-id ".to_string(),
                "fastly-service-evil".to_string(),
            ),
            (" x-akamai-host ".to_string(), "akamai.evil".to_string()),
            (
                " x-netlify-site-id ".to_string(),
                "netlify-site-evil".to_string(),
            ),
            (
                " x-vercel-project-id ".to_string(),
                "vercel-project-evil".to_string(),
            ),
            (
                " x-render-service-id ".to_string(),
                "render-service-evil".to_string(),
            ),
            (
                " x-railway-project-id ".to_string(),
                "railway-project-evil".to_string(),
            ),
            (
                " x-heroku-app-name ".to_string(),
                "heroku-app-evil".to_string(),
            ),
            (" x-fly-app-name ".to_string(), "fly-app-evil".to_string()),
            (
                " x-digitalocean-project-id ".to_string(),
                "do-project-evil".to_string(),
            ),
            (
                " x-linode-region ".to_string(),
                "linode-region-evil".to_string(),
            ),
            (" x-hcloud-project ".to_string(), "hcloud-evil".to_string()),
            (" x-vultr-region ".to_string(), "vultr-evil".to_string()),
            (" x-scw-default-region ".to_string(), "scw-evil".to_string()),
            (" x-vault-token ".to_string(), "fake-key".to_string()),
            (" x-vault-namespace ".to_string(), "ns-evil".to_string()),
            (
                " x-oci-cli-security-token-file ".to_string(),
                "/tmp/oci-token".to_string(),
            ),
            (
                " x-oci-region ".to_string(),
                "sa-saopaulo-1".to_string(),
            ),
            (
                " x-netrc-machine ".to_string(),
                "evil-machine".to_string(),
            ),
            (
                " x-curl-ssl-backend ".to_string(),
                "openssl".to_string(),
            ),
            (" x-wget-user ".to_string(), "evil-user".to_string()),
            (
                " x-wgetrc-path ".to_string(),
                "/tmp/evil-wgetrc".to_string(),
            ),
            (" x-kube-token ".to_string(), "kube-token-evil".to_string()),
            (
                " x-helm-kubetoken ".to_string(),
                "helm-token-evil".to_string(),
            ),
            (
                " x-docker-config ".to_string(),
                "docker-config-evil".to_string(),
            ),
            (
                " x-registry-auth ".to_string(),
                "registry-auth-evil".to_string(),
            ),
            (
                " x-containers-auth-file ".to_string(),
                "/tmp/containers-auth-evil".to_string(),
            ),
            (" x-ghcr-token ".to_string(), "ghcr-token-evil".to_string()),
            (" x-quay-token ".to_string(), "quay-token-evil".to_string()),
            (
                " x-harbor-password ".to_string(),
                "harbor-pass-evil".to_string(),
            ),
            (
                " x-artifactory-api-key ".to_string(),
                "artifactory-key-evil".to_string(),
            ),
            (
                " x-jfrog-access-token ".to_string(),
                "jfrog-token-evil".to_string(),
            ),
            (
                " x-argocd-auth-token ".to_string(),
                "argocd-token-evil".to_string(),
            ),
            (
                " x-terraform-token ".to_string(),
                "terraform-token-evil".to_string(),
            ),
            (
                " x-pulumi-access-token ".to_string(),
                "pulumi-token-evil".to_string(),
            ),
            (
                " x-doppler-token ".to_string(),
                "doppler-token-evil".to_string(),
            ),
            (
                " x-infisical-token ".to_string(),
                "infisical-token-evil".to_string(),
            ),
            (
                " x-op-service-account-token ".to_string(),
                "op-service-token-evil".to_string(),
            ),
            (
                " x-sops-age-key ".to_string(),
                "age1evilrecipient".to_string(),
            ),
            (
                " x-sigstore-id-token ".to_string(),
                "sigstore-token-evil".to_string(),
            ),
            (
                " x-cosign-password ".to_string(),
                "cosign-password-evil".to_string(),
            ),
            (" x-ci-job-token ".to_string(), "fake-key".to_string()),
            (" x-ci-workflow-id ".to_string(), "wf-evil".to_string()),
            (" x-circleci-token ".to_string(), "fake-key".to_string()),
            (
                " x-circleci-workflow-id ".to_string(),
                "circle-wf-evil".to_string(),
            ),
            (
                " x-buildkite-agent-token ".to_string(),
                "buildkite-token-evil".to_string(),
            ),
            (" x-drone-token ".to_string(), "drone-token-evil".to_string()),
            (
                " x-jenkins-token ".to_string(),
                "jenkins-token-evil".to_string(),
            ),
            (
                " x-codecov-token ".to_string(),
                "codecov-token-evil".to_string(),
            ),
            (" x-sonar-token ".to_string(), "sonar-token-evil".to_string()),
            (
                " x-git-config-count ".to_string(),
                "1".to_string(),
            ),
            (
                " x-ssh-known-hosts ".to_string(),
                "/tmp/known_hosts".to_string(),
            ),
            (
                " x-npm-config-userconfig ".to_string(),
                "/tmp/.npmrc".to_string(),
            ),
            (
                " x-npm-registry-url ".to_string(),
                "https://registry.npmjs.org".to_string(),
            ),
            (
                " x-node-auth-token-file ".to_string(),
                "/tmp/node-auth-token".to_string(),
            ),
            (
                " x-yarn-npm-registry-server ".to_string(),
                "https://registry.yarnpkg.com".to_string(),
            ),
            (
                " x-pnpm-store-path ".to_string(),
                "/tmp/pnpm-store".to_string(),
            ),
            (
                " x-pip-index-url ".to_string(),
                "https://evil.example/simple".to_string(),
            ),
            (
                " x-uv-cache-dir ".to_string(),
                "/tmp/uv-cache".to_string(),
            ),
            (
                " x-poetry-virtualenvs-path ".to_string(),
                "/tmp/poetry-venv".to_string(),
            ),
            (
                " x-bundle-path ".to_string(),
                "/tmp/bundle-path".to_string(),
            ),
            (
                " x-cargo-registries-crates-io-token ".to_string(),
                "cargo-crates-token-evil".to_string(),
            ),
            (
                " x-rustup-toolchain ".to_string(),
                "nightly-evil".to_string(),
            ),
            (
                " x-gem-host-api-key ".to_string(),
                "gem-host-api-key-evil".to_string(),
            ),
            (
                " x-bun-registry ".to_string(),
                "https://registry.bun.sh".to_string(),
            ),
            (
                " x-pypi-repository ".to_string(),
                "https://upload.pypi.org/legacy".to_string(),
            ),
            (
                " x-twine-repository-url ".to_string(),
                "https://upload.pypi.org/legacy".to_string(),
            ),
            (
                " x-rubygems-host ".to_string(),
                "https://rubygems.org".to_string(),
            ),
            (
                " x-nuget-source ".to_string(),
                "https://api.nuget.org/v3/index.json".to_string(),
            ),
            (" x-access-token ".to_string(), "fake-key".to_string()),
            (" x-session-token ".to_string(), "fake-key".to_string()),
            (" x-id-token ".to_string(), "fake-key".to_string()),
            (" x-amz-security-token ".to_string(), "fake-key".to_string()),
            (" x-aws-region ".to_string(), "us-east-1".to_string()),
            (
                " x-azure-cloud-name ".to_string(),
                "AzurePublicCloud".to_string(),
            ),
            (" x-arm-environment ".to_string(), "public".to_string()),
            (
                " x-google-cloud-region ".to_string(),
                "us-central1".to_string(),
            ),
            (
                " x-gcp-project-number ".to_string(),
                "123456789".to_string(),
            ),
            (
                " x-cloudsdk-active-config-name ".to_string(),
                "evil-config".to_string(),
            ),
            (
                " x-msi-client-id ".to_string(),
                "msi-client-id-evil".to_string(),
            ),
            (" x-imds-port ".to_string(), "1338".to_string()),
            (
                " x-identity-header-file ".to_string(),
                "/tmp/identity-header".to_string(),
            ),
            (" x-ms-client-principal ".to_string(), "jwt".to_string()),
            (" x-ms-client-principal-id ".to_string(), "alice".to_string()),
            (" x-client-principal-id ".to_string(), "alice".to_string()),
            (
                " x-ms-client-principal-name ".to_string(),
                "alice".to_string(),
            ),
            (" x-ms-client-principal-idp ".to_string(), "aad".to_string()),
            (" x-ms-token-aad-id-token ".to_string(), "jwt".to_string()),
            (" x-ms-token-aad-access-token ".to_string(), "jwt".to_string()),
            (" x-ms-token-aad-refresh-token ".to_string(), "jwt".to_string()),
            (" x-ms-token-aad-expires-on ".to_string(), "1700000000".to_string()),
            (
                " x-certificate-chain ".to_string(),
                "-----BEGIN CERTIFICATE-----evil".to_string(),
            ),
            (
                " x-private-key-path ".to_string(),
                "/tmp/evil-private-key.pem".to_string(),
            ),
            (
                " x-privatekey-path ".to_string(),
                "/tmp/evil-private-key.pem".to_string(),
            ),
            (" cf-access-jwt-assertion ".to_string(), "jwt".to_string()),
            (" x-goog-iap-jwt-assertion ".to_string(), "jwt".to_string()),
            (
                " x-goog-authenticated-user-email ".to_string(),
                "accounts.google.com:alice@example.com".to_string(),
            ),
            (
                " x-goog-authenticated-user-id ".to_string(),
                "accounts.google.com:123".to_string(),
            ),
            (
                " x-google-authenticated-user-email ".to_string(),
                "accounts.google.com:alice@example.com".to_string(),
            ),
            (
                " x-google-authenticated-user-id ".to_string(),
                "accounts.google.com:123".to_string(),
            ),
            (" x-amzn-oidc-data ".to_string(), "jwt".to_string()),
            (" x-amzn-oidc-identity ".to_string(), "sub".to_string()),
            (" x-amzn-oidc-accesstoken ".to_string(), "jwt".to_string()),
            (" x-oidc-issuer ".to_string(), "https://issuer.evil".to_string()),
            (" x-forwarded-user ".to_string(), "alice".to_string()),
            (" x-forwarded-user-id ".to_string(), "alice-id".to_string()),
            (" x-forwarded-userid ".to_string(), "alice-id".to_string()),
            (
                " x-forwarded-user-email ".to_string(),
                "alice@example.com".to_string(),
            ),
            (" x-forwarded-groups ".to_string(), "admins".to_string()),
            (" x-remote-user ".to_string(), "alice".to_string()),
            (" x-remote-userid ".to_string(), "alice-id".to_string()),
            (
                " x-remote-email ".to_string(),
                "alice@example.com".to_string(),
            ),
            (" x-remote-groups ".to_string(), "admins".to_string()),
            (" x-original-user ".to_string(), "alice".to_string()),
            (" x-original-groups ".to_string(), "admins".to_string()),
            (" x-auth-user ".to_string(), "alice".to_string()),
            (" x-auth-userid ".to_string(), "alice-id".to_string()),
            (" x-auth-email ".to_string(), "alice@example.com".to_string()),
            (" x-auth-request-user ".to_string(), "alice".to_string()),
            (
                " x-auth-request-user-id ".to_string(),
                "alice-id".to_string(),
            ),
            (" x-auth-request-uid ".to_string(), "123".to_string()),
            (" x-auth-request-name ".to_string(), "alice".to_string()),
            (
                " x-auth-request-email ".to_string(),
                "alice@example.com".to_string(),
            ),
            (
                " x-auth-request-preferred-username ".to_string(),
                "alice".to_string(),
            ),
            (" x-auth-request-groups ".to_string(), "admins".to_string()),
            (" impersonate-user ".to_string(), "alice".to_string()),
            (" impersonate-group ".to_string(), "admins".to_string()),
            (" impersonate-uid ".to_string(), "123".to_string()),
            (
                " impersonate-extra-scopes ".to_string(),
                "view,edit".to_string(),
            ),
            (
                " x-auth-request-access-token ".to_string(),
                "jwt".to_string(),
            ),
            (" x-forwarded-email ".to_string(), "alice@example.com".to_string()),
            (" x-forwarded-access-token ".to_string(), "jwt".to_string()),
            (
                " cf-access-authenticated-user-email ".to_string(),
                "alice@example.com".to_string(),
            ),
            (" cf-access-authenticated-user-id ".to_string(), "123".to_string()),
            (" x-authenticated-userid ".to_string(), "alice".to_string()),
            (" x-authenticated-user-id ".to_string(), "alice".to_string()),
            (" x-authenticated-user ".to_string(), "alice".to_string()),
            (" x-authenticated-user-name ".to_string(), "alice".to_string()),
            (" x-authenticated-user-email ".to_string(), "alice@example.com".to_string()),
            (" x-authenticated-email ".to_string(), "alice@example.com".to_string()),
            (" x-session-id ".to_string(), "session-id-evil".to_string()),
            (" x-authenticated-groups ".to_string(), "admins".to_string()),
            (" x-verified-user ".to_string(), "alice".to_string()),
            (" x-verified-email ".to_string(), "alice@example.com".to_string()),
            (" x-end-user ".to_string(), "alice".to_string()),
            (" x-end-userid ".to_string(), "alice-id".to_string()),
            (" x-end-user-email ".to_string(), "alice@example.com".to_string()),
            (" x-user-id ".to_string(), "alice".to_string()),
            (" x-userid ".to_string(), "alice-id".to_string()),
            (" x-user ".to_string(), "alice".to_string()),
            (" x-user-name ".to_string(), "alice".to_string()),
            (" x-user-email ".to_string(), "alice@example.com".to_string()),
            (" x-user-groups ".to_string(), "admins".to_string()),
            (" x-principal ".to_string(), "alice".to_string()),
            (" x-principal-id ".to_string(), "alice-id".to_string()),
            (" x-principal-name ".to_string(), "alice".to_string()),
            (" x-gitlab-user-id ".to_string(), "123".to_string()),
            (" x-gitlab-username ".to_string(), "alice".to_string()),
            (" x-gitlab-user-login ".to_string(), "alice".to_string()),
            (" x-gitlab-user-name ".to_string(), "alice".to_string()),
            (
                " x-gitlab-user-email ".to_string(),
                "alice@example.com".to_string(),
            ),
            (" x-github-user-id ".to_string(), "123".to_string()),
            (" x-github-login ".to_string(), "alice".to_string()),
            (" x-github-user-name ".to_string(), "alice".to_string()),
            (
                " x-github-user-email ".to_string(),
                "alice@example.com".to_string(),
            ),
            (" x-bitbucket-user ".to_string(), "alice".to_string()),
            (" x-bitbucket-user-login ".to_string(), "alice".to_string()),
            (" x-bitbucket-uuid ".to_string(), "uuid-123".to_string()),
            (
                " x-bitbucket-user-email ".to_string(),
                "alice@example.com".to_string(),
            ),
            (" x-client-verify ".to_string(), "SUCCESS".to_string()),
            (" x-clientverify ".to_string(), "SUCCESS".to_string()),
            (" x-client-dn ".to_string(), "CN=alice".to_string()),
            (" x-clientdn ".to_string(), "CN=alice".to_string()),
            (" x-client-san ".to_string(), "DNS:alice".to_string()),
            (" x-clientsan ".to_string(), "DNS:alice".to_string()),
            (
                " x-client-cert-chain ".to_string(),
                "-----BEGIN CERTIFICATE-----...".to_string(),
            ),
            (
                " x-clientcertchain ".to_string(),
                "-----BEGIN CERTIFICATE-----...".to_string(),
            ),
            (" x-ssl-client-verify ".to_string(), "SUCCESS".to_string()),
            (" x-sslclientverify ".to_string(), "SUCCESS".to_string()),
            (" x-ssl-client-dn ".to_string(), "CN=alice".to_string()),
            (" x-sslclientdn ".to_string(), "CN=alice".to_string()),
            (" x-ssl-client-s-dn ".to_string(), "CN=alice".to_string()),
            (" x-sslclientsdn ".to_string(), "CN=alice".to_string()),
            (" x-ssl-client-i-dn ".to_string(), "CN=Refarm CA".to_string()),
            (" x-sslclientidn ".to_string(), "CN=Refarm CA".to_string()),
            (" x-ssl-client-san ".to_string(), "DNS:alice".to_string()),
            (" x-sslclientsan ".to_string(), "DNS:alice".to_string()),
            (" cookie ".to_string(), "session=abc".to_string()),
            (" set-cookie ".to_string(), "session=abc".to_string()),
        ];
        let out = sanitized_plugin_headers(&headers);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].0, "content-type");
    }

