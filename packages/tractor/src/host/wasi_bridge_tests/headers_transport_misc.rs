    #[test]
    fn sanitized_headers_drop_managed_identity_headers() {
        let headers = vec![
            ("X-RequestTimestamp".to_string(), "1711111111".to_string()),
            ("X-Slack-RequestTimestamp".to_string(), "1711111111".to_string()),
            ("content-type".to_string(), "application/json".to_string()),
            ("Metadata".to_string(), "true".to_string()),
            (
                "x-identity-header".to_string(),
                "identity-header-evil".to_string(),
            ),
            ("X-MSI-SECRET".to_string(), "msi-secret-evil".to_string()),
        ];
        let out = sanitized_plugin_headers(&headers);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].0, "content-type");
    }

    #[test]
    fn sanitized_headers_drop_metadata_auth_headers() {
        let headers = vec![
            ("content-type".to_string(), "application/json".to_string()),
            (
                "x-aws-ec2-metadata-token".to_string(),
                "AQAEbW9jay10b2tlbg==".to_string(),
            ),
            (
                "X-Aws-Ec2-Metadata-Token-Ttl-Seconds".to_string(),
                "21600".to_string(),
            ),
            ("Metadata-Flavor".to_string(), "Google".to_string()),
            ("X-Google-Metadata-Request".to_string(), "True".to_string()),
        ];
        let out = sanitized_plugin_headers(&headers);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].0, "content-type");
    }

    #[test]
    fn sanitized_headers_drop_empty_header_names() {
        let headers = vec![
            ("   ".to_string(), "ignored".to_string()),
            ("content-type".to_string(), "application/json".to_string()),
        ];
        let out = sanitized_plugin_headers(&headers);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].0, "content-type");
    }

    #[test]
    fn sanitized_headers_drop_host_header_case_insensitive() {
        let headers = vec![
            ("Host".to_string(), "attacker.example".to_string()),
            ("content-type".to_string(), "application/json".to_string()),
        ];
        let out = sanitized_plugin_headers(&headers);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].0, "content-type");
    }

    #[test]
    fn sanitized_headers_drop_transport_override_headers() {
        let headers = vec![
            ("Content-Length".to_string(), "999999".to_string()),
            ("Transfer-Encoding".to_string(), "chunked".to_string()),
            ("Forwarded".to_string(), "for=1.2.3.4".to_string()),
            ("Via".to_string(), "1.1 edge".to_string()),
            ("X-Forwarded-For".to_string(), "1.2.3.4".to_string()),
            ("X-ForwardedFor".to_string(), "1.2.3.4".to_string()),
            (
                "X-Forwarded-Client-Country".to_string(),
                "US".to_string(),
            ),
            ("X-Forwarded-Host".to_string(), "evil.example".to_string()),
            ("X-ForwardedHost".to_string(), "evil.example".to_string()),
            ("X-Forwarded-Proto".to_string(), "http".to_string()),
            ("X-ForwardedProto".to_string(), "http".to_string()),
            ("X-Forwarded-Protocol".to_string(), "http".to_string()),
            ("X-ForwardedProtocol".to_string(), "http".to_string()),
            ("X-Forwarded-Scheme".to_string(), "http".to_string()),
            ("X-Forwarded-Ssl".to_string(), "on".to_string()),
            ("X-Url-Scheme".to_string(), "http".to_string()),
            ("X-UrlScheme".to_string(), "http".to_string()),
            ("X-Url-Scheme-Policy".to_string(), "http".to_string()),
            ("X-Tls-Insecure".to_string(), "true".to_string()),
            ("X-TlsInsecure".to_string(), "true".to_string()),
            ("X-Tls-Insecure-Mode".to_string(), "true".to_string()),
            ("X-Insecure-Mode".to_string(), "true".to_string()),
            ("X-InsecureMode".to_string(), "true".to_string()),
            ("X-Verify-Ssl".to_string(), "false".to_string()),
            ("X-VerifySsl".to_string(), "false".to_string()),
            ("X-Verify-Ssl-Policy".to_string(), "false".to_string()),
            ("X-Ssl-Verify".to_string(), "0".to_string()),
            ("X-SslVerify".to_string(), "0".to_string()),
            ("X-Ssl-Verify-Policy".to_string(), "0".to_string()),
            ("X-Forwarded-Port".to_string(), "443".to_string()),
            ("X-ForwardedPort".to_string(), "443".to_string()),
            ("X-Forwarded-Server".to_string(), "edge-1".to_string()),
            ("X-ForwardedServer".to_string(), "edge-1".to_string()),
            ("X-Forwarded-Prefix".to_string(), "/internal".to_string()),
            ("X-ForwardedPrefix".to_string(), "/internal".to_string()),
            ("X-ForwardedSsl".to_string(), "on".to_string()),
            (
                "X-Original-Forwarded-Host".to_string(),
                "evil.example".to_string(),
            ),
            (
                "X-OriginalForwardedHost".to_string(),
                "evil.example".to_string(),
            ),
            ("X-Original-Forwarded-Proto".to_string(), "http".to_string()),
            ("X-OriginalForwardedProto".to_string(), "http".to_string()),
            (
                "X-Original-Forwarded-Protocol".to_string(),
                "http".to_string(),
            ),
            (
                "X-OriginalForwardedProtocol".to_string(),
                "http".to_string(),
            ),
            ("X-Original-Forwarded-Scheme".to_string(), "http".to_string()),
            ("X-OriginalForwardedScheme".to_string(), "http".to_string()),
            ("X-Original-Forwarded-Port".to_string(), "443".to_string()),
            ("X-OriginalForwardedPort".to_string(), "443".to_string()),
            (
                "X-Original-Forwarded-Prefix".to_string(),
                "/internal".to_string(),
            ),
            (
                "X-OriginalForwardedPrefix".to_string(),
                "/internal".to_string(),
            ),
            (
                "X-Original-Forwarded-Server".to_string(),
                "edge-1".to_string(),
            ),
            (
                "X-OriginalForwardedServer".to_string(),
                "edge-1".to_string(),
            ),
            ("X-Original-Host".to_string(), "evil.example".to_string()),
            ("X-OriginalHost".to_string(), "evil.example".to_string()),
            ("X-Host".to_string(), "evil.example".to_string()),
            ("Front-End-Https".to_string(), "on".to_string()),
            ("X-Real-IP".to_string(), "1.2.3.4".to_string()),
            ("X-Forwarded-Client-IP".to_string(), "1.2.3.4".to_string()),
            ("X-Original-Forwarded-For".to_string(), "1.2.3.4".to_string()),
            ("X-Cluster-Client-IP".to_string(), "1.2.3.4".to_string()),
            ("X-Envoy-External-Address".to_string(), "1.2.3.4".to_string()),
            (
                "X-Envoy-Peer-Metadata".to_string(),
                "base64peerdata".to_string(),
            ),
            ("X-Envoy-Peer-Metadata-Id".to_string(), "sidecar~id".to_string()),
            (
                "X-Envoy-Route-Name".to_string(),
                "internal-admin".to_string(),
            ),
            ("Fastly-Client-IP".to_string(), "1.2.3.4".to_string()),
            ("X-Forwarded-Client-Cert".to_string(), "By=spiffe://edge".to_string()),
            ("X-ForwardedClientCert".to_string(), "By=spiffe://edge".to_string()),
            ("X-Client-Cert".to_string(), "-----BEGIN CERT-----...".to_string()),
            ("X-ClientCert".to_string(), "-----BEGIN CERT-----...".to_string()),
            ("X-SSL-Client-Cert".to_string(), "-----BEGIN CERT-----...".to_string()),
            ("X-SSLClientCert".to_string(), "-----BEGIN CERT-----...".to_string()),
            (
                "X-SSL-Client-Policy".to_string(),
                "strict".to_string(),
            ),
            ("X-ARR-ClientCert".to_string(), "MIIB...".to_string()),
            ("SSL-Client-Cert".to_string(), "-----BEGIN CERT-----...".to_string()),
            ("X-HTTP-Method-Override".to_string(), "GET".to_string()),
            ("X-HTTPMethodOverride".to_string(), "GET".to_string()),
            ("X-HTTP-Method-Policy".to_string(), "GET".to_string()),
            ("X-Method-Override".to_string(), "GET".to_string()),
            ("X-MethodOverride".to_string(), "GET".to_string()),
            ("X-Method-Override-Policy".to_string(), "GET".to_string()),
            ("X-Forwarded-Method".to_string(), "GET".to_string()),
            ("X-ForwardedMethod".to_string(), "GET".to_string()),
            ("X-Forwarded-Method-Policy".to_string(), "GET".to_string()),
            ("X-Original-Method".to_string(), "GET".to_string()),
            ("X-OriginalMethod".to_string(), "GET".to_string()),
            ("X-Original-Method-Policy".to_string(), "GET".to_string()),
            ("X-HTTP-Method".to_string(), "GET".to_string()),
            ("X-HTTPMethod".to_string(), "GET".to_string()),
            ("X-Original-URL".to_string(), "/admin".to_string()),
            ("X-Original-URI".to_string(), "/admin".to_string()),
            ("X-Original-Path".to_string(), "/admin".to_string()),
            (
                "X-Original-Query-String".to_string(),
                "debug=true".to_string(),
            ),
            ("X-Forwarded-URI".to_string(), "/admin".to_string()),
            ("X-Rewrite-URL".to_string(), "/admin".to_string()),
            ("X-Rewrite-URI".to_string(), "/admin".to_string()),
            ("X-Rewrite-Host".to_string(), "evil.example".to_string()),
            ("X-Envoy-Original-Path".to_string(), "/admin".to_string()),
            ("X-Envoy-Original-URL".to_string(), "/admin".to_string()),
            ("X-Client-IP".to_string(), "1.2.3.4".to_string()),
            ("X-Client-Geo".to_string(), "US".to_string()),
            ("True-Client-IP".to_string(), "1.2.3.4".to_string()),
            ("CF-Connecting-IP".to_string(), "1.2.3.4".to_string()),
            ("content-type".to_string(), "application/json".to_string()),
        ];
        let out = sanitized_plugin_headers(&headers);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].0, "content-type");
    }

    #[test]
    fn sanitized_headers_drop_hop_by_hop_headers() {
        let headers = vec![
            ("Connection".to_string(), "keep-alive".to_string()),
            ("Proxy-Authorization".to_string(), "Basic x".to_string()),
            ("ProxyAuthorization".to_string(), "Basic x".to_string()),
            ("Proxy-Authenticate".to_string(), "Basic realm=proxy".to_string()),
            ("ProxyAuthenticate".to_string(), "Basic realm=proxy".to_string()),
            (
                "Proxy-Authentication-Info".to_string(),
                "nextnonce=xyz".to_string(),
            ),
            (
                "ProxyAuthenticationInfo".to_string(),
                "nextnonce=xyz".to_string(),
            ),
            ("Proxy-Status".to_string(), "error=http_request_error".to_string()),
            ("ProxyStatus".to_string(), "error=http_request_error".to_string()),
            ("Authentication-Info".to_string(), "nextnonce=abc".to_string()),
            ("AuthenticationInfo".to_string(), "nextnonce=abc".to_string()),
            ("Proxy-Connection".to_string(), "keep-alive".to_string()),
            ("ProxyConnection".to_string(), "keep-alive".to_string()),
            ("TE".to_string(), "trailers".to_string()),
            ("Upgrade".to_string(), "websocket".to_string()),
            ("KeepAlive".to_string(), "timeout=5".to_string()),
            ("content-type".to_string(), "application/json".to_string()),
        ];
        let out = sanitized_plugin_headers(&headers);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].0, "content-type");
    }

    #[test]
    fn sanitized_headers_drop_invalid_header_names() {
        let headers = vec![
            ("x-evil:injected".to_string(), "1".to_string()),
            ("content-type".to_string(), "application/json".to_string()),
        ];
        let out = sanitized_plugin_headers(&headers);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].0, "content-type");
    }

    #[test]
    fn sanitized_headers_drop_values_with_newline() {
        let headers = vec![
            ("x-safe".to_string(), "ok\r\nInjected: 1".to_string()),
            ("content-type".to_string(), "application/json".to_string()),
        ];
        let out = sanitized_plugin_headers(&headers);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].0, "content-type");
    }

    #[test]
    fn sanitized_headers_drop_values_with_other_control_chars() {
        let headers = vec![
            ("x-safe".to_string(), "ok\u{0000}bad".to_string()),
            ("content-type".to_string(), "application/json".to_string()),
        ];
        let out = sanitized_plugin_headers(&headers);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].0, "content-type");
    }

    #[test]
    fn sanitized_headers_drop_values_with_surrounding_spaces() {
        let headers = vec![
            ("x-safe".to_string(), "  token  ".to_string()),
            ("content-type".to_string(), "application/json".to_string()),
        ];
        let out = sanitized_plugin_headers(&headers);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].0, "content-type");
    }

    #[test]
    fn sanitized_headers_drop_values_with_surrounding_unicode_whitespace() {
        let headers = vec![
            ("x-safe".to_string(), "\u{00A0}token\u{00A0}".to_string()),
            ("content-type".to_string(), "application/json".to_string()),
        ];
        let out = sanitized_plugin_headers(&headers);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].0, "content-type");
    }

    #[test]
    fn sanitized_headers_drop_values_with_non_ascii_bytes() {
        let headers = vec![
            ("x-safe".to_string(), "tokén".to_string()),
            ("content-type".to_string(), "application/json".to_string()),
        ];
        let out = sanitized_plugin_headers(&headers);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].0, "content-type");
    }

    #[test]
    fn sanitized_headers_drop_overlong_header_name() {
        let long_name = format!("x-{}", "a".repeat(130));
        let headers = vec![
            (long_name, "ok".to_string()),
            ("content-type".to_string(), "application/json".to_string()),
        ];
        let out = sanitized_plugin_headers(&headers);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].0, "content-type");
    }

    #[test]
    fn sanitized_headers_drop_very_large_header_name() {
        let huge_name = format!("x-{}", "a".repeat(32 * 1024));
        let headers = vec![
            (huge_name, "ok".to_string()),
            ("content-type".to_string(), "application/json".to_string()),
        ];

        let out = sanitized_plugin_headers(&headers);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].0, "content-type");
    }

    #[test]
    fn sanitized_headers_drop_overlong_header_value() {
        let headers = vec![
            ("x-safe".to_string(), "a".repeat(16 * 1024 + 1)),
            ("content-type".to_string(), "application/json".to_string()),
        ];
        let out = sanitized_plugin_headers(&headers);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].0, "content-type");
    }

    #[test]
    fn sanitized_headers_cap_forwarded_header_count() {
        let headers: Vec<(String, String)> = (0..80)
            .map(|i| (format!("x-header-{i}"), "ok".to_string()))
            .collect();
        let out = sanitized_plugin_headers(&headers);
        assert_eq!(out.len(), 64);
        assert_eq!(out[0].0, "x-header-0");
        assert_eq!(out[63].0, "x-header-63");
    }

    #[test]
    fn sanitized_headers_deduplicate_names_case_insensitive() {
        let headers = vec![
            ("X-Trace-Id".to_string(), "first".to_string()),
            (" x-trace-id ".to_string(), "second".to_string()),
            ("content-type".to_string(), "application/json".to_string()),
        ];

        let out = sanitized_plugin_headers(&headers);
        assert_eq!(out.len(), 2);
        assert_eq!(out[0], ("X-Trace-Id", "first"));
        assert_eq!(out[1], ("content-type", "application/json"));
    }

    #[test]
    fn sanitized_headers_allow_large_single_header_within_pair_cap() {
        let headers = vec![
            ("x-large".to_string(), "a".repeat(12 * 1024)),
            ("content-type".to_string(), "application/json".to_string()),
        ];
        let out = sanitized_plugin_headers(&headers);
        assert_eq!(out.len(), 2);
        assert_eq!(out[0].0, "x-large");
    }

    #[test]
    fn sanitized_headers_use_per_header_byte_cap_not_global_total() {
        let headers = vec![
            ("x-h1".to_string(), "a".repeat(8000)),
            ("x-h2".to_string(), "a".repeat(8000)),
            ("x-h3".to_string(), "a".repeat(8000)),
        ];

        let out = sanitized_plugin_headers(&headers);
        assert_eq!(out.len(), 3);
        assert_eq!(out[0].0, "x-h1");
        assert_eq!(out[1].0, "x-h2");
        assert_eq!(out[2].0, "x-h3");
    }

    #[test]
    fn sanitized_headers_limit_input_scan_window() {
        let mut headers: Vec<(String, String)> = (0..256)
            .map(|i| (format!("x-scan-{i}"), "ok".to_string()))
            .collect();
        headers.push(("x-after-scan".to_string(), "ok".to_string()));

        let out = sanitized_plugin_headers(&headers);
        assert_eq!(out.len(), 64);
        assert!(out.iter().all(|(k, _)| *k != "x-after-scan"));
    }

    #[test]
    fn sanitized_headers_cap_total_forwarded_bytes() {
        let headers: Vec<(String, String)> = (0..20)
            .map(|i| (format!("x-header-{i:03}"), "a".repeat(16_000)))
            .collect();

        let out = sanitized_plugin_headers(&headers);
        assert_eq!(out.len(), 16);
        assert_eq!(out[0].0, "x-header-000");
        assert_eq!(out[15].0, "x-header-015");
        assert!(out.iter().all(|(k, _)| *k != "x-header-016"));
    }

    #[test]
    fn normalize_base_url_accepts_valid_numeric_port_and_ipv6_authority() {
        let with_port = normalize_base_url("https://api.openai.com:443/").unwrap();
        assert_eq!(with_port, "https://api.openai.com:443");

        let ipv6 = normalize_base_url("http://[::1]:11434/").unwrap();
        assert_eq!(ipv6, "http://[::1]:11434");
    }

    #[test]
    fn join_base_url_and_path_trims_surrounding_whitespace() {
        let url = join_base_url_and_path(" https://api.openai.com/ ", " /v1/chat/completions ");
        assert_eq!(url, "https://api.openai.com/v1/chat/completions");
    }

    #[test]
    fn auth_policy_treats_trimmed_ollama_as_no_host_auth() {
        assert!(!use_anthropic_auth("ollama"));
        assert!(!use_openai_auth("ollama"));

        assert!(!use_anthropic_auth(" ollama "));
        assert!(!use_openai_auth(" ollama "));
    }

    #[test]
    fn auth_policy_treats_trimmed_anthropic_as_anthropic_auth() {
        assert!(use_anthropic_auth("anthropic"));
        assert!(!use_openai_auth("anthropic"));

        assert!(use_anthropic_auth(" anthropic "));
        assert!(!use_openai_auth(" anthropic "));

        assert!(use_anthropic_auth("Anthropic"));
        assert!(!use_openai_auth("Anthropic"));
    }

    #[test]
    fn auth_policy_allows_openai_family_only() {
        assert!(use_openai_auth("openai"));
        assert!(use_openai_auth("openai-codex"));
        assert!(use_openai_auth("OpenAI-Codex"));
        assert!(!use_openai_auth("custom-openai-compatible"));
        assert!(!use_openai_auth("ollama"));
    }

    #[test]
    fn sanitize_auth_token_for_header_filters_invalid_values() {
        assert_eq!(sanitize_auth_token_for_header("token123"), Some("token123".to_string()));

        let blocked = [
            "",
            "   ",
            " token123 ",
            "token with space",
            "token\nvalue",
            "tøken",
        ];
        for token in blocked {
            assert_eq!(sanitize_auth_token_for_header(token), None);
        }

        assert_eq!(sanitize_auth_token_for_header(&"a".repeat(4097)), None);
    }

    #[test]
    fn openai_auth_header_from_env_requires_valid_token_when_set() {
        let _guard = ENV_LOCK.lock().unwrap();
        let prev = std::env::var("OPENAI_API_KEY").ok();

        std::env::remove_var("OPENAI_API_KEY");
        assert_eq!(openai_auth_header_from_env().unwrap(), None);

        std::env::set_var("OPENAI_API_KEY", " key123 ");
        let err = openai_auth_header_from_env().unwrap_err();
        assert!(err.contains("invalid OPENAI_API_KEY"));

        std::env::set_var("OPENAI_API_KEY", "key123");
        assert_eq!(
            openai_auth_header_from_env().unwrap(),
            Some("Bearer key123".to_string())
        );

        if let Some(prev) = prev {
            std::env::set_var("OPENAI_API_KEY", prev);
        } else {
            std::env::remove_var("OPENAI_API_KEY");
        }
    }

    #[test]
    fn anthropic_api_key_from_env_requires_valid_token() {
        let _guard = ENV_LOCK.lock().unwrap();
        let prev = std::env::var("ANTHROPIC_API_KEY").ok();

        std::env::remove_var("ANTHROPIC_API_KEY");
        let err = anthropic_api_key_from_env().unwrap_err();
        assert!(err.contains("ANTHROPIC_API_KEY not set"));

        std::env::set_var("ANTHROPIC_API_KEY", " key123 ");
        let err = anthropic_api_key_from_env().unwrap_err();
        assert!(err.contains("invalid ANTHROPIC_API_KEY"));

        std::env::set_var("ANTHROPIC_API_KEY", "key123");
        assert_eq!(anthropic_api_key_from_env().unwrap(), "key123");

        if let Some(prev) = prev {
            std::env::set_var("ANTHROPIC_API_KEY", prev);
        } else {
            std::env::remove_var("ANTHROPIC_API_KEY");
        }
    }
