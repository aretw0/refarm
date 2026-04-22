    use super::*;
    use crate::{NativeStorage, NativeSync, TelemetryBus};
    use crate::host::plugin_host::refarm::plugin::{
        agent_fs::Host as AgentFsHost,
        agent_shell::{Host as AgentShellHost, SpawnRequest},
    };

    fn make_bindings() -> TractorNativeBindings {
        let storage = NativeStorage::open(":memory:").unwrap();
        let sync = NativeSync::new(storage, ":memory:").unwrap();
        let telemetry = TelemetryBus::new(10);
        TractorNativeBindings::new("test-agent", sync, telemetry)
    }

    static ENV_LOCK: std::sync::LazyLock<std::sync::Mutex<()>> =
        std::sync::LazyLock::new(|| std::sync::Mutex::new(()));

    fn spawn_req(argv: &[&str]) -> SpawnRequest {
        SpawnRequest {
            argv: argv.iter().map(|s| s.to_string()).collect(),
            env: vec![],
            cwd: None,
            timeout_ms: 5000,
            stdin: None,
        }
    }

    fn configured_fs_root_err_for(raw: &str) -> String {
        let _guard = ENV_LOCK.lock().unwrap();
        let prev = std::env::var("LLM_FS_ROOT").ok();

        std::env::set_var("LLM_FS_ROOT", raw);
        let err = configured_fs_root().unwrap_err();

        if let Some(prev) = prev {
            std::env::set_var("LLM_FS_ROOT", prev);
        } else {
            std::env::remove_var("LLM_FS_ROOT");
        }

        err
    }

    // ── agent-fs ──────────────────────────────────────────────────────────────

    #[tokio::test]
    async fn read_existing_file() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("hello.txt");
        std::fs::write(&path, b"sovereign").unwrap();

        let mut b = make_bindings();
        let result = AgentFsHost::read(&mut b, path.to_string_lossy().into_owned()).await;
        assert_eq!(result.unwrap(), b"sovereign");
    }

    #[tokio::test]
    async fn read_missing_file_returns_error() {
        let mut b = make_bindings();
        let result = AgentFsHost::read(&mut b, "/nonexistent/path/file.txt".into()).await;
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("read("));
    }

    #[tokio::test]
    async fn write_creates_file_atomically() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("output.txt");

        let mut b = make_bindings();
        AgentFsHost::write(&mut b, path.to_string_lossy().into_owned(), b"hello farm".to_vec())
            .await
            .unwrap();

        assert_eq!(std::fs::read(&path).unwrap(), b"hello farm");
    }

    #[tokio::test]
    async fn write_overwrites_existing_file() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("out.txt");
        std::fs::write(&path, b"old content").unwrap();

        let mut b = make_bindings();
        AgentFsHost::write(&mut b, path.to_string_lossy().into_owned(), b"new content".to_vec())
            .await
            .unwrap();

        assert_eq!(std::fs::read(&path).unwrap(), b"new content");
    }

    #[tokio::test]
    async fn edit_applies_valid_unified_diff() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("src.txt");
        std::fs::write(&path, "line one\nline two\nline three\n").unwrap();

        let diff = "--- src.txt\n+++ src.txt\n@@ -1,3 +1,3 @@\n line one\n-line two\n+line TWO\n line three\n";

        let mut b = make_bindings();
        AgentFsHost::edit(&mut b, path.to_string_lossy().into_owned(), diff.into())
            .await
            .unwrap();

        let result = std::fs::read_to_string(&path).unwrap();
        assert!(result.contains("line TWO"));
        assert!(!result.contains("line two"));
    }

    #[tokio::test]
    async fn edit_fails_on_wrong_context() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("src.txt");
        std::fs::write(&path, "completely different content\n").unwrap();

        let diff = "--- src.txt\n+++ src.txt\n@@ -1,3 +1,3 @@\n line one\n-line two\n+line TWO\n line three\n";

        let mut b = make_bindings();
        let result = AgentFsHost::edit(&mut b, path.to_string_lossy().into_owned(), diff.into()).await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn edit_fails_on_missing_file() {
        let mut b = make_bindings();
        let result = AgentFsHost::edit(&mut b, "/no/such/file.txt".into(), "--- a\n+++ b\n".into()).await;
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("edit/read("));
    }

    // ── agent-shell ───────────────────────────────────────────────────────────

    #[tokio::test]
    async fn spawn_echo_captures_stdout() {
        let mut b = make_bindings();
        let result = AgentShellHost::spawn(&mut b, spawn_req(&["echo", "sovereign farm"])).await.unwrap();
        assert_eq!(result.exit_code, 0);
        assert!(!result.timed_out);
        assert!(String::from_utf8_lossy(&result.stdout).contains("sovereign farm"));
    }

    #[tokio::test]
    async fn spawn_exit_code_propagated() {
        let mut b = make_bindings();
        let result = AgentShellHost::spawn(&mut b, spawn_req(&["false"])).await.unwrap();
        assert_ne!(result.exit_code, 0);
        assert!(!result.timed_out);
    }

    #[tokio::test]
    async fn spawn_empty_argv_returns_error() {
        let mut b = make_bindings();
        let req = SpawnRequest { argv: vec![], env: vec![], cwd: None, timeout_ms: 1000, stdin: None };
        let result = AgentShellHost::spawn(&mut b, req).await;
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("argv must be non-empty"));
    }

    #[tokio::test]
    async fn spawn_timeout_kills_process() {
        let mut b = make_bindings();
        let req = SpawnRequest {
            argv: vec!["sleep".into(), "60".into()],
            env: vec![],
            cwd: None,
            timeout_ms: 100,
            stdin: None,
        };
        let result = AgentShellHost::spawn(&mut b, req).await.unwrap();
        assert!(result.timed_out);
        assert_eq!(result.exit_code, -1);
    }

    #[tokio::test]
    async fn spawn_stdin_piped_to_process() {
        let mut b = make_bindings();
        let req = SpawnRequest {
            argv: vec!["cat".into()],
            env: vec![],
            cwd: None,
            timeout_ms: 5000,
            stdin: Some(b"refarm".to_vec()),
        };
        let result = AgentShellHost::spawn(&mut b, req).await.unwrap();
        assert_eq!(result.exit_code, 0);
        assert_eq!(&result.stdout, b"refarm");
    }

    #[tokio::test]
    async fn spawn_rejects_overlong_stdin() {
        let argv = vec!["cat".to_string()];
        let stdin = vec![b'a'; 1024 * 1024 + 1];
        let err = spawn_process(&argv, &[], None, 1000, Some(&stdin))
            .await
            .unwrap_err();
        assert!(err.contains("stdin exceeds max length"));
    }

    #[tokio::test]
    async fn spawn_truncates_overlong_stdout() {
        let bytes = MAX_SPAWN_STDIO_LEN + 1;
        let argv = vec![
            "sh".to_string(),
            "-c".to_string(),
            format!("head -c {bytes} /dev/zero"),
        ];

        let (stdout, stderr, exit_code, timed_out) = spawn_process(&argv, &[], None, 5_000, None)
            .await
            .unwrap();

        assert_eq!(exit_code, 0);
        assert!(!timed_out);
        assert!(stderr.is_empty());
        assert!(stdout.ends_with(b"[truncated: spawn output exceeded limit]"));
    }

    #[tokio::test]
    async fn spawn_env_clear_no_ambient_env() {
        let mut b = make_bindings();
        let result = AgentShellHost::spawn(
            &mut b,
            spawn_req(&["sh", "-c", "echo ${HOME:-ABSENT}"]),
        )
        .await
        .unwrap();
        let out = String::from_utf8_lossy(&result.stdout);
        assert!(out.trim() == "ABSENT", "expected no HOME, got: {out}");
    }

    #[tokio::test]
    async fn spawn_rejects_invalid_env_key() {
        let argv = vec!["echo".to_string(), "ok".to_string()];
        let env = vec![("BAD=KEY".to_string(), "x".to_string())];
        let err = spawn_process(&argv, &env, None, 1000, None).await.unwrap_err();
        assert!(err.contains("invalid env key"));
    }

    #[tokio::test]
    async fn spawn_rejects_env_value_with_control_chars() {
        let argv = vec!["echo".to_string(), "ok".to_string()];
        let env = vec![("SAFE_KEY".to_string(), "bad\nvalue".to_string())];
        let err = spawn_process(&argv, &env, None, 1000, None).await.unwrap_err();
        assert!(err.contains("env value contains control characters"));
    }

    #[tokio::test]
    async fn spawn_rejects_env_value_with_non_ascii() {
        let argv = vec!["echo".to_string(), "ok".to_string()];
        let env = vec![("SAFE_KEY".to_string(), "olá".to_string())];
        let err = spawn_process(&argv, &env, None, 1000, None).await.unwrap_err();
        assert!(err.contains("env value must be ascii"));
    }

    #[tokio::test]
    async fn spawn_rejects_env_value_with_surrounding_whitespace() {
        let argv = vec!["echo".to_string(), "ok".to_string()];
        let env = vec![("SAFE_KEY".to_string(), " value ".to_string())];
        let err = spawn_process(&argv, &env, None, 1000, None).await.unwrap_err();
        assert!(err.contains("env value contains surrounding whitespace"));
    }

    #[tokio::test]
    async fn spawn_rejects_env_value_with_internal_whitespace() {
        let argv = vec!["echo".to_string(), "ok".to_string()];
        let env = vec![("SAFE_KEY".to_string(), "safe value".to_string())];
        let err = spawn_process(&argv, &env, None, 1000, None).await.unwrap_err();
        assert!(err.contains("env value must not contain whitespace"));
    }

    #[tokio::test]
    async fn spawn_rejects_blocked_loader_env_keys() {
        let argv = vec!["echo".to_string(), "ok".to_string()];

        let cases = [
            ("LD_PRELOAD", "evil.so"),
            ("ld_audit", "evil.so"),
            ("LD_ORIGIN_PATH", "/tmp/pwn-origin"),
            ("glibc_tunables", "glibc.malloc.check=3"),
            ("MALLOC_CHECK_", "3"),
            ("DYLD_FRAMEWORK_PATH", "/tmp/pwn-fw"),
            ("DYLD_FALLBACK_LIBRARY_PATH", "/tmp/pwn-dylib"),
            ("DYLD_VERSIONED_LIBRARY_PATH", "/tmp/pwn-versioned"),
            ("IFS", "/"),
            ("SHELLOPTS", "igncr"),
            ("BASHOPTS", "expand_aliases"),
            ("GCONV_PATH", "/tmp/gconv"),
        ];

        for (key, value) in cases {
            let result = spawn_process(
                &argv,
                &[(key.to_string(), value.to_string())],
                None,
                1000,
                None,
            )
            .await;
            let err = match result {
                Ok((stdout, stderr, status, timed_out)) => {
                    panic!(
                        "expected blocked env key for {key}, got Ok(stdout={stdout:?}, stderr={stderr:?}, status={status}, timed_out={timed_out})"
                    )
                }
                Err(err) => err,
            };
            assert!(
                err.contains("blocked env key"),
                "expected blocked env key for {key}, got: {err}"
            );
        }
    }

    #[tokio::test]
    async fn spawn_rejects_path_env_override() {
        let argv = vec!["echo".to_string(), "ok".to_string()];
        let env = vec![("PATH".to_string(), "/tmp/evil-bin".to_string())];
        let err = spawn_process(&argv, &env, None, 1000, None).await.unwrap_err();
        assert!(err.contains("blocked env key"));
    }

    #[tokio::test]
    async fn spawn_rejects_shell_startup_env_override() {
        let argv = vec!["echo".to_string(), "ok".to_string()];

        let cases = [("BASH_ENV", "/tmp/evil-rc"), ("env", "/tmp/evil-rc")];

        for (key, value) in cases {
            let result = spawn_process(
                &argv,
                &[(key.to_string(), value.to_string())],
                None,
                1000,
                None,
            )
            .await;
            let err = match result {
                Ok((stdout, stderr, status, timed_out)) => {
                    panic!(
                        "expected blocked env key for {key}, got Ok(stdout={stdout:?}, stderr={stderr:?}, status={status}, timed_out={timed_out})"
                    )
                }
                Err(err) => err,
            };
            assert!(
                err.contains("blocked env key"),
                "expected blocked env key for {key}, got: {err}"
            );
        }
    }

    #[tokio::test]
    async fn spawn_rejects_runtime_injection_env_keys() {
        let argv = vec!["echo".to_string(), "ok".to_string()];

        let cases = [
            ("NODE_OPTIONS", "--require /tmp/pwn.js"),
            ("node_path", "/tmp/pwn-node"),
            ("pythonpath", "/tmp/evil-py"),
            ("PYTHONSTARTUP", "/tmp/pwn.py"),
            ("pythonuserbase", "/tmp/pwn-py-user"),
            ("JAVA_TOOL_OPTIONS", "-javaagent:/tmp/pwn.jar"),
            ("CLASSPATH", "/tmp/pwn.jar"),
            ("RUBYLIB", "/tmp/pwn-rb"),
            ("PERL5LIB", "/tmp/pwn-pl"),
            ("gem_home", "/tmp/pwn-gem"),
            ("GEM_PATH", "/tmp/pwn-gem-path"),
            ("GEM_SPEC_CACHE", "/tmp/pwn-gem-spec-cache"),
            ("LUA_PATH", "/tmp/pwn-lua"),
            ("LUA_CPATH", "/tmp/pwn-lua-c"),
            ("SSL_CERT_FILE", "/tmp/evil-ca.pem"),
            ("ssl_cert_dir", "/tmp/evil-ca-dir"),
            ("REQUESTS_CA_BUNDLE", "/tmp/evil-requests-ca.pem"),
            ("CURL_CA_BUNDLE", "/tmp/evil-curl-ca.pem"),
            ("GIT_SSL_CAINFO", "/tmp/evil-git-ca.pem"),
            ("SERVICE_CA_BUNDLE", "/tmp/evil-service-ca.pem"),
            ("SERVICE_CA_FILE", "/tmp/evil-service-ca-file.pem"),
            ("SERVICE_CA_PATH", "/tmp/evil-service-ca-dir"),
            ("HTTP_PROXY", "http://127.0.0.1:8888"),
            ("https_proxy", "http://127.0.0.1:8888"),
            ("ALL_PROXY", "socks5://127.0.0.1:1080"),
            ("NO_PROXY", "*"),
            ("SERVICE_PROXY", "http://127.0.0.1:9999"),
            ("SERVICE_PROXY_URL", "http://127.0.0.1:9999"),
            ("SERVICE_NO_PROXY", "localhost,127.0.0.1"),
            ("SERVICE_NETRC", "/tmp/evil-service.netrc"),
            ("SERVICE_WGETRC", "/tmp/evil-service.wgetrc"),
            ("SERVICE_PROXY_AUTHORIZATION", "Basic ZXZpbA=="),
            ("SERVICE_PROXY_STATUS", "error=http_request_error"),
            ("SERVICE_UPGRADE", "websocket"),
            ("SERVICE_KEEP_ALIVE", "timeout=5"),
            ("PROXY_AUTHORIZATION", "Basic ZXZpbA=="),
            ("SERVICE_AUTH", "service-auth-evil"),
            ("SERVICE_AUTH_HEADER", "service-auth-header-evil"),
            ("SERVICE_TOKEN", "service-token-evil"),
            ("SERVICE_AUTHTOKEN", "service-authtoken-evil"),
            ("SERVICE_AUTHKEY", "service-authkey-evil"),
            ("SERVICE_API_KEY", "service-api-key-evil"),
            ("SERVICE_APIKEY", "service-apikey-evil"),
            ("SERVICE_API_HASH", "service-api-hash-evil"),
            ("SERVICE_SECRET", "service-secret-evil"),
            (
                "SERVICE_AUTHORIZATION_HEADER",
                "Bearer service-auth-header-evil",
            ),
            ("SERVICE_BEARER", "Bearer service-bearer-evil"),
            ("APP_KEY_FILE", "/tmp/evil-app.key"),
            ("APP_TOKEN_FILE", "/tmp/evil-app.token"),
            ("APP_CREDENTIAL_FILE", "/tmp/evil-credential.json"),
            ("APP_CREDENTIALS_FILE", "/tmp/evil-credentials.json"),
            ("SERVICE_SOCK", "/tmp/service.sock"),
            ("SERVICE_SOCKET", "/tmp/service.socket"),
            ("SERVICE_FORWARDED_CLIENT_CERT", "By=spiffe://edge"),
            ("SERVICE_FORWARDEDCLIENTCERT", "By=spiffe://edge"),
            ("SERVICE_CLIENT_CERT", "-----BEGIN CERT-----..."),
            ("SERVICE_CLIENTCERT", "-----BEGIN CERT-----..."),
            ("SERVICE_SSLCLIENTCERT", "-----BEGIN CERT-----..."),
            ("SERVICE_SSL_CLIENT_DN", "CN=alice"),
            ("FORWARDED_HOST", "evil.example"),
            ("REMOTE_USER_ID", "alice"),
            ("AUTH_REQUEST_EMAIL", "alice@example.com"),
            ("AUTH_USER_ID", "alice-id"),
            ("AUTHENTICATED_USER_EMAIL", "alice@example.com"),
            ("END_USER_EMAIL", "alice@example.com"),
            ("CLIENT_PRINCIPAL_ID", "alice-id"),
            ("PRINCIPAL_ID", "alice-id"),
            ("VERIFIED_USER_ID", "alice-id"),
            ("IMPERSONATE_EXTRA_SCOPES", "cluster-admin"),
            ("ORIGINAL_URL", "/admin"),
            ("ENVOY_ORIGINAL_PATH", "/admin"),
            ("SSH_AUTH_SOCK", "/tmp/ssh-agent.sock"),
            ("SSH_AGENT_PID", "1234"),
            ("SSH_ASKPASS", "/tmp/askpass.sh"),
            ("GIT_ASKPASS", "/tmp/git-askpass.sh"),
            ("GIT_SSH", "/tmp/ssh-wrapper.sh"),
            ("GIT_SSH_COMMAND", "ssh -i /tmp/evil"),
            ("GIT_TRACE", "1"),
            ("SSH_COMMAND", "ssh -i /tmp/evil"),
            ("GIT_CONFIG_GLOBAL", "/tmp/evil-gitconfig"),
            ("git_config_count", "1"),
            ("NPM_CONFIG_USERCONFIG", "/tmp/evil-npmrc"),
            ("yarn_npmrc_path", "/tmp/evil-yarnrc"),
            ("PNPM_HOME", "/tmp/evil-pnpm-home"),
            ("PNPM_STORE_PATH", "/tmp/evil-pnpm-store"),
            ("PIP_CONFIG_FILE", "/tmp/evil-pip.conf"),
            ("PIP_INDEX_URL", "https://evil.example/simple"),
            ("UV_INDEX_URL", "https://evil.example/simple"),
            ("uv_publish_token", "uv-evil-token"),
            ("UV_CACHE_DIR", "/tmp/evil-uv-cache"),
            ("POETRY_HTTP_BASIC_FOO_PASSWORD", "evil-poetry-password"),
            ("POETRY_VIRTUALENVS_PATH", "/tmp/evil-poetry-venv"),
            ("bundle_gemfile", "/tmp/evil-gemfile"),
            ("BUNDLE_PATH", "/tmp/evil-bundle-path"),
            ("CARGO_TARGET_DIR", "/tmp/evil-cargo-target"),
            (
                "CARGO_REGISTRIES_CRATES_IO_TOKEN",
                "cargo-crates-token-evil",
            ),
            ("cargo_home", "/tmp/evil-cargo-home"),
            ("RUSTUP_HOME", "/tmp/evil-rustup-home"),
            ("RUSTUP_TOOLCHAIN", "nightly-evil"),
            ("RUSTFLAGS", "-Clink-arg=-Wl,--rpath,/tmp/evil"),
            ("RUSTDOCFLAGS", "--html-in-header /tmp/pwn.html"),
            ("RUSTC_WRAPPER", "/tmp/evil-rustc-wrapper.sh"),
            (
                "RUSTC_WORKSPACE_WRAPPER",
                "/tmp/evil-rustc-workspace-wrapper.sh",
            ),
            ("GITHUB_TOKEN", "ghp_eviltoken"),
            ("gh_token", "gho_eviltoken"),
            ("GH_ENTERPRISE_TOKEN", "ghes-eviltoken"),
            ("GITHUB_PAT", "github-pat-evil"),
            ("GITLAB_TOKEN", "glpat-eviltoken"),
            ("GITLAB_PRIVATE_TOKEN", "glpat-private-evil"),
            ("GITLAB_CI_TOKEN", "gitlab-ci-token"),
            ("CI_JOB_TOKEN", "ci-job-token"),
            ("CI_JOB_JWT", "eyJhbGciOiJIUzI1NiJ9.evil.jwt"),
            ("ci_job_jwt_v2", "eyJhbGciOiJIUzI1NiJ9.evil.jwt.v2"),
            ("ACTIONS_ID_TOKEN_REQUEST_TOKEN", "ghs-oidc-request-token"),
            (
                "actions_id_token_request_url",
                "https://token.actions.githubusercontent.com/.well-known/openid-configuration",
            ),
            ("ACTIONS_RUNTIME_TOKEN", "ghs-runtime-token"),
            ("ACTIONS_RUNTIME_URL", "https://actions.evil"),
            ("GITLAB_OIDC_TOKEN", "gitlab-oidc-token"),
            ("GITLAB_USER_LOGIN", "evil-user"),
            ("circle_oidc_token", "circle-oidc-token"),
            ("OIDC_TOKEN", "generic-oidc-token"),
            ("OIDC_IDENTITY", "oidc-identity-evil"),
            ("JWT_ASSERTION", "eyJhbGciOiJSUzI1NiJ9.evil.assertion"),
            ("OIDC_USERINFO", "alice@example.com"),
            ("AUTH_SESSION_ID", "session-id-evil"),
            ("USER_SESSION", "session-evil"),
            ("SERVICE_TLS_INSECURE", "true"),
            ("SERVICE_VERIFY_SSL", "false"),
            ("SERVICE_SSL_VERIFY", "0"),
            ("SERVICE_URL_SCHEME", "http"),
            ("SERVICE_HTTP_METHOD_OVERRIDE", "GET"),
            ("SERVICE_METHOD_OVERRIDE", "GET"),
            ("SERVICE_FORWARDED_METHOD", "GET"),
            ("SERVICE_ORIGINAL_METHOD", "GET"),
            ("SERVICE_ORIGINAL_PATH", "/admin"),
            ("SERVICE_ORIGINAL_URL", "/admin"),
            ("SERVICE_REWRITE_URL", "/admin"),
            ("SERVICE_REAL_IP", "1.2.3.4"),
            ("SERVICE_CF_CONNECTING_IP", "1.2.3.4"),
            ("SERVICE_ENVOY_PEER_METADATA", "peer-data"),
            ("SLACK_REQUEST_TIMESTAMP", "1711111111"),
            (
                "TLS_CERTIFICATE_CHAIN_PATH",
                "/tmp/evil-certificate-chain.pem",
            ),
            ("TLS_PRIVATE_KEY_PATH", "/tmp/evil-private-key.pem"),
            ("CIRCLE_TOKEN", "circleci-token-evil"),
            ("CIRCLECI_PROJECT_ID", "circle-project-evil"),
            ("BUILDKITE_AGENT_ACCESS_TOKEN", "buildkite-agent-token"),
            ("buildkite_api_token", "buildkite-api-token"),
            ("BUILDKITE_ORGANIZATION_SLUG", "buildkite-org-evil"),
            ("DRONE_TOKEN", "drone-token-evil"),
            ("DRONE_SERVER", "https://drone.evil"),
            ("jenkins_api_token", "jenkins-token-evil"),
            ("JENKINS_URL", "https://jenkins.evil"),
            ("CI_REGISTRY_PASSWORD", "ci-registry-password"),
            ("CI_PIPELINE_ID", "999999"),
            ("RUNNER_TRACKING_ID", "runner-track-evil"),
            ("ci_deploy_password", "ci-deploy-password"),
            ("BITBUCKET_TOKEN", "bb-token"),
            ("BITBUCKET_APP_PASSWORD", "bb-app-password"),
            ("BITBUCKET_WORKSPACE", "evil-workspace"),
            ("GITHUB_RUN_ID", "123456789"),
            ("CODECOV_TOKEN", "codecov-token"),
            ("CODECOV_SLUG", "org/repo-evil"),
            ("SENTRY_AUTH_TOKEN", "sentry-auth-token"),
            ("SENTRY_DSN", "https://ingest.sentry.io/evil"),
            ("SONAR_TOKEN", "sonar-token"),
            ("SONAR_HOST_URL", "https://sonar.evil"),
            ("DATADOG_API_KEY", "dd-api-key-evil"),
            ("DATADOG_SITE", "datadoghq.com"),
            ("honeycomb_api_key", "hny-api-key-evil"),
            ("NEW_RELIC_API_KEY", "nr-api-key-evil"),
            ("new_relic_license_key", "nr-license-key-evil"),
            ("NEW_RELIC_APP_NAME", "evil-app"),
            ("LOGDNA_INGESTION_KEY", "logdna-key-evil"),
            ("LOGDNA_HOST", "logs.evil.example"),
            ("ROLLBAR_ACCESS_TOKEN", "rollbar-token-evil"),
            ("bugsnag_api_key", "bugsnag-api-key-evil"),
            ("PAGERDUTY_API_TOKEN", "pagerduty-token-evil"),
            ("grafana_cloud_api_key", "grafana-cloud-key-evil"),
            (
                "OTEL_EXPORTER_OTLP_HEADERS",
                "authorization=Bearer evil",
            ),
            (
                "otel_exporter_otlp_traces_headers",
                "authorization=Bearer evil",
            ),
            (
                "OTEL_EXPORTER_OTLP_METRICS_HEADERS",
                "authorization=Bearer evil",
            ),
            (
                "OTEL_EXPORTER_OTLP_LOGS_HEADERS",
                "authorization=Bearer evil",
            ),
            ("OTEL_EXPORTER_OTLP_ENDPOINT", "https://otel.evil"),
            ("OTLP_ENDPOINT", "https://otlp.evil"),
            ("CLOUDFLARE_API_TOKEN", "cf-api-token-evil"),
            ("CLOUDFLARE_API_KEY", "cf-api-key-evil"),
            ("CLOUDFLARE_API_BASE_URL", "https://api.cloudflare.evil"),
            ("cf_api_token", "cf-token-evil"),
            ("CF_API_BASE_URL", "https://api.cloudflare.evil"),
            ("CF_ACCESS_CLIENT_ID", "cf-access-client-id-evil"),
            ("cf_access_client_secret", "cf-access-client-secret-evil"),
            ("CF_ACCESS_AUD", "cf-access-audience-evil"),
            (
                "CLOUDFLARE_ACCESS_CLIENT_ID",
                "cf-access-client-id-evil-2",
            ),
            (
                "cloudflare_access_aud",
                "cf-access-audience-evil-2",
            ),
            (
                "cloudflare_access_client_secret",
                "cf-access-client-secret-evil-2",
            ),
            ("FASTLY_API_TOKEN", "fastly-token-evil"),
            ("FASTLY_SERVICE_ID", "fastly-service-evil"),
            ("akamai_client_token", "akamai-client-token-evil"),
            ("AKAMAI_CLIENT_SECRET", "akamai-client-secret-evil"),
            ("AKAMAI_ACCESS_TOKEN", "akamai-access-token-evil"),
            ("AKAMAI_HOST", "akamai.evil"),
            ("NETLIFY_AUTH_TOKEN", "netlify-token-evil"),
            ("NETLIFY_SITE_ID", "netlify-site-evil"),
            ("VERCEL_TOKEN", "vercel-token-evil"),
            ("VERCEL_PROJECT_ID", "vercel-project-evil"),
            ("RENDER_API_KEY", "render-api-key-evil"),
            ("RENDER_SERVICE_ID", "render-service-evil"),
            ("railway_token", "railway-token-evil"),
            ("RAILWAY_PROJECT_ID", "railway-project-evil"),
            ("NGROK_AUTHTOKEN", "ngrok-authtoken-evil"),
            ("ngrok_api_key", "ngrok-api-key-evil"),
            ("NGROK_AUTHTOKEN_FILE", "/tmp/evil-ngrok.token"),
            ("NGROK_CONFIG", "/tmp/evil-ngrok.yml"),
            ("NGROK_EDGE_LABEL", "edge-evil"),
            ("CLOUDFLARE_TUNNEL_TOKEN", "cf-tunnel-token-evil"),
            ("CLOUDFLARE_TUNNEL_ID", "tunnel-id-evil"),
            ("TAILSCALE_AUTHKEY", "tskey-auth-evil"),
            ("ts_authkey", "tskey-auth-evil-2"),
            ("TS_CONTROL_URL", "https://controlplane.evil-ts"),
            ("TAILSCALE_API_KEY", "ts-api-key-evil"),
            ("TAILSCALE_CONTROL_URL", "https://controlplane.evil"),
            (
                "TAILSCALE_OAUTH_CLIENT_SECRET",
                "ts-oauth-client-secret-evil",
            ),
            ("HEROKU_API_KEY", "heroku-api-key-evil"),
            ("fly_api_token", "fly-token-evil"),
            ("DIGITALOCEAN_ACCESS_TOKEN", "do-token-evil"),
            ("linode_token", "linode-token-evil"),
            ("HCLOUD_TOKEN", "hcloud-token-evil"),
            ("VULTR_API_KEY", "vultr-api-key-evil"),
            ("SCW_ACCESS_KEY", "scw-access-key-evil"),
            ("scw_secret_key", "scw-secret-key-evil"),
            ("SUPABASE_ACCESS_TOKEN", "sb-access-token-evil"),
            ("supabase_service_role_key", "sb-service-role-key-evil"),
            ("SUPABASE_SERVICE_KEY", "sb-service-key-evil"),
            ("SUPABASE_ANON_KEY", "sb-anon-key-evil"),
            ("supabase_jwt_secret", "supabase-jwt-secret-evil"),
            ("SUPABASE_SECRET_KEY", "supabase-secret-key-evil"),
            ("SUPABASE_DB_PASSWORD", "supabase-db-password-evil"),
            ("SUPABASE_URL", "https://evil.supabase.co"),
            ("SUPABASE_DB_URL", "postgres://user:pass@db/supabase"),
            ("SUPABASE_REGION", "us-east-1"),
            ("METABASE_API_KEY", "metabase-api-key-evil"),
            ("metabase_site_url", "https://evil-metabase.example"),
            ("METABASE_INSTANCE_NAME", "evil-metabase"),
            (
                "METABASE_DB_CONNECTION_URI",
                "postgres://user:pass@db/metabase",
            ),
            (
                "mb_db_connection_uri",
                "postgres://user:pass@db/metabase",
            ),
            ("METABASE_DB_USER", "metabase-user-evil"),
            ("metabase_db_pass", "metabase-pass-evil"),
            ("MB_DB_USER", "mb-user-evil"),
            ("mb_db_pass", "mb-pass-evil"),
            ("MB_DB_SSLMODE", "disable"),
            ("MB_JWT_ISSUER", "evil-issuer"),
            ("MB_ENCRYPTION_CIPHER", "evil-cipher"),
            (
                "METABASE_ENCRYPTION_SECRET_KEY",
                "metabase-encryption-secret-evil",
            ),
            (
                "metabase_jwt_shared_secret",
                "metabase-jwt-shared-secret-evil",
            ),
            (
                "MB_ENCRYPTION_SECRET_KEY",
                "mb-encryption-secret-evil",
            ),
            ("mb_jwt_shared_secret", "mb-jwt-secret-evil"),
            ("NEON_API_KEY", "neon-api-key-evil"),
            ("NEON_BRANCH_ID", "neon-branch-evil"),
            ("PLANETSCALE_ORG", "pscale-org-evil"),
            ("UPSTASH_ACCOUNT_ID", "upstash-account-evil"),
            ("VAULT_TOKEN", "hvs.evilvaulttoken"),
            ("VAULT_ADDR", "https://vault.evil"),
            ("SOPS_AGE_KEY", "AGE-SECRET-KEY-1EVILTOKEN"),
            ("SOPS_AGE_RECIPIENTS", "age1evilrecipient"),
            ("sops_age_key_file", "/tmp/evil-sops-age-key.txt"),
            ("AGE_SECRET_KEY", "AGE-SECRET-KEY-1EVILTOKEN2"),
            ("age_key_file", "/tmp/evil-age-key.txt"),
            ("GPG_PRIVATE_KEY", "-----BEGIN PGP PRIVATE KEY-----evil"),
            ("gpg_passphrase", "evil-gpg-passphrase"),
            ("SIGSTORE_ID_TOKEN", "sigstore-oidc-token"),
            ("SIGSTORE_FULCIO_URL", "https://fulcio.sigstore.evil"),
            ("cosign_password", "evil-cosign-password"),
            ("COSIGN_PRIVATE_KEY", "-----BEGIN PRIVATE KEY-----evil"),
            ("COSIGN_REPOSITORY", "ghcr.io/evil/cosign"),
            ("KUBE_TOKEN", "evil-kube-token"),
            ("kube_bearer_token", "Bearer evil-kube-token"),
            ("ARGOCD_AUTH_TOKEN", "argocd-token-evil"),
            ("ARGOCD_SERVER", "https://argocd.evil"),
            ("TF_TOKEN_APP_TERRAFORM_IO", "terraform-cloud-token-evil"),
            ("TERRAFORM_CLOUD_TOKEN", "tfc-token-evil"),
            ("TERRAFORM_ORGANIZATION", "evil-org"),
            ("tfc_token", "tfc-short-token-evil"),
            ("PULUMI_ACCESS_TOKEN", "pul-evil-token"),
            ("PULUMI_BACKEND_URL", "https://pulumi.evil"),
            ("doppler_token", "dp.evil.token"),
            ("DOPPLER_PROJECT", "evil-project"),
            ("INFISICAL_TOKEN", "infisical-token-evil"),
            ("INFISICAL_PROJECT_ID", "infisical-project-evil"),
            ("op_service_account_token", "opsvcaccttoken-evil"),
            ("OP_SERVICE_ACCOUNT_ID", "op-service-id-evil"),
            ("NODE_AUTH_TOKEN", "npm-node-auth-token"),
            ("NPM_TOKEN", "npm-auth-token"),
            ("NPM_REGISTRY_URL", "https://registry.npmjs.org"),
            ("YARN_NPM_AUTH_TOKEN", "yarn-auth-token"),
            ("YARN_NPM_REGISTRY_SERVER", "https://registry.yarnpkg.com"),
            ("bun_auth_token", "bun-auth-token"),
            ("BUN_REGISTRY", "https://registry.bun.sh"),
            ("PYPI_TOKEN", "pypi-token-evil"),
            ("PYPI_API_TOKEN", "pypi-api-token-evil"),
            ("PYPI_REPOSITORY", "https://upload.pypi.org/legacy"),
            ("TWINE_USERNAME", "evil-pypi-user"),
            ("twine_password", "evil-pypi-password"),
            ("TWINE_REPOSITORY_URL", "https://upload.pypi.org/legacy"),
            ("RUBYGEMS_API_KEY", "rubygems-api-key-evil"),
            ("RUBYGEMS_HOST", "https://rubygems.org"),
            ("NUGET_API_KEY", "nuget-api-key-evil"),
            ("NUGET_SOURCE", "https://api.nuget.org/v3/index.json"),
            ("nuget_auth_token", "nuget-auth-token-evil"),
            ("TELEGRAM_BOT_TOKEN", "telegram-bot-token-evil"),
            (
                "TELEGRAM_BOT_API_SECRET_TOKEN",
                "telegram-webhook-secret-evil",
            ),
            ("TELEGRAM_API_HASH", "telegram-api-hash-evil"),
            ("TELEGRAM_CHAT_ID", "123456789"),
            ("TWITTER_BEARER_TOKEN", "twitter-bearer-token-evil"),
            ("twitter_api_key", "twitter-api-key-evil"),
            ("TWITTER_API_SECRET", "twitter-api-secret-evil"),
            ("TWITTER_ACCESS_TOKEN", "twitter-access-token-evil"),
            ("TWITTER_USERNAME", "evil-account"),
            (
                "twitter_access_token_secret",
                "twitter-access-token-secret-evil",
            ),
            ("X_API_KEY", "x-api-key-evil"),
            ("signal_cli_password", "signal-password-evil"),
            ("SIGNAL_CLI_USERNAME", "+10000000000"),
            ("SIGNAL_CLI_CONFIG_PATH", "/tmp/signal-cli"),
            ("TWILIO_AUTH_TOKEN", "twilio-auth-token-evil"),
            ("twilio_api_key", "twilio-api-key-evil"),
            ("TWILIO_ACCOUNT_SID", "AC123"),
            ("STRIPE_API_KEY", "stripe-api-key-evil"),
            ("stripe_secret_key", "stripe-secret-key-evil"),
            ("STRIPE_WEBHOOK_SECRET", "whsec_evil_secret"),
            ("STRIPE_ACCOUNT_ID", "acct_evil"),
            ("SHOPIFY_WEBHOOK_SECRET", "shopify-webhook-secret-evil"),
            ("CUSTOM_WEBHOOK_SECRET", "custom-webhook-secret-evil"),
            (
                "CUSTOM_WEBHOOK_SECRET_TOKEN",
                "custom-webhook-secret-token-evil",
            ),
            ("PAYLOAD_SIGNATURE", "sha256=deadbeef"),
            ("SHOPIFY_API_SECRET", "shopify-api-secret-evil"),
            ("SHOPIFY_STORE_DOMAIN", "evil.myshopify.com"),
            ("GITEA_INSTANCE_URL", "https://gitea.evil"),
            ("GOGS_INSTANCE_URL", "https://gogs.evil"),
            ("GITHUB_WEBHOOK_SECRET", "github-webhook-secret-evil"),
            ("gitlab_webhook_secret_token", "gitlab-webhook-secret-evil"),
            ("LINE_CHANNEL_SECRET", "line-channel-secret-evil"),
            ("LINE_CHANNEL_ACCESS_TOKEN", "line-channel-token-evil"),
            ("FACEBOOK_ACCESS_TOKEN", "facebook-access-token-evil"),
            ("facebook_app_secret", "facebook-app-secret-evil"),
            ("FACEBOOK_APP_ID", "1234567890"),
            ("META_ACCESS_TOKEN", "meta-access-token-evil"),
            ("META_BUSINESS_ID", "0987654321"),
            ("INSTAGRAM_ACCESS_TOKEN", "instagram-access-token-evil"),
            ("INSTAGRAM_APP_ID", "1122334455"),
            ("WHATSAPP_TOKEN", "whatsapp-token-evil"),
            ("whatsapp_verify_token", "whatsapp-verify-token-evil"),
            ("WHATSAPP_PHONE_NUMBER_ID", "15551234567"),
            ("MATRIX_ACCESS_TOKEN", "matrix-token-evil"),
            ("matrix_homeserver_token", "matrix-hs-token-evil"),
            ("MATRIX_SERVER_NAME", "evil-matrix.example"),
            (
                "MATRIX_REGISTRATION_SHARED_SECRET",
                "matrix-registration-secret-evil",
            ),
            ("matrix_macaroon_secret_key", "matrix-macaroon-secret-evil"),
            ("DISCORD_TOKEN", "discord-token-evil"),
            (
                "DISCORD_WEBHOOK_URL",
                "https://discord.com/api/webhooks/evil",
            ),
            ("DISCORD_APPLICATION_ID", "123456789012345678"),
            ("SLACK_BOT_TOKEN", "xoxb-evil-token"),
            ("SLACK_APP_TOKEN", "xapp-evil-token"),
            ("slack_signing_secret", "slack-signing-secret-evil"),
            ("SLACK_WEBHOOK_URL", "https://hooks.slack.com/services/evil"),
            ("SLACK_TEAM_ID", "T01234567"),
            ("SENDGRID_API_KEY", "sendgrid-api-key-evil"),
            ("SENDGRID_API_BASE_URL", "https://sendgrid.evil"),
            ("MAILGUN_API_KEY", "mailgun-api-key-evil"),
            ("MAILGUN_DOMAIN", "mg.evil.example"),
            ("POSTMARK_API_TOKEN", "postmark-api-token-evil"),
            ("POSTMARK_SERVER_URL", "https://postmark.evil"),
            ("resend_api_key", "resend-api-key-evil"),
            ("RESEND_AUDIENCE_ID", "audience-evil"),
            ("DATABASE_URL", "postgres://user:pass@db/evil"),
            ("DATABASE_HOST", "db.evil"),
            ("database_dsn", "postgres://user:pass@db/evil"),
            ("REDIS_URL", "redis://:pass@redis:6379/0"),
            ("REDIS_HOST", "redis.evil"),
            ("mongodb_uri", "mongodb://user:pass@mongo:27017/evil"),
            ("MONGODB_DBNAME", "evil"),
            ("POSTGRES_URL", "postgres://user:pass@db/evil"),
            (
                "METRICS_POSTGRES_URL",
                "postgres://user:pass@metrics/evil",
            ),
            ("POSTGRES_USER", "postgres-evil"),
            ("MYSQL_URL", "mysql://user:pass@db/evil"),
            ("SERVICE_MYSQL_URL", "mysql://user:pass@service/evil"),
            ("MYSQL_DATABASE", "evil"),
            ("BROKER_URL", "amqp://user:pass@mq/evil"),
            ("BROKER_HOST", "mq.evil"),
            ("amqp_url", "amqp://user:pass@mq/evil"),
            ("AMQP_HOST", "mq.evil"),
            ("KAFKA_BROKERS", "kafka-1.evil:9092"),
            ("NATS_URL", "nats://nats.evil:4222"),
            ("RABBITMQ_URI", "amqp://rabbit.evil"),
            ("REDPANDA_BROKERS", "redpanda.evil:9092"),
            ("SQLITE_URL", "file:/tmp/evil.sqlite"),
            ("SQLITE_BUSY_TIMEOUT", "5000"),
            ("sqlite_path", "/tmp/evil.sqlite"),
            ("SQLITE_FILE", "/tmp/evil.sqlite"),
            ("SQLITE_TMPDIR", "/tmp/evil-sqlite-tmp"),
            ("sqlite_history", "/tmp/evil-sqlite-history"),
            ("SQLCIPHER_KEY", "sqlcipher-key-evil"),
            ("SQLCIPHER_KDF_ITER", "256000"),
            ("libsql_auth_token", "libsql-token-evil"),
            ("LIBSQL_URL", "libsql://org.turso.io"),
            ("TURSO_AUTH_TOKEN", "turso-token-evil"),
            ("turso_database_url", "libsql://org.turso.io"),
            ("PGLITE_DATA_DIR", "/tmp/evil-pglite"),
            ("pglite_db_path", "/tmp/evil-pglite/db"),
            ("PGLITE_OPFS_PATH", "opfs://evil-db"),
            ("PGLITE_WAL_DIR", "/tmp/evil-pglite/wal"),
            ("OPFS_ROOT", "opfs://evil-root"),
            ("opfs_path", "opfs://evil-path"),
            ("OPFS_SNAPSHOT_PATH", "opfs://evil-snapshot"),
            ("OPENAI_API_KEY", "sk-evil-openai"),
            ("OPENROUTER_API_KEY", "sk-or-evil"),
            ("AZURE_OPENAI_API_KEY", "azure-openai-evil"),
            ("anthropic_api_key", "sk-ant-evil"),
            ("GEMINI_API_KEY", "gemini-evil-key"),
            ("MISTRAL_API_KEY", "mistral-evil-key"),
            ("COHERE_API_KEY", "cohere-evil-key"),
            ("GROQ_API_KEY", "groq-evil-key"),
            ("TOGETHER_API_KEY", "together-evil-key"),
            ("PERPLEXITY_API_KEY", "pplx-evil-key"),
            ("DEEPSEEK_API_KEY", "deepseek-evil-key"),
            ("xai_api_key", "xai-evil-key"),
            ("FIREWORKS_API_KEY", "fireworks-evil-key"),
            ("HUGGINGFACEHUB_API_TOKEN", "hf_hub_evil_token"),
            ("hf_token", "hf_evil_token"),
            ("REPLICATE_API_TOKEN", "r8_evil_token"),
            ("ELEVENLABS_API_KEY", "elevenlabs-evil-key"),
            ("ACCESS_TOKEN", "evil-access-token"),
            ("id_token", "evil-id-token"),
            ("REFRESH_TOKEN", "evil-refresh-token"),
            ("HOME", "/tmp/evil-home"),
            ("userprofile", "C:/evil-home"),
            ("XDG_CONFIG_HOME", "/tmp/evil-xdg-config"),
            ("XDG_DATA_HOME", "/tmp/evil-xdg-data"),
            ("XDG_CACHE_HOME", "/tmp/evil-xdg-cache"),
            ("AWS_SHARED_CREDENTIALS_FILE", "/tmp/evil-aws-credentials"),
            ("aws_config_file", "/tmp/evil-aws-config"),
            ("AWS_ACCESS_KEY_ID", "AKIAEVILTEST000001"),
            ("aws_secret_access_key", "evil-aws-secret-key"),
            ("AWS_SESSION_TOKEN", "evil-session-token"),
            ("AWS_REGION", "us-east-1"),
            ("AWS_PROFILE", "evil-profile"),
            ("aws_default_profile", "evil-default-profile"),
            ("AWS_ROLE_ARN", "arn:aws:iam::123456789012:role/evil"),
            ("aws_role_session_name", "evil-session"),
            ("AWS_ROLE_SESSION_DURATION", "3600"),
            ("BOTO_CONFIG", "/tmp/evil-boto-config"),
            ("AWS_WEB_IDENTITY_TOKEN_FILE", "/tmp/evil-aws-web-identity"),
            ("AWS_EC2_METADATA_DISABLED", "false"),
            (
                "aws_ec2_metadata_service_endpoint",
                "http://169.254.169.254",
            ),
            ("AWS_EC2_METADATA_SERVICE_ENDPOINT_MODE", "IPv6"),
            ("AWS_METADATA_SERVICE_TIMEOUT", "1"),
            ("aws_metadata_service_num_attempts", "1"),
            (
                "AWS_CONTAINER_CREDENTIALS_RELATIVE_URI",
                "/v2/credentials/evil",
            ),
            (
                "aws_container_credentials_full_uri",
                "http://169.254.170.2/v2/credentials/evil",
            ),
            ("AWS_CONTAINER_AUTHORIZATION_TOKEN", "Bearer evil"),
            (
                "AWS_CONTAINER_AUTHORIZATION_TOKEN_FILE",
                "/tmp/evil-aws-auth-token",
            ),
            ("GOOGLE_APPLICATION_CREDENTIALS", "/tmp/evil-gcp-sa.json"),
            ("GOOGLE_OAUTH_ACCESS_TOKEN", "ya29.eviltoken"),
            ("GOOGLE_OAUTH_REFRESH_TOKEN", "1//evil-refresh-token"),
            (
                "GOOG_AUTHENTICATED_USER_EMAIL",
                "accounts.google.com:alice@example.com",
            ),
            (
                "AMZN_OIDC_IDENTITY",
                "arn:aws:iam::123456789012:user/alice",
            ),
            ("GOOGLE_ID_TOKEN", "eyJhbGciOiJSUzI1NiJ9.evil.google.id"),
            ("gcp_access_token", "ya29.evil.gcp.access"),
            ("GCP_ID_TOKEN", "eyJhbGciOiJSUzI1NiJ9.evil.gcp.id"),
            ("GOOGLE_GHA_CREDS_PATH", "/tmp/gha-creds-evil.json"),
            ("GOOGLE_CLOUD_PROJECT", "evil-project"),
            (
                "GOOGLE_IMPERSONATE_SERVICE_ACCOUNT",
                "evil-sa@project.iam.gserviceaccount.com",
            ),
            ("GCE_METADATA_HOST", "metadata.evil.internal"),
            ("gcloud_project", "evil-project"),
            ("cloudsdk_config", "/tmp/evil-gcloud-config"),
            ("CLOUDSDK_AUTH_ACCESS_TOKEN", "ya29.eviltoken"),
            (
                "cloudsdk_auth_credential_file_override",
                "/tmp/evil-gcloud-creds.json",
            ),
            ("AZURE_CONFIG_DIR", "/tmp/evil-azure-config"),
            ("AZURE_FEDERATED_TOKEN_FILE", "/tmp/evil-azure-federated.jwt"),
            ("AZURE_ACCESS_TOKEN", "evil-azure-access-token"),
            ("MS_TOKEN_AAD_ACCESS_TOKEN", "eyJhbGciOiJSUzI1NiJ9.evil"),
            ("azure_id_token", "eyJhbGciOiJSUzI1NiJ9.evil.azure.id"),
            ("azure_client_id", "00000000-0000-0000-0000-000000000001"),
            ("AZURE_TENANT_ID", "00000000-0000-0000-0000-000000000002"),
            ("AZURE_CLIENT_SECRET", "evil-secret"),
            ("AZURE_USERNAME", "alice@example.com"),
            ("AZURE_PASSWORD", "evil-password"),
            ("IDENTITY_ENDPOINT", "http://127.0.0.1:40342/msi/token"),
            ("identity_header", "secret-identity-header"),
            ("IMDS_ENDPOINT", "http://169.254.169.254/metadata/identity"),
            ("MSI_ENDPOINT", "http://127.0.0.1:40342/msi/token"),
            ("msi_secret", "secret-msi"),
            ("ARM_CLIENT_ID", "00000000-0000-0000-0000-000000000003"),
            ("arm_tenant_id", "00000000-0000-0000-0000-000000000004"),
            ("ARM_CLIENT_SECRET", "evil-arm-secret"),
            ("ARM_ACCESS_KEY", "evil-arm-access-key"),
            ("ARM_SUBSCRIPTION_ID", "sub-evil-arm"),
            ("ARM_USE_OIDC", "true"),
            ("arm_oidc_token", "arm-oidc-token-evil"),
            ("ARM_OIDC_TOKEN_FILE", "/tmp/evil-arm-oidc.jwt"),
            ("ARM_USE_MSI", "true"),
            ("arm_use_azuread", "true"),
            ("azure_subscription_id", "sub-evil-azure"),
            ("KUBECONFIG", "/tmp/evil-kubeconfig"),
            ("KUBE_CONFIG_PATH", "/tmp/evil-kubeconfig-alt"),
            ("K8S_CLUSTER_NAME", "evil-cluster"),
            ("KUBE_NAMESPACE", "evil-namespace"),
            ("HELM_KUBEAPISERVER", "https://evil-k8s-api"),
            ("HELM_KUBETOKEN", "evil-helm-kube-token"),
            ("HELM_KUBECAFILE", "/tmp/evil-kube-ca.pem"),
            ("HELM_NAMESPACE", "evil-namespace"),
            ("DOCKER_CONFIG", "/tmp/evil-docker-config"),
            ("DOCKER_AUTH_CONFIG", "{\"auths\":{\"registry\":{}}}"),
            ("DOCKER_USERNAME", "evil-docker-user"),
            ("docker_password", "evil-docker-pass"),
            ("DOCKER_HOST", "tcp://evil-docker:2376"),
            ("registry_auth_file", "/tmp/evil-registry-auth.json"),
            ("REGISTRY_URL", "https://registry.evil"),
            ("CONTAINERS_AUTH_FILE", "/tmp/evil-containers-auth.json"),
            ("CONTAINERS_REGISTRIES_CONF", "/tmp/evil-registries.conf"),
            ("HELM_REGISTRY_CONFIG", "/tmp/evil-helm-registry.json"),
            ("CR_PAT", "evil-ghcr-pat"),
            ("GHCR_TOKEN", "evil-ghcr-token"),
            ("GHCR_HOST", "ghcr.evil"),
            ("QUAY_TOKEN", "evil-quay-token"),
            ("quay_oauth_token", "evil-quay-oauth-token"),
            ("QUAY_ORGANIZATION", "evil-org"),
            ("HARBOR_USERNAME", "evil-harbor-user"),
            ("HARBOR_PASSWORD", "evil-harbor-pass"),
            ("HARBOR_URL", "https://harbor.evil"),
            ("ARTIFACTORY_API_KEY", "evil-artifactory-key"),
            ("ARTIFACTORY_URL", "https://artifactory.evil"),
            ("JFROG_ACCESS_TOKEN", "evil-jfrog-token"),
            ("JFROG_URL", "https://jfrog.evil"),
            ("OCI_CLI_KEY_FILE", "/tmp/evil-oci-key.pem"),
            (
                "oci_cli_security_token_file",
                "/tmp/evil-oci-security-token",
            ),
            ("OCI_CLI_AUTH", "security_token"),
            ("oci_cli_region", "sa-saopaulo-1"),
            ("OCI_REGION", "sa-saopaulo-1"),
            ("NETRC", "/tmp/evil.netrc"),
            ("NETRC_MACHINE", "evil-machine"),
            ("_NETRC", "1"),
            ("CURL_HOME", "/tmp/evil-curl-home"),
            ("CURL_SSL_BACKEND", "openssl"),
            ("WGETRC", "/tmp/evil-wgetrc"),
            ("WGET_USER", "evil-user"),
        ];

        for (key, value) in cases {
            let result = spawn_process(
                &argv,
                &[(key.to_string(), value.to_string())],
                None,
                1000,
                None,
            )
            .await;
            let err = match result {
                Ok((stdout, stderr, status, timed_out)) => {
                    panic!(
                        "expected blocked env key for {key}, got Ok(stdout={stdout:?}, stderr={stderr:?}, status={status}, timed_out={timed_out})"
                    )
                }
                Err(err) => err,
            };
            assert!(
                err.contains("blocked env key"),
                "expected blocked env key for {key}, got: {err}"
            );
        }
    }

