    use super::*;

    static ENV_LOCK: std::sync::LazyLock<std::sync::Mutex<()>> =
        std::sync::LazyLock::new(|| std::sync::Mutex::new(()));

    fn reset_llm_env() {
        for k in ["LLM_PROVIDER", "LLM_DEFAULT_PROVIDER", "LLM_BASE_URL"] {
            std::env::remove_var(k);
        }
    }

    #[test]
    fn expected_route_defaults_to_ollama() {
        let _guard = ENV_LOCK.lock().unwrap();
        reset_llm_env();
        let route = expected_llm_route_from_env();
        assert_eq!(
            route,
            LlmRoute {
                provider: "ollama".to_string(),
                base_url: "http://localhost:11434".to_string(),
                path: "/v1/chat/completions".to_string(),
            }
        );
    }

    #[test]
    fn expected_route_trims_provider_from_env() {
        let _guard = ENV_LOCK.lock().unwrap();
        reset_llm_env();
        std::env::set_var("LLM_PROVIDER", "  openai  ");

        let route = expected_llm_route_from_env();
        assert_eq!(route.provider, "openai");
        assert_eq!(route.base_url, "https://api.openai.com");
        assert_eq!(route.path, "/v1/chat/completions");

        reset_llm_env();
    }

    #[test]
    fn expected_route_normalizes_provider_case_from_env() {
        let _guard = ENV_LOCK.lock().unwrap();
        reset_llm_env();
        std::env::set_var("LLM_PROVIDER", "OpenAI");

        let route = expected_llm_route_from_env();
        assert_eq!(route.provider, "openai");
        assert_eq!(route.base_url, "https://api.openai.com");

        reset_llm_env();
    }

    #[test]
    fn expected_route_uses_default_provider_when_primary_is_blank() {
        let _guard = ENV_LOCK.lock().unwrap();
        reset_llm_env();
        std::env::set_var("LLM_PROVIDER", "   ");
        std::env::set_var("LLM_DEFAULT_PROVIDER", " openai ");

        let route = expected_llm_route_from_env();
        assert_eq!(route.provider, "openai");
        assert_eq!(route.base_url, "https://api.openai.com");

        reset_llm_env();
    }

    #[test]
    fn expected_route_uses_openai_family_default_provider_when_primary_is_blank() {
        let _guard = ENV_LOCK.lock().unwrap();
        reset_llm_env();
        std::env::set_var("LLM_PROVIDER", "   ");
        std::env::set_var("LLM_DEFAULT_PROVIDER", " openai-codex ");

        let route = expected_llm_route_from_env();
        assert_eq!(route.provider, "openai-codex");
        assert_eq!(route.base_url, "https://api.openai.com");
        assert_eq!(route.path, "/v1/chat/completions");

        reset_llm_env();
    }

    #[test]
    fn expected_route_ignores_invalid_primary_provider_and_uses_valid_default() {
        let _guard = ENV_LOCK.lock().unwrap();
        reset_llm_env();
        std::env::set_var("LLM_PROVIDER", "open ai");
        std::env::set_var("LLM_DEFAULT_PROVIDER", "openai");

        let route = expected_llm_route_from_env();
        assert_eq!(route.provider, "openai");
        assert_eq!(route.base_url, "https://api.openai.com");

        reset_llm_env();
    }

    #[test]
    fn expected_route_falls_back_to_ollama_when_provider_env_tokens_are_invalid() {
        let _guard = ENV_LOCK.lock().unwrap();
        reset_llm_env();
        std::env::set_var("LLM_PROVIDER", "open ai");
        std::env::set_var("LLM_DEFAULT_PROVIDER", "opénaí");

        let route = expected_llm_route_from_env();
        assert_eq!(route.provider, "ollama");
        assert_eq!(route.base_url, "http://localhost:11434");

        reset_llm_env();
    }

    #[test]
    fn expected_route_defaults_openai_family_to_openai_base_url() {
        let _guard = ENV_LOCK.lock().unwrap();
        reset_llm_env();
        std::env::set_var("LLM_PROVIDER", "openai-codex");

        let route = expected_llm_route_from_env();
        assert_eq!(route.provider, "openai-codex");
        assert_eq!(route.base_url, "https://api.openai.com");
        assert_eq!(route.path, "/v1/chat/completions");

        reset_llm_env();
    }

    #[test]
    fn enforce_route_blocks_provider_mismatch() {
        let expected = LlmRoute {
            provider: "openai".to_string(),
            base_url: "https://api.openai.com".to_string(),
            path: "/v1/chat/completions".to_string(),
        };
        let err = enforce_llm_route(
            "ollama",
            "https://api.openai.com",
            "/v1/chat/completions",
            &expected,
        )
        .unwrap_err();
        assert!(err.contains("provider mismatch"));
    }

    #[test]
    fn enforce_route_blocks_provider_with_control_chars() {
        let expected = LlmRoute {
            provider: "openai".to_string(),
            base_url: "https://api.openai.com".to_string(),
            path: "/v1/chat/completions".to_string(),
        };
        let err = enforce_llm_route(
            "open\nai",
            "https://api.openai.com",
            "/v1/chat/completions",
            &expected,
        )
        .unwrap_err();
        assert!(err.contains("control characters"));
    }

    #[test]
    fn enforce_route_blocks_provider_with_invalid_chars() {
        let expected = LlmRoute {
            provider: "openai".to_string(),
            base_url: "https://api.openai.com".to_string(),
            path: "/v1/chat/completions".to_string(),
        };
        let err = enforce_llm_route(
            "openai!",
            "https://api.openai.com",
            "/v1/chat/completions",
            &expected,
        )
        .unwrap_err();
        assert!(err.contains("invalid characters"));
    }

    #[test]
    fn enforce_route_blocks_expected_provider_with_invalid_chars() {
        let expected = LlmRoute {
            provider: "open ai".to_string(),
            base_url: "https://api.openai.com".to_string(),
            path: "/v1/chat/completions".to_string(),
        };
        let err = enforce_llm_route(
            "openai",
            "https://api.openai.com",
            "/v1/chat/completions",
            &expected,
        )
        .unwrap_err();
        assert!(err.contains("invalid characters"));
    }

    #[test]
    fn enforce_route_blocks_overlong_provider_token() {
        let expected = LlmRoute {
            provider: "openai".to_string(),
            base_url: "https://api.openai.com".to_string(),
            path: "/v1/chat/completions".to_string(),
        };
        let err = enforce_llm_route(
            &"a".repeat(65),
            "https://api.openai.com",
            "/v1/chat/completions",
            &expected,
        )
        .unwrap_err();
        assert!(err.contains("invalid characters"));
    }

    #[test]
    fn enforce_route_blocks_base_url_with_control_chars() {
        let expected = LlmRoute {
            provider: "openai".to_string(),
            base_url: "https://api.openai.com".to_string(),
            path: "/v1/chat/completions".to_string(),
        };
        let err = enforce_llm_route(
            "openai",
            "https://api.openai.com\n",
            "/v1/chat/completions",
            &expected,
        )
        .unwrap_err();
        assert!(err.contains("base_url contains control characters"));
    }

    #[test]
    fn enforce_route_blocks_path_with_control_chars() {
        let expected = LlmRoute {
            provider: "openai".to_string(),
            base_url: "https://api.openai.com".to_string(),
            path: "/v1/chat/completions".to_string(),
        };
        let err = enforce_llm_route(
            "openai",
            "https://api.openai.com",
            "/v1/chat/completions\n",
            &expected,
        )
        .unwrap_err();
        assert!(err.contains("path contains control characters"));
    }

    #[test]
    fn enforce_route_blocks_non_ascii_path() {
        let expected = LlmRoute {
            provider: "openai".to_string(),
            base_url: "https://api.openai.com".to_string(),
            path: "/v1/chat/completions".to_string(),
        };
        let err = enforce_llm_route("openai", "https://api.openai.com", "/v1/chát", &expected)
            .unwrap_err();
        assert!(err.contains("path must be ascii"));
    }

    #[test]
    fn enforce_route_blocks_non_ascii_expected_path() {
        let expected = LlmRoute {
            provider: "openai".to_string(),
            base_url: "https://api.openai.com".to_string(),
            path: "/v1/chát".to_string(),
        };
        let err = enforce_llm_route(
            "openai",
            "https://api.openai.com",
            "/v1/chat/completions",
            &expected,
        )
        .unwrap_err();
        assert!(err.contains("path must be ascii"));
    }

    #[test]
    fn enforce_route_blocks_empty_path() {
        let expected = LlmRoute {
            provider: "openai".to_string(),
            base_url: "https://api.openai.com".to_string(),
            path: "/v1/chat/completions".to_string(),
        };
        let err = enforce_llm_route("openai", "https://api.openai.com", "   ", &expected)
            .unwrap_err();
        assert!(err.contains("path must be non-empty"));
    }

    #[test]
    fn enforce_route_blocks_empty_expected_path() {
        let expected = LlmRoute {
            provider: "openai".to_string(),
            base_url: "https://api.openai.com".to_string(),
            path: " ".to_string(),
        };
        let err = enforce_llm_route(
            "openai",
            "https://api.openai.com",
            "/v1/chat/completions",
            &expected,
        )
        .unwrap_err();
        assert!(err.contains("path must be non-empty"));
    }

    #[test]
    fn enforce_route_blocks_path_with_query_or_fragment() {
        let expected = LlmRoute {
            provider: "openai".to_string(),
            base_url: "https://api.openai.com".to_string(),
            path: "/v1/chat/completions".to_string(),
        };

        let err_query = enforce_llm_route(
            "openai",
            "https://api.openai.com",
            "/v1/chat/completions?stream=true",
            &expected,
        )
        .unwrap_err();
        assert!(err_query.contains("path must not include query or fragment"));

        let err_fragment = enforce_llm_route(
            "openai",
            "https://api.openai.com",
            "/v1/chat/completions#frag",
            &expected,
        )
        .unwrap_err();
        assert!(err_fragment.contains("path must not include query or fragment"));
    }

    #[test]
    fn enforce_route_blocks_path_with_invalid_separator() {
        let expected = LlmRoute {
            provider: "openai".to_string(),
            base_url: "https://api.openai.com".to_string(),
            path: "/v1/chat/completions".to_string(),
        };

        let err = enforce_llm_route(
            "openai",
            "https://api.openai.com",
            "\\v1\\chat\\completions",
            &expected,
        )
        .unwrap_err();
        assert!(err.contains("invalid separator"));
    }

    #[test]
    fn enforce_route_blocks_overlong_base_url() {
        let expected = LlmRoute {
            provider: "openai".to_string(),
            base_url: "https://api.openai.com".to_string(),
            path: "/v1/chat/completions".to_string(),
        };
        let overlong = format!("https://{}", "a".repeat(2100));
        let err = enforce_llm_route("openai", &overlong, "/v1/chat/completions", &expected)
            .unwrap_err();
        assert!(err.contains("base_url too long"));
    }

    #[test]
    fn enforce_route_blocks_overlong_path() {
        let expected = LlmRoute {
            provider: "openai".to_string(),
            base_url: "https://api.openai.com".to_string(),
            path: "/v1/chat/completions".to_string(),
        };
        let overlong = format!("/{}", "a".repeat(2100));
        let err = enforce_llm_route("openai", "https://api.openai.com", &overlong, &expected)
            .unwrap_err();
        assert!(err.contains("path too long"));
    }

    #[test]
    fn enforce_route_blocks_base_url_mismatch() {
        let expected = LlmRoute {
            provider: "openai".to_string(),
            base_url: "https://api.openai.com".to_string(),
            path: "/v1/chat/completions".to_string(),
        };
        let err = enforce_llm_route(
            "openai",
            "https://attacker.example",
            "/v1/chat/completions",
            &expected,
        )
        .unwrap_err();
        assert!(err.contains("base_url not allowed"));
    }

    #[test]
    fn enforce_route_blocks_path_mismatch() {
        let expected = LlmRoute {
            provider: "openai".to_string(),
            base_url: "https://api.openai.com".to_string(),
            path: "/v1/chat/completions".to_string(),
        };
        let err = enforce_llm_route(
            "openai",
            "https://api.openai.com",
            "/v1/responses",
            &expected,
        )
        .unwrap_err();
        assert!(err.contains("path not allowed"));
    }

    #[test]
    fn enforce_route_blocks_non_http_base_url() {
        let expected = LlmRoute {
            provider: "openai".to_string(),
            base_url: "https://api.openai.com".to_string(),
            path: "/v1/chat/completions".to_string(),
        };
        let err = enforce_llm_route(
            "openai",
            "file:///tmp/evil",
            "/v1/chat/completions",
            &expected,
        )
        .unwrap_err();
        assert!(err.contains("base_url must use http(s)"));
    }

    #[test]
    fn enforce_route_blocks_invalid_base_url_forms() {
        let expected = LlmRoute {
            provider: "openai".to_string(),
            base_url: "https://api.openai.com".to_string(),
            path: "/v1/chat/completions".to_string(),
        };

        let cases = [
            ("missing_host", "https:///", "must include host"),
            (
                "embedded_credentials",
                "https://user:pass@api.openai.com",
                "must not include credentials",
            ),
            (
                "invalid_authority_chars",
                "https://api.openai.com\\evil",
                "invalid authority characters",
            ),
            (
                "non_ascii_base_url",
                "https://api.öpenai.com",
                "base_url must be ascii",
            ),
            (
                "host_label_starts_with_dash",
                "https://-api.openai.com",
                "invalid authority characters",
            ),
            (
                "host_label_ends_with_dash",
                "https://api-.openai.com",
                "invalid authority characters",
            ),
            (
                "host_has_empty_label",
                "https://api..openai.com",
                "invalid authority characters",
            ),
            (
                "host_trailing_dot",
                "https://api.openai.com.",
                "invalid authority characters",
            ),
            (
                "bracketed_non_ipv6_literal",
                "https://[abcd]",
                "invalid authority characters",
            ),
            (
                "bracketed_ipv6_invalid_colon_layout",
                "https://[::::]",
                "invalid authority characters",
            ),
            (
                "bracketed_ipv6_too_many_segments",
                "https://[1:2:3:4:5:6:7:8:9]",
                "invalid authority characters",
            ),
            (
                "port_non_numeric",
                "https://api.openai.com:abc",
                "invalid authority characters",
            ),
            (
                "port_out_of_range",
                "https://api.openai.com:70000",
                "invalid authority characters",
            ),
            (
                "port_empty",
                "https://api.openai.com:",
                "invalid authority characters",
            ),
            (
                "query",
                "https://api.openai.com?x=1",
                "must not include query or fragment",
            ),
            (
                "fragment",
                "https://api.openai.com#frag",
                "must not include query or fragment",
            ),
            (
                "path_segments",
                "https://api.openai.com/v1",
                "base_url must not include path",
            ),
        ];

        for (case, requested_base_url, expected_msg) in cases {
            let err = enforce_llm_route(
                "openai",
                requested_base_url,
                "/v1/chat/completions",
                &expected,
            )
            .unwrap_err();
            assert!(
                err.contains(expected_msg),
                "case {case} expected '{expected_msg}', got: {err}"
            );
        }
    }

    #[test]
    fn enforce_route_blocks_expected_base_url_with_path_segments() {
        let expected = LlmRoute {
            provider: "openai".to_string(),
            base_url: "https://api.openai.com/v1".to_string(),
            path: "/v1/chat/completions".to_string(),
        };

        let err = enforce_llm_route(
            "openai",
            "https://api.openai.com",
            "/v1/chat/completions",
            &expected,
        )
        .unwrap_err();
        assert!(err.contains("base_url must not include path"));
    }

    #[test]
    fn enforce_route_accepts_path_without_leading_slash() {
        let expected = LlmRoute {
            provider: "openai".to_string(),
            base_url: "https://api.openai.com".to_string(),
            path: "/v1/chat/completions".to_string(),
        };
        let result = enforce_llm_route(
            "openai",
            "https://api.openai.com",
            "v1/chat/completions",
            &expected,
        );
        assert!(result.is_ok());
    }

    #[test]
    fn enforce_route_accepts_base_url_with_trailing_slash() {
        let expected = LlmRoute {
            provider: "openai".to_string(),
            base_url: "https://api.openai.com".to_string(),
            path: "/v1/chat/completions".to_string(),
        };
        let result = enforce_llm_route(
            "openai",
            "https://api.openai.com/",
            "/v1/chat/completions",
            &expected,
        );
        assert!(result.is_ok());
    }

    #[test]
    fn enforce_route_accepts_base_url_with_mixed_case_host() {
        let expected = LlmRoute {
            provider: "openai".to_string(),
            base_url: "https://api.openai.com".to_string(),
            path: "/v1/chat/completions".to_string(),
        };
        let result = enforce_llm_route(
            "openai",
            "https://API.OpenAI.com",
            "/v1/chat/completions",
            &expected,
        );
        assert!(result.is_ok());
    }

    #[test]
    fn enforce_route_accepts_base_url_with_uppercase_scheme() {
        let expected = LlmRoute {
            provider: "openai".to_string(),
            base_url: "https://api.openai.com".to_string(),
            path: "/v1/chat/completions".to_string(),
        };
        let result = enforce_llm_route(
            "openai",
            "HTTPS://api.openai.com",
            "/v1/chat/completions",
            &expected,
        );
        assert!(result.is_ok());
    }

    #[test]
    fn enforce_route_accepts_path_with_trailing_slash() {
        let expected = LlmRoute {
            provider: "openai".to_string(),
            base_url: "https://api.openai.com".to_string(),
            path: "/v1/chat/completions".to_string(),
        };
        let result = enforce_llm_route(
            "openai",
            "https://api.openai.com",
            "/v1/chat/completions/",
            &expected,
        );
        assert!(result.is_ok());
    }

    #[test]
    fn enforce_route_accepts_trimmed_provider_and_base_url() {
        let expected = LlmRoute {
            provider: "openai".to_string(),
            base_url: "https://api.openai.com".to_string(),
            path: "/v1/chat/completions".to_string(),
        };
        let result = enforce_llm_route(
            " openai ",
            " https://api.openai.com/ ",
            "v1/chat/completions",
            &expected,
        );
        assert!(result.is_ok());
    }

    #[test]
    fn enforce_route_blocks_path_with_surrounding_whitespace() {
        let expected = LlmRoute {
            provider: "openai".to_string(),
            base_url: "https://api.openai.com".to_string(),
            path: "/v1/chat/completions".to_string(),
        };
        let err = enforce_llm_route(
            "openai",
            "https://api.openai.com",
            "  v1/chat/completions  ",
            &expected,
        )
        .unwrap_err();
        assert!(err.contains("path contains surrounding whitespace"));
    }

    #[test]
    fn enforce_route_blocks_path_with_internal_whitespace() {
        let expected = LlmRoute {
            provider: "openai".to_string(),
            base_url: "https://api.openai.com".to_string(),
            path: "/v1/chat/completions".to_string(),
        };
        let err = enforce_llm_route(
            "openai",
            "https://api.openai.com",
            "/v1/chat/comp letions",
            &expected,
        )
        .unwrap_err();
        assert!(err.contains("path must not contain whitespace"));
    }

    #[test]
    fn enforce_route_blocks_expected_path_with_internal_whitespace() {
        let expected = LlmRoute {
            provider: "openai".to_string(),
            base_url: "https://api.openai.com".to_string(),
            path: "/v1/chat/comp letions".to_string(),
        };
        let err = enforce_llm_route(
            "openai",
            "https://api.openai.com",
            "/v1/chat/completions",
            &expected,
        )
        .unwrap_err();
        assert!(err.contains("path must not contain whitespace"));
    }

    #[test]
    fn enforce_route_accepts_mixed_case_provider_name() {
        let expected = LlmRoute {
            provider: "openai".to_string(),
            base_url: "https://api.openai.com".to_string(),
            path: "/v1/chat/completions".to_string(),
        };
        let result = enforce_llm_route(
            "OpenAI",
            "https://api.openai.com",
            "/v1/chat/completions",
            &expected,
        );
        assert!(result.is_ok());
    }

    #[test]
    fn llm_request_body_allows_size_within_limit() {
        let body = vec![b'a'; 1024 * 1024];
        assert!(enforce_llm_request_body(&body).is_ok());
    }

    #[test]
    fn llm_request_body_blocks_oversized_payload() {
        let body = vec![b'a'; 1024 * 1024 + 1];
        let err = enforce_llm_request_body(&body).unwrap_err();
        assert!(err.contains("body too large"));
    }

    #[test]
    fn read_limited_bytes_allows_payload_within_limit() {
        let payload = vec![b'x'; 16];
        let out = read_limited_bytes(std::io::Cursor::new(payload.clone()), 16, "payload").unwrap();
        assert_eq!(out, payload);
    }

    #[test]
    fn read_limited_bytes_blocks_payload_over_limit() {
        let payload = vec![b'x'; 17];
        let err = read_limited_bytes(std::io::Cursor::new(payload), 16, "payload").unwrap_err();
        assert!(err.contains("payload too large"));
    }

    #[test]
    fn llm_error_body_preview_keeps_small_body() {
        let body = b"small error".to_vec();
        let preview = llm_error_body_preview(&body);
        assert_eq!(preview, "small error");
    }

    #[test]
    fn llm_error_body_preview_truncates_large_body() {
        let body = vec![b'a'; 8 * 1024 + 128];
        let preview = llm_error_body_preview(&body);
        assert!(preview.starts_with(&"a".repeat(32)));
        assert!(preview.contains("[truncated: llm-bridge error body exceeded 8192 bytes]"));
    }

    #[test]
    fn sanitized_headers_drop_sensitive_auth_keys() {
        let headers = vec![
            ("content-type".to_string(), "application/json".to_string()),
            ("authorization".to_string(), "Bearer fake".to_string()),
            ("x-authorization".to_string(), "Bearer fake".to_string()),
            ("authentication".to_string(), "Bearer fake".to_string()),
            ("x-api-key".to_string(), "fake-key".to_string()),
            ("x-api-token".to_string(), "fake-key".to_string()),
            ("x-api-secret".to_string(), "fake-key".to_string()),
            ("x-auth-secret".to_string(), "fake-key".to_string()),
            ("x-webhook-secret".to_string(), "fake-key".to_string()),
            ("api-key".to_string(), "fake-key".to_string()),
            ("x-auth-token".to_string(), "fake-key".to_string()),
            ("x-authentication-token".to_string(), "fake-key".to_string()),
            ("x-github-token".to_string(), "fake-key".to_string()),
            ("x-gitlab-token".to_string(), "fake-key".to_string()),
            ("x-bitbucket-token".to_string(), "fake-key".to_string()),
            ("x-ci-job-token".to_string(), "fake-key".to_string()),
            ("x-circleci-token".to_string(), "fake-key".to_string()),
            ("x-access-token".to_string(), "fake-key".to_string()),
            ("x-session-token".to_string(), "fake-key".to_string()),
            ("x-id-token".to_string(), "fake-key".to_string()),
            ("x-amz-security-token".to_string(), "fake-key".to_string()),
            ("x-ms-client-principal".to_string(), "jwt".to_string()),
            ("x-ms-client-principal-id".to_string(), "alice".to_string()),
            ("x-ms-client-principal-name".to_string(), "alice".to_string()),
            ("x-ms-client-principal-idp".to_string(), "aad".to_string()),
            ("x-ms-token-aad-id-token".to_string(), "jwt".to_string()),
            ("x-ms-token-aad-access-token".to_string(), "jwt".to_string()),
            ("x-ms-token-aad-refresh-token".to_string(), "jwt".to_string()),
            ("x-ms-token-aad-expires-on".to_string(), "1700000000".to_string()),
            ("cf-access-jwt-assertion".to_string(), "jwt".to_string()),
            ("x-goog-iap-jwt-assertion".to_string(), "jwt".to_string()),
            (
                "x-goog-authenticated-user-email".to_string(),
                "accounts.google.com:alice@example.com".to_string(),
            ),
            (
                "x-goog-authenticated-user-id".to_string(),
                "accounts.google.com:123".to_string(),
            ),
            (
                "x-google-authenticated-user-email".to_string(),
                "accounts.google.com:alice@example.com".to_string(),
            ),
            (
                "x-google-authenticated-user-id".to_string(),
                "accounts.google.com:123".to_string(),
            ),
            ("x-amzn-oidc-data".to_string(), "jwt".to_string()),
            ("x-amzn-oidc-identity".to_string(), "sub".to_string()),
            ("x-amzn-oidc-accesstoken".to_string(), "jwt".to_string()),
            ("x-forwarded-user".to_string(), "alice".to_string()),
            ("x-forwarded-user-id".to_string(), "alice-id".to_string()),
            ("x-forwarded-userid".to_string(), "alice-id".to_string()),
            (
                "x-forwarded-user-email".to_string(),
                "alice@example.com".to_string(),
            ),
            ("x-forwarded-groups".to_string(), "admins".to_string()),
            ("x-remote-user".to_string(), "alice".to_string()),
            ("x-remote-userid".to_string(), "alice-id".to_string()),
            ("x-remote-email".to_string(), "alice@example.com".to_string()),
            ("x-remote-groups".to_string(), "admins".to_string()),
            ("x-original-user".to_string(), "alice".to_string()),
            ("x-original-groups".to_string(), "admins".to_string()),
            ("x-auth-user".to_string(), "alice".to_string()),
            ("x-auth-userid".to_string(), "alice-id".to_string()),
            ("x-auth-email".to_string(), "alice@example.com".to_string()),
            ("x-auth-request-user".to_string(), "alice".to_string()),
            ("x-auth-request-user-id".to_string(), "alice-id".to_string()),
            ("x-auth-request-uid".to_string(), "123".to_string()),
            ("x-auth-request-name".to_string(), "alice".to_string()),
            ("x-auth-request-email".to_string(), "alice@example.com".to_string()),
            (
                "x-auth-request-preferred-username".to_string(),
                "alice".to_string(),
            ),
            ("x-auth-request-groups".to_string(), "admins".to_string()),
            ("impersonate-user".to_string(), "alice".to_string()),
            ("impersonate-group".to_string(), "admins".to_string()),
            ("impersonate-uid".to_string(), "123".to_string()),
            (
                "impersonate-extra-scopes".to_string(),
                "view,edit".to_string(),
            ),
            (
                "x-auth-request-access-token".to_string(),
                "jwt".to_string(),
            ),
            ("x-forwarded-email".to_string(), "alice@example.com".to_string()),
            ("x-forwarded-access-token".to_string(), "jwt".to_string()),
            (
                "cf-access-authenticated-user-email".to_string(),
                "alice@example.com".to_string(),
            ),
            (
                "cf-access-authenticated-user-id".to_string(),
                "123".to_string(),
            ),
            ("x-authenticated-userid".to_string(), "alice".to_string()),
            ("x-authenticated-user-id".to_string(), "alice".to_string()),
            ("x-authenticated-user".to_string(), "alice".to_string()),
            ("x-authenticated-user-name".to_string(), "alice".to_string()),
            ("x-authenticated-user-email".to_string(), "alice@example.com".to_string()),
            ("x-authenticated-email".to_string(), "alice@example.com".to_string()),
            ("x-authenticated-groups".to_string(), "admins".to_string()),
            ("x-verified-user".to_string(), "alice".to_string()),
            ("x-verified-email".to_string(), "alice@example.com".to_string()),
            ("x-end-user".to_string(), "alice".to_string()),
            ("x-end-userid".to_string(), "alice-id".to_string()),
            ("x-end-user-email".to_string(), "alice@example.com".to_string()),
            ("x-user-id".to_string(), "alice".to_string()),
            ("x-userid".to_string(), "alice-id".to_string()),
            ("x-user".to_string(), "alice".to_string()),
            ("x-user-name".to_string(), "alice".to_string()),
            ("x-user-email".to_string(), "alice@example.com".to_string()),
            ("x-user-groups".to_string(), "admins".to_string()),
            ("x-principal".to_string(), "alice".to_string()),
            ("x-principal-id".to_string(), "alice-id".to_string()),
            ("x-principal-name".to_string(), "alice".to_string()),
            ("x-gitlab-user-id".to_string(), "123".to_string()),
            ("x-gitlab-username".to_string(), "alice".to_string()),
            ("x-gitlab-user-login".to_string(), "alice".to_string()),
            ("x-gitlab-user-name".to_string(), "alice".to_string()),
            (
                "x-gitlab-user-email".to_string(),
                "alice@example.com".to_string(),
            ),
            ("x-github-user-id".to_string(), "123".to_string()),
            ("x-github-login".to_string(), "alice".to_string()),
            ("x-github-user-name".to_string(), "alice".to_string()),
            (
                "x-github-user-email".to_string(),
                "alice@example.com".to_string(),
            ),
            ("x-bitbucket-user".to_string(), "alice".to_string()),
            ("x-bitbucket-user-login".to_string(), "alice".to_string()),
            ("x-bitbucket-uuid".to_string(), "uuid-123".to_string()),
            (
                "x-bitbucket-user-email".to_string(),
                "alice@example.com".to_string(),
            ),
            ("x-client-verify".to_string(), "SUCCESS".to_string()),
            ("x-client-dn".to_string(), "CN=alice".to_string()),
            (
                "x-client-cert-chain".to_string(),
                "-----BEGIN CERTIFICATE-----...".to_string(),
            ),
            ("x-ssl-client-verify".to_string(), "SUCCESS".to_string()),
            ("x-ssl-client-dn".to_string(), "CN=alice".to_string()),
            ("x-ssl-client-s-dn".to_string(), "CN=alice".to_string()),
            ("x-ssl-client-i-dn".to_string(), "CN=Refarm CA".to_string()),
            ("x-ssl-client-san".to_string(), "DNS:alice".to_string()),
            ("cookie".to_string(), "session=abc".to_string()),
            ("set-cookie".to_string(), "session=abc".to_string()),
        ];
        let out = sanitized_plugin_headers(&headers);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].0, "content-type");
    }

    #[test]
    fn sanitized_headers_drop_sensitive_auth_keys_case_insensitive() {
        let headers = vec![
            ("Content-Type".to_string(), "application/json".to_string()),
            ("Authorization".to_string(), "Bearer fake".to_string()),
            ("X-Authorization".to_string(), "Bearer fake".to_string()),
            ("Authentication".to_string(), "Bearer fake".to_string()),
            ("X-API-KEY".to_string(), "fake-key".to_string()),
            ("X-API-TOKEN".to_string(), "fake-key".to_string()),
            ("X-API-SECRET".to_string(), "fake-key".to_string()),
            ("X-AUTH-SECRET".to_string(), "fake-key".to_string()),
            ("X-WEBHOOK-SECRET".to_string(), "fake-key".to_string()),
            ("API-KEY".to_string(), "fake-key".to_string()),
            ("X-AUTH-TOKEN".to_string(), "fake-key".to_string()),
            ("X-AUTHENTICATION-TOKEN".to_string(), "fake-key".to_string()),
            ("X-GITHUB-TOKEN".to_string(), "fake-key".to_string()),
            ("X-GITLAB-TOKEN".to_string(), "fake-key".to_string()),
            ("X-BITBUCKET-TOKEN".to_string(), "fake-key".to_string()),
            ("X-CI-JOB-TOKEN".to_string(), "fake-key".to_string()),
            ("X-CIRCLECI-TOKEN".to_string(), "fake-key".to_string()),
            ("X-ACCESS-TOKEN".to_string(), "fake-key".to_string()),
            ("X-SESSION-TOKEN".to_string(), "fake-key".to_string()),
            ("X-ID-TOKEN".to_string(), "fake-key".to_string()),
            ("X-AMZ-SECURITY-TOKEN".to_string(), "fake-key".to_string()),
            ("X-MS-CLIENT-PRINCIPAL".to_string(), "jwt".to_string()),
            ("X-MS-CLIENT-PRINCIPAL-ID".to_string(), "alice".to_string()),
            ("X-MS-CLIENT-PRINCIPAL-NAME".to_string(), "alice".to_string()),
            ("X-MS-CLIENT-PRINCIPAL-IDP".to_string(), "aad".to_string()),
            ("X-MS-TOKEN-AAD-ID-TOKEN".to_string(), "jwt".to_string()),
            ("X-MS-TOKEN-AAD-ACCESS-TOKEN".to_string(), "jwt".to_string()),
            ("X-MS-TOKEN-AAD-REFRESH-TOKEN".to_string(), "jwt".to_string()),
            ("X-MS-TOKEN-AAD-EXPIRES-ON".to_string(), "1700000000".to_string()),
            ("CF-ACCESS-JWT-ASSERTION".to_string(), "jwt".to_string()),
            ("X-GOOG-IAP-JWT-ASSERTION".to_string(), "jwt".to_string()),
            (
                "X-GOOG-AUTHENTICATED-USER-EMAIL".to_string(),
                "accounts.google.com:alice@example.com".to_string(),
            ),
            (
                "X-GOOG-AUTHENTICATED-USER-ID".to_string(),
                "accounts.google.com:123".to_string(),
            ),
            (
                "X-GOOGLE-AUTHENTICATED-USER-EMAIL".to_string(),
                "accounts.google.com:alice@example.com".to_string(),
            ),
            (
                "X-GOOGLE-AUTHENTICATED-USER-ID".to_string(),
                "accounts.google.com:123".to_string(),
            ),
            ("X-AMZN-OIDC-DATA".to_string(), "jwt".to_string()),
            ("X-AMZN-OIDC-IDENTITY".to_string(), "sub".to_string()),
            ("X-AMZN-OIDC-ACCESSTOKEN".to_string(), "jwt".to_string()),
            ("X-FORWARDED-USER".to_string(), "alice".to_string()),
            ("X-FORWARDED-USER-ID".to_string(), "alice-id".to_string()),
            ("X-FORWARDED-USERID".to_string(), "alice-id".to_string()),
            (
                "X-FORWARDED-USER-EMAIL".to_string(),
                "alice@example.com".to_string(),
            ),
            ("X-FORWARDED-GROUPS".to_string(), "admins".to_string()),
            ("X-REMOTE-USER".to_string(), "alice".to_string()),
            ("X-REMOTE-USERID".to_string(), "alice-id".to_string()),
            ("X-REMOTE-EMAIL".to_string(), "alice@example.com".to_string()),
            ("X-REMOTE-GROUPS".to_string(), "admins".to_string()),
            ("X-ORIGINAL-USER".to_string(), "alice".to_string()),
            ("X-ORIGINAL-GROUPS".to_string(), "admins".to_string()),
            ("X-AUTH-USER".to_string(), "alice".to_string()),
            ("X-AUTH-USERID".to_string(), "alice-id".to_string()),
            ("X-AUTH-EMAIL".to_string(), "alice@example.com".to_string()),
            ("X-AUTH-REQUEST-USER".to_string(), "alice".to_string()),
            ("X-AUTH-REQUEST-USER-ID".to_string(), "alice-id".to_string()),
            ("X-AUTH-REQUEST-UID".to_string(), "123".to_string()),
            ("X-AUTH-REQUEST-NAME".to_string(), "alice".to_string()),
            ("X-AUTH-REQUEST-EMAIL".to_string(), "alice@example.com".to_string()),
            (
                "X-AUTH-REQUEST-PREFERRED-USERNAME".to_string(),
                "alice".to_string(),
            ),
            ("X-AUTH-REQUEST-GROUPS".to_string(), "admins".to_string()),
            ("IMPERSONATE-USER".to_string(), "alice".to_string()),
            ("IMPERSONATE-GROUP".to_string(), "admins".to_string()),
            ("IMPERSONATE-UID".to_string(), "123".to_string()),
            (
                "IMPERSONATE-EXTRA-SCOPES".to_string(),
                "view,edit".to_string(),
            ),
            (
                "X-AUTH-REQUEST-ACCESS-TOKEN".to_string(),
                "jwt".to_string(),
            ),
            ("X-FORWARDED-EMAIL".to_string(), "alice@example.com".to_string()),
            ("X-FORWARDED-ACCESS-TOKEN".to_string(), "jwt".to_string()),
            (
                "CF-ACCESS-AUTHENTICATED-USER-EMAIL".to_string(),
                "alice@example.com".to_string(),
            ),
            ("CF-ACCESS-AUTHENTICATED-USER-ID".to_string(), "123".to_string()),
            ("X-AUTHENTICATED-USERID".to_string(), "alice".to_string()),
            ("X-AUTHENTICATED-USER-ID".to_string(), "alice".to_string()),
            ("X-AUTHENTICATED-USER".to_string(), "alice".to_string()),
            ("X-AUTHENTICATED-USER-NAME".to_string(), "alice".to_string()),
            ("X-AUTHENTICATED-USER-EMAIL".to_string(), "alice@example.com".to_string()),
            ("X-AUTHENTICATED-EMAIL".to_string(), "alice@example.com".to_string()),
            ("X-AUTHENTICATED-GROUPS".to_string(), "admins".to_string()),
            ("X-VERIFIED-USER".to_string(), "alice".to_string()),
            ("X-VERIFIED-EMAIL".to_string(), "alice@example.com".to_string()),
            ("X-END-USER".to_string(), "alice".to_string()),
            ("X-END-USERID".to_string(), "alice-id".to_string()),
            ("X-END-USER-EMAIL".to_string(), "alice@example.com".to_string()),
            ("X-USER-ID".to_string(), "alice".to_string()),
            ("X-USERID".to_string(), "alice-id".to_string()),
            ("X-USER".to_string(), "alice".to_string()),
            ("X-USER-NAME".to_string(), "alice".to_string()),
            ("X-USER-EMAIL".to_string(), "alice@example.com".to_string()),
            ("X-USER-GROUPS".to_string(), "admins".to_string()),
            ("X-PRINCIPAL".to_string(), "alice".to_string()),
            ("X-PRINCIPAL-ID".to_string(), "alice-id".to_string()),
            ("X-PRINCIPAL-NAME".to_string(), "alice".to_string()),
            ("X-GITLAB-USER-ID".to_string(), "123".to_string()),
            ("X-GITLAB-USERNAME".to_string(), "alice".to_string()),
            ("X-GITLAB-USER-LOGIN".to_string(), "alice".to_string()),
            ("X-GITLAB-USER-NAME".to_string(), "alice".to_string()),
            (
                "X-GITLAB-USER-EMAIL".to_string(),
                "alice@example.com".to_string(),
            ),
            ("X-GITHUB-USER-ID".to_string(), "123".to_string()),
            ("X-GITHUB-LOGIN".to_string(), "alice".to_string()),
            ("X-GITHUB-USER-NAME".to_string(), "alice".to_string()),
            (
                "X-GITHUB-USER-EMAIL".to_string(),
                "alice@example.com".to_string(),
            ),
            ("X-BITBUCKET-USER".to_string(), "alice".to_string()),
            ("X-BITBUCKET-USER-LOGIN".to_string(), "alice".to_string()),
            ("X-BITBUCKET-UUID".to_string(), "uuid-123".to_string()),
            (
                "X-BITBUCKET-USER-EMAIL".to_string(),
                "alice@example.com".to_string(),
            ),
            ("X-CLIENT-VERIFY".to_string(), "SUCCESS".to_string()),
            ("X-CLIENT-DN".to_string(), "CN=alice".to_string()),
            (
                "X-CLIENT-CERT-CHAIN".to_string(),
                "-----BEGIN CERTIFICATE-----...".to_string(),
            ),
            ("X-SSL-CLIENT-VERIFY".to_string(), "SUCCESS".to_string()),
            ("X-SSL-CLIENT-DN".to_string(), "CN=alice".to_string()),
            ("X-SSL-CLIENT-S-DN".to_string(), "CN=alice".to_string()),
            ("X-SSL-CLIENT-I-DN".to_string(), "CN=Refarm CA".to_string()),
            ("X-SSL-CLIENT-SAN".to_string(), "DNS:alice".to_string()),
            ("Cookie".to_string(), "session=abc".to_string()),
            ("Set-Cookie".to_string(), "session=abc".to_string()),
        ];
        let out = sanitized_plugin_headers(&headers);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].0, "Content-Type");
    }

    #[test]
    fn sanitized_headers_drop_sensitive_auth_keys_with_surrounding_spaces() {
        let headers = vec![
            (" content-type ".to_string(), "application/json".to_string()),
            (" authorization ".to_string(), "Bearer fake".to_string()),
            (" x-authorization ".to_string(), "Bearer fake".to_string()),
            (" authentication ".to_string(), "Bearer fake".to_string()),
            (" x-api-key ".to_string(), "fake-key".to_string()),
            (" x-api-token ".to_string(), "fake-key".to_string()),
            (" x-api-secret ".to_string(), "fake-key".to_string()),
            (" x-auth-secret ".to_string(), "fake-key".to_string()),
            (" x-webhook-secret ".to_string(), "fake-key".to_string()),
            (" api-key ".to_string(), "fake-key".to_string()),
            (" x-auth-token ".to_string(), "fake-key".to_string()),
            (
                " x-authentication-token ".to_string(),
                "fake-key".to_string(),
            ),
            (" x-github-token ".to_string(), "fake-key".to_string()),
            (" x-gitlab-token ".to_string(), "fake-key".to_string()),
            (" x-bitbucket-token ".to_string(), "fake-key".to_string()),
            (" x-ci-job-token ".to_string(), "fake-key".to_string()),
            (" x-circleci-token ".to_string(), "fake-key".to_string()),
            (" x-access-token ".to_string(), "fake-key".to_string()),
            (" x-session-token ".to_string(), "fake-key".to_string()),
            (" x-id-token ".to_string(), "fake-key".to_string()),
            (" x-amz-security-token ".to_string(), "fake-key".to_string()),
            (" x-ms-client-principal ".to_string(), "jwt".to_string()),
            (" x-ms-client-principal-id ".to_string(), "alice".to_string()),
            (
                " x-ms-client-principal-name ".to_string(),
                "alice".to_string(),
            ),
            (" x-ms-client-principal-idp ".to_string(), "aad".to_string()),
            (" x-ms-token-aad-id-token ".to_string(), "jwt".to_string()),
            (" x-ms-token-aad-access-token ".to_string(), "jwt".to_string()),
            (" x-ms-token-aad-refresh-token ".to_string(), "jwt".to_string()),
            (" x-ms-token-aad-expires-on ".to_string(), "1700000000".to_string()),
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
            (" x-client-dn ".to_string(), "CN=alice".to_string()),
            (
                " x-client-cert-chain ".to_string(),
                "-----BEGIN CERTIFICATE-----...".to_string(),
            ),
            (" x-ssl-client-verify ".to_string(), "SUCCESS".to_string()),
            (" x-ssl-client-dn ".to_string(), "CN=alice".to_string()),
            (" x-ssl-client-s-dn ".to_string(), "CN=alice".to_string()),
            (" x-ssl-client-i-dn ".to_string(), "CN=Refarm CA".to_string()),
            (" x-ssl-client-san ".to_string(), "DNS:alice".to_string()),
            (" cookie ".to_string(), "session=abc".to_string()),
            (" set-cookie ".to_string(), "session=abc".to_string()),
        ];
        let out = sanitized_plugin_headers(&headers);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].0, "content-type");
    }

    #[test]
    fn sanitized_headers_drop_identity_prefix_aliases() {
        let headers = vec![
            ("content-type".to_string(), "application/json".to_string()),
            ("x-forwarded-user-login".to_string(), "alice".to_string()),
            ("X-REMOTE-USER-NAME".to_string(), "alice".to_string()),
            (" x-auth-user-login ".to_string(), "alice".to_string()),
            (
                "X-AUTHENTICATED-USER-LOGIN".to_string(),
                "alice".to_string(),
            ),
            (" x-end-user-login ".to_string(), "alice".to_string()),
            ("X-USER-LOGIN".to_string(), "alice".to_string()),
            (" x-principal-email ".to_string(), "alice@example.com".to_string()),
            ("X-VERIFIED-USERID".to_string(), "alice-id".to_string()),
        ];
        let out = sanitized_plugin_headers(&headers);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].0, "content-type");
    }

    #[test]
    fn sanitized_headers_drop_ms_aad_header_prefix_aliases() {
        let headers = vec![
            ("content-type".to_string(), "application/json".to_string()),
            ("x-ms-client-principal-claims".to_string(), "...".to_string()),
            (
                "X-MS-TOKEN-AAD-TOKEN-TYPE".to_string(),
                "Bearer".to_string(),
            ),
            (
                " x-ms-token-aad-tenant-id ".to_string(),
                "tenant".to_string(),
            ),
        ];
        let out = sanitized_plugin_headers(&headers);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].0, "content-type");
    }

    #[test]
    fn sanitized_headers_drop_auth_request_prefix_aliases() {
        let headers = vec![
            ("content-type".to_string(), "application/json".to_string()),
            (
                "x-auth-request-claims".to_string(),
                "{\"sub\":\"alice\"}".to_string(),
            ),
            (
                " X-AUTH-REQUEST-TENANT-ID ".to_string(),
                "tenant-evil".to_string(),
            ),
        ];
        let out = sanitized_plugin_headers(&headers);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].0, "content-type");
    }

    #[test]
    fn sanitized_headers_drop_federated_identity_header_prefix_aliases() {
        let headers = vec![
            ("content-type".to_string(), "application/json".to_string()),
            (
                "x-goog-authenticated-user-name".to_string(),
                "accounts.google.com:alice".to_string(),
            ),
            (
                "X-GOOGLE-AUTHENTICATED-USER-NAME".to_string(),
                "accounts.google.com:alice".to_string(),
            ),
            (
                " cf-access-authenticated-user-name ".to_string(),
                "alice".to_string(),
            ),
            (
                "CF-Access-Client-Id".to_string(),
                "cf-access-client-id-evil".to_string(),
            ),
            (
                "cf-access-client-secret".to_string(),
                "cf-access-client-secret-evil".to_string(),
            ),
            ("X-AMZN-OIDC-SUB".to_string(), "alice-sub".to_string()),
        ];
        let out = sanitized_plugin_headers(&headers);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].0, "content-type");
    }

    #[test]
    fn sanitized_headers_drop_observability_auth_headers() {
        let headers = vec![
            ("content-type".to_string(), "application/json".to_string()),
            ("x-datadog-api-key".to_string(), "dd-api-key-evil".to_string()),
            (
                "X-Honeycomb-Team".to_string(),
                "honeycomb-team-key-evil".to_string(),
            ),
            (
                "x-newrelic-api-key".to_string(),
                "newrelic-key-evil".to_string(),
            ),
            ("X-Logdna-Apikey".to_string(), "logdna-key-evil".to_string()),
            (
                "x-rollbar-access-token".to_string(),
                "rollbar-token-evil".to_string(),
            ),
            ("X-Bugsnag-Api-Key".to_string(), "bugsnag-key-evil".to_string()),
            (
                "x-pagerduty-token".to_string(),
                "pagerduty-token-evil".to_string(),
            ),
            ("X-Grafana-Api-Key".to_string(), "grafana-key-evil".to_string()),
            ("x-otlp-api-key".to_string(), "otlp-api-key-evil".to_string()),
        ];
        let out = sanitized_plugin_headers(&headers);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].0, "content-type");
    }

    #[test]
    fn sanitized_headers_drop_tunnel_and_social_auth_headers() {
        let headers = vec![
            ("content-type".to_string(), "application/json".to_string()),
            ("ngrok-authtoken".to_string(), "ngrok-token-evil".to_string()),
            (
                "X-Tailscale-Authkey".to_string(),
                "tskey-auth-evil".to_string(),
            ),
            (
                "x-telegram-bot-api-secret-token".to_string(),
                "telegram-secret-evil".to_string(),
            ),
            (
                "X-Telegram-Api-Hash".to_string(),
                "telegram-api-hash-evil".to_string(),
            ),
            ("x-supabase-api-key".to_string(), "sb-key-evil".to_string()),
            (
                "X-Metabase-Session".to_string(),
                "metabase-session-evil".to_string(),
            ),
            (
                "x-twitter-bearer-token".to_string(),
                "twitter-bearer-token-evil".to_string(),
            ),
            (
                "X-Twitter-Webhooks-Signature".to_string(),
                "twitter-signature-evil".to_string(),
            ),
            (
                "x-facebook-signature".to_string(),
                "facebook-signature-evil".to_string(),
            ),
            (
                "X-Whatsapp-Signature".to_string(),
                "whatsapp-signature-evil".to_string(),
            ),
            (
                "x-cloudflare-tunnel-token".to_string(),
                "cf-tunnel-token-evil".to_string(),
            ),
            (
                "X-Matrix-Access-Token".to_string(),
                "matrix-token-evil".to_string(),
            ),
            ("x-discord-token".to_string(), "discord-token-evil".to_string()),
            (
                "X-Signature-Ed25519".to_string(),
                "deadbeefsignature".to_string(),
            ),
            ("x-signature-timestamp".to_string(), "1711111111".to_string()),
            (
                "x-gitlab-webhook-token".to_string(),
                "gitlab-webhook-token-evil".to_string(),
            ),
            ("X-Gitea-Signature".to_string(), "gitea-signature-evil".to_string()),
            ("x-gogs-signature".to_string(), "gogs-signature-evil".to_string()),
            (
                "X-Slack-Signature".to_string(),
                "v0=deadbeef".to_string(),
            ),
            (
                "x-slack-request-timestamp".to_string(),
                "1711111111".to_string(),
            ),
            ("X-Hub-Signature".to_string(), "sha1=deadbeef".to_string()),
            (
                "x-hub-signature-256".to_string(),
                "sha256=deadbeef".to_string(),
            ),
            (
                "X-Stripe-Signature".to_string(),
                "t=1711111111,v1=deadbeef".to_string(),
            ),
            (
                "x-twilio-signature".to_string(),
                "twilio-signature-evil".to_string(),
            ),
            ("X-Line-Signature".to_string(), "line-signature-evil".to_string()),
            (
                "x-shopify-hmac-sha256".to_string(),
                "shopify-hmac-evil".to_string(),
            ),
        ];
        let out = sanitized_plugin_headers(&headers);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].0, "content-type");
    }

    #[test]
    fn sanitized_headers_drop_vault_and_k8s_auth_headers() {
        let headers = vec![
            ("content-type".to_string(), "application/json".to_string()),
            ("x-vault-token".to_string(), "hvs.eviltoken".to_string()),
            ("X-K8S-AWS-ID".to_string(), "cluster-evil".to_string()),
        ];
        let out = sanitized_plugin_headers(&headers);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].0, "content-type");
    }

    #[test]
    fn sanitized_headers_drop_connection_string_headers() {
        let headers = vec![
            ("content-type".to_string(), "application/json".to_string()),
            (
                "x-database-url".to_string(),
                "postgres://user:pass@db/evil".to_string(),
            ),
            (
                "X-Redis-Url".to_string(),
                "redis://:pass@redis:6379/0".to_string(),
            ),
            (
                "x-mongodb-uri".to_string(),
                "mongodb://user:pass@mongo:27017/evil".to_string(),
            ),
            (
                "X-Postgres-Url".to_string(),
                "postgres://user:pass@db/evil".to_string(),
            ),
            ("x-mysql-url".to_string(), "mysql://user:pass@db/evil".to_string()),
            ("X-Broker-Url".to_string(), "amqp://user:pass@mq/evil".to_string()),
            ("x-amqp-url".to_string(), "amqp://user:pass@mq/evil".to_string()),
            ("X-Sqlite-Url".to_string(), "file:/tmp/evil.sqlite".to_string()),
            ("x-sqlite-path".to_string(), "/tmp/evil.sqlite".to_string()),
            ("X-Sqlite-File".to_string(), "/tmp/evil.sqlite".to_string()),
            (
                "x-sqlite-tmpdir".to_string(),
                "/tmp/evil-sqlite-tmp".to_string(),
            ),
            (
                "X-Sqlite-History".to_string(),
                "/tmp/evil-sqlite-history".to_string(),
            ),
            ("x-sqlcipher-key".to_string(), "sqlcipher-key-evil".to_string()),
            (
                "X-Libsql-Auth-Token".to_string(),
                "libsql-token-evil".to_string(),
            ),
            ("x-turso-auth-token".to_string(), "turso-token-evil".to_string()),
            ("x-pglite-data-dir".to_string(), "/tmp/evil-pglite".to_string()),
            (
                "X-Pglite-Db-Path".to_string(),
                "/tmp/evil-pglite/db".to_string(),
            ),
            (
                "x-pglite-opfs-path".to_string(),
                "opfs://evil-db".to_string(),
            ),
            (
                "X-Pglite-Wal-Dir".to_string(),
                "/tmp/evil-pglite/wal".to_string(),
            ),
            ("X-Opfs-Path".to_string(), "opfs://evil-path".to_string()),
            ("x-opfs-root".to_string(), "opfs://evil-root".to_string()),
            (
                "X-Opfs-Snapshot-Path".to_string(),
                "opfs://evil-snapshot".to_string(),
            ),
        ];
        let out = sanitized_plugin_headers(&headers);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].0, "content-type");
    }

    #[test]
    fn sanitized_headers_drop_managed_identity_headers() {
        let headers = vec![
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
            ("X-Forwarded-Host".to_string(), "evil.example".to_string()),
            ("X-Forwarded-Proto".to_string(), "http".to_string()),
            ("X-Forwarded-Protocol".to_string(), "http".to_string()),
            ("X-Forwarded-Scheme".to_string(), "http".to_string()),
            ("X-Forwarded-Ssl".to_string(), "on".to_string()),
            ("X-Url-Scheme".to_string(), "http".to_string()),
            ("X-Forwarded-Port".to_string(), "443".to_string()),
            ("X-Forwarded-Server".to_string(), "edge-1".to_string()),
            ("X-Forwarded-Prefix".to_string(), "/internal".to_string()),
            (
                "X-Original-Forwarded-Host".to_string(),
                "evil.example".to_string(),
            ),
            ("X-Original-Forwarded-Proto".to_string(), "http".to_string()),
            (
                "X-Original-Forwarded-Protocol".to_string(),
                "http".to_string(),
            ),
            ("X-Original-Forwarded-Scheme".to_string(), "http".to_string()),
            ("X-Original-Forwarded-Port".to_string(), "443".to_string()),
            (
                "X-Original-Forwarded-Prefix".to_string(),
                "/internal".to_string(),
            ),
            (
                "X-Original-Forwarded-Server".to_string(),
                "edge-1".to_string(),
            ),
            ("X-Original-Host".to_string(), "evil.example".to_string()),
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
            ("Fastly-Client-IP".to_string(), "1.2.3.4".to_string()),
            ("X-Forwarded-Client-Cert".to_string(), "By=spiffe://edge".to_string()),
            ("X-Client-Cert".to_string(), "-----BEGIN CERT-----...".to_string()),
            ("X-SSL-Client-Cert".to_string(), "-----BEGIN CERT-----...".to_string()),
            ("X-ARR-ClientCert".to_string(), "MIIB...".to_string()),
            ("SSL-Client-Cert".to_string(), "-----BEGIN CERT-----...".to_string()),
            ("X-HTTP-Method-Override".to_string(), "GET".to_string()),
            ("X-Method-Override".to_string(), "GET".to_string()),
            ("X-Forwarded-Method".to_string(), "GET".to_string()),
            ("X-Original-Method".to_string(), "GET".to_string()),
            ("X-HTTP-Method".to_string(), "GET".to_string()),
            ("X-Original-URL".to_string(), "/admin".to_string()),
            ("X-Original-URI".to_string(), "/admin".to_string()),
            ("X-Original-Path".to_string(), "/admin".to_string()),
            ("X-Forwarded-URI".to_string(), "/admin".to_string()),
            ("X-Rewrite-URL".to_string(), "/admin".to_string()),
            ("X-Rewrite-URI".to_string(), "/admin".to_string()),
            ("X-Envoy-Original-Path".to_string(), "/admin".to_string()),
            ("X-Envoy-Original-URL".to_string(), "/admin".to_string()),
            ("X-Client-IP".to_string(), "1.2.3.4".to_string()),
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
            ("Proxy-Authenticate".to_string(), "Basic realm=proxy".to_string()),
            (
                "Proxy-Authentication-Info".to_string(),
                "nextnonce=xyz".to_string(),
            ),
            ("Proxy-Status".to_string(), "error=http_request_error".to_string()),
            ("Authentication-Info".to_string(), "nextnonce=abc".to_string()),
            ("Proxy-Connection".to_string(), "keep-alive".to_string()),
            ("TE".to_string(), "trailers".to_string()),
            ("Upgrade".to_string(), "websocket".to_string()),
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
