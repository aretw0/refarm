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
    fn enforce_route_blocks_base_url_with_missing_host() {
        let expected = LlmRoute {
            provider: "openai".to_string(),
            base_url: "https://api.openai.com".to_string(),
            path: "/v1/chat/completions".to_string(),
        };
        let err = enforce_llm_route("openai", "https:///", "/v1/chat/completions", &expected)
            .unwrap_err();
        assert!(err.contains("must include host"));
    }

    #[test]
    fn enforce_route_blocks_base_url_with_embedded_credentials() {
        let expected = LlmRoute {
            provider: "openai".to_string(),
            base_url: "https://api.openai.com".to_string(),
            path: "/v1/chat/completions".to_string(),
        };
        let err = enforce_llm_route(
            "openai",
            "https://user:pass@api.openai.com",
            "/v1/chat/completions",
            &expected,
        )
        .unwrap_err();
        assert!(err.contains("must not include credentials"));
    }

    #[test]
    fn enforce_route_blocks_base_url_with_query_or_fragment() {
        let expected = LlmRoute {
            provider: "openai".to_string(),
            base_url: "https://api.openai.com".to_string(),
            path: "/v1/chat/completions".to_string(),
        };

        let err_query = enforce_llm_route(
            "openai",
            "https://api.openai.com?x=1",
            "/v1/chat/completions",
            &expected,
        )
        .unwrap_err();
        assert!(err_query.contains("must not include query or fragment"));

        let err_fragment = enforce_llm_route(
            "openai",
            "https://api.openai.com#frag",
            "/v1/chat/completions",
            &expected,
        )
        .unwrap_err();
        assert!(err_fragment.contains("must not include query or fragment"));
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
    fn enforce_route_accepts_trimmed_provider_base_url_and_path() {
        let expected = LlmRoute {
            provider: "openai".to_string(),
            base_url: "https://api.openai.com".to_string(),
            path: "/v1/chat/completions".to_string(),
        };
        let result = enforce_llm_route(
            " openai ",
            " https://api.openai.com/ ",
            "  v1/chat/completions  ",
            &expected,
        );
        assert!(result.is_ok());
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
    fn sanitized_headers_drop_sensitive_auth_keys() {
        let headers = vec![
            ("content-type".to_string(), "application/json".to_string()),
            ("authorization".to_string(), "Bearer fake".to_string()),
            ("x-api-key".to_string(), "fake-key".to_string()),
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
            ("X-API-KEY".to_string(), "fake-key".to_string()),
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
            (" x-api-key ".to_string(), "fake-key".to_string()),
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
    fn sanitized_headers_drop_overlong_header_value() {
        let headers = vec![
            ("x-safe".to_string(), "a".repeat(8 * 1024 + 1)),
            ("content-type".to_string(), "application/json".to_string()),
        ];
        let out = sanitized_plugin_headers(&headers);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].0, "content-type");
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
