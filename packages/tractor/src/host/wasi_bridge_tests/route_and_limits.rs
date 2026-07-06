    use super::*;

    static ENV_LOCK: std::sync::LazyLock<std::sync::Mutex<()>> =
        std::sync::LazyLock::new(|| std::sync::Mutex::new(()));

    fn reset_model_env() {
        for k in [
            "MODEL_PROVIDER",
            "MODEL_DEFAULT_PROVIDER",
            "MODEL_BASE_URL",
            "OPENAI_CODEX_ACCESS_TOKEN",
            "OPENAI_CODEX_ACCOUNT_ID",
        ] {
            std::env::remove_var(k);
        }
    }

    #[test]
    fn expected_route_defaults_to_ollama() {
        let _guard = ENV_LOCK.lock().unwrap();
        reset_model_env();
        let route = ModelRoute::from_env();
        assert_eq!(
            route,
            ModelRoute {
                provider: "ollama".to_string(),
                base_url: "http://localhost:11434".to_string(),
                path: "/v1/chat/completions".to_string(),
            }
        );
    }

    #[test]
    fn expected_route_trims_provider_from_env() {
        let _guard = ENV_LOCK.lock().unwrap();
        reset_model_env();
        std::env::set_var("MODEL_PROVIDER", "  openai  ");

        let route = ModelRoute::from_env();
        assert_eq!(route.provider, "openai");
        assert_eq!(route.base_url, "https://api.openai.com");
        assert_eq!(route.path, "/v1/chat/completions");

        reset_model_env();
    }

    #[test]
    fn expected_route_normalizes_provider_case_from_env() {
        let _guard = ENV_LOCK.lock().unwrap();
        reset_model_env();
        std::env::set_var("MODEL_PROVIDER", "OpenAI");

        let route = ModelRoute::from_env();
        assert_eq!(route.provider, "openai");
        assert_eq!(route.base_url, "https://api.openai.com");

        reset_model_env();
    }

    #[test]
    fn expected_route_uses_default_provider_when_primary_is_blank() {
        let _guard = ENV_LOCK.lock().unwrap();
        reset_model_env();
        std::env::set_var("MODEL_PROVIDER", "   ");
        std::env::set_var("MODEL_DEFAULT_PROVIDER", " openai ");

        let route = ModelRoute::from_env();
        assert_eq!(route.provider, "openai");
        assert_eq!(route.base_url, "https://api.openai.com");

        reset_model_env();
    }

    #[test]
    fn expected_route_uses_openai_codex_default_provider_when_primary_is_blank() {
        let _guard = ENV_LOCK.lock().unwrap();
        reset_model_env();
        std::env::set_var("MODEL_PROVIDER", "   ");
        std::env::set_var("MODEL_DEFAULT_PROVIDER", " openai-codex ");

        let route = ModelRoute::from_env();
        assert_eq!(route.provider, "openai-codex");
        assert_eq!(route.base_url, "https://chatgpt.com");
        assert_eq!(route.path, "/backend-api/codex/responses");

        reset_model_env();
    }

    #[test]
    fn expected_route_ignores_invalid_primary_provider_and_uses_valid_default() {
        let _guard = ENV_LOCK.lock().unwrap();
        reset_model_env();
        std::env::set_var("MODEL_PROVIDER", "open ai");
        std::env::set_var("MODEL_DEFAULT_PROVIDER", "openai");

        let route = ModelRoute::from_env();
        assert_eq!(route.provider, "openai");
        assert_eq!(route.base_url, "https://api.openai.com");

        reset_model_env();
    }

    #[test]
    fn expected_route_falls_back_to_ollama_when_provider_env_tokens_are_invalid() {
        let _guard = ENV_LOCK.lock().unwrap();
        reset_model_env();
        std::env::set_var("MODEL_PROVIDER", "open ai");
        std::env::set_var("MODEL_DEFAULT_PROVIDER", "opénaí");

        let route = ModelRoute::from_env();
        assert_eq!(route.provider, "ollama");
        assert_eq!(route.base_url, "http://localhost:11434");

        reset_model_env();
    }

    #[test]
    fn expected_route_defaults_openai_codex_to_chatgpt_backend() {
        let _guard = ENV_LOCK.lock().unwrap();
        reset_model_env();
        std::env::set_var("MODEL_PROVIDER", "openai-codex");

        let route = ModelRoute::from_env();
        assert_eq!(route.provider, "openai-codex");
        assert_eq!(route.base_url, "https://chatgpt.com");
        assert_eq!(route.path, "/backend-api/codex/responses");

        reset_model_env();
    }

    #[test]
    fn expected_route_known_providers_get_base_url_without_model_base_url() {
        let _guard = ENV_LOCK.lock().unwrap();
        let cases = [
            ("groq",       "https://api.groq.com",                          "/openai/v1/chat/completions"),
            ("mistral",    "https://api.mistral.ai",                        "/v1/chat/completions"),
            ("xai",        "https://api.x.ai",                              "/v1/chat/completions"),
            ("deepseek",   "https://api.deepseek.com",                      "/v1/chat/completions"),
            ("together",   "https://api.together.xyz",                      "/v1/chat/completions"),
            ("openrouter", "https://openrouter.ai",                         "/api/v1/chat/completions"),
            ("gemini",     "https://generativelanguage.googleapis.com",     "/v1beta/openai/chat/completions"),
        ];
        for (provider, expected_base, expected_path) in cases {
            reset_model_env();
            std::env::set_var("MODEL_PROVIDER", provider);
            let route = ModelRoute::from_env();
            assert_eq!(route.provider, provider, "provider mismatch for {provider}");
            assert_eq!(route.base_url, expected_base, "base_url mismatch for {provider}");
            assert_eq!(route.path, expected_path, "path mismatch for {provider}");
        }
        reset_model_env();
    }

    #[test]
    fn expected_route_model_base_url_overrides_known_provider_default() {
        let _guard = ENV_LOCK.lock().unwrap();
        reset_model_env();
        std::env::set_var("MODEL_PROVIDER", "groq");
        std::env::set_var("MODEL_BASE_URL", "https://my-proxy.example.com");

        let route = ModelRoute::from_env();
        assert_eq!(route.base_url, "https://my-proxy.example.com");
        assert_eq!(route.path, "/openai/v1/chat/completions");

        reset_model_env();
    }

    #[test]
    fn expected_route_reads_model_provider_and_base_url_from_env() {
        let _guard = ENV_LOCK.lock().unwrap();
        reset_model_env();
        std::env::set_var("MODEL_PROVIDER", "openai");
        std::env::set_var("MODEL_BASE_URL", "http://127.0.0.1:43210");

        let route = ModelRoute::from_env();
        assert_eq!(route.provider, "openai");
        assert_eq!(route.base_url, "http://127.0.0.1:43210");
        assert_eq!(route.path, "/v1/chat/completions");

        reset_model_env();
    }

    #[test]
    fn expected_route_uses_model_default_provider_when_primary_absent() {
        let _guard = ENV_LOCK.lock().unwrap();
        reset_model_env();
        // MODEL_PROVIDER unset; MODEL_DEFAULT_PROVIDER is the fallback source.
        std::env::set_var("MODEL_DEFAULT_PROVIDER", "openai");

        let route = ModelRoute::from_env();
        assert_eq!(route.provider, "openai");
        assert_eq!(route.base_url, "https://api.openai.com");

        reset_model_env();
    }

    #[test]
    fn enforce_route_blocks_provider_mismatch() {
        let expected = ModelRoute {
            provider: "openai".to_string(),
            base_url: "https://api.openai.com".to_string(),
            path: "/v1/chat/completions".to_string(),
        };
        let err = enforce_model_route(
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
        let expected = ModelRoute {
            provider: "openai".to_string(),
            base_url: "https://api.openai.com".to_string(),
            path: "/v1/chat/completions".to_string(),
        };
        let err = enforce_model_route(
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
        let expected = ModelRoute {
            provider: "openai".to_string(),
            base_url: "https://api.openai.com".to_string(),
            path: "/v1/chat/completions".to_string(),
        };
        let err = enforce_model_route(
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
        let expected = ModelRoute {
            provider: "open ai".to_string(),
            base_url: "https://api.openai.com".to_string(),
            path: "/v1/chat/completions".to_string(),
        };
        let err = enforce_model_route(
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
        let expected = ModelRoute {
            provider: "openai".to_string(),
            base_url: "https://api.openai.com".to_string(),
            path: "/v1/chat/completions".to_string(),
        };
        let err = enforce_model_route(
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
        let expected = ModelRoute {
            provider: "openai".to_string(),
            base_url: "https://api.openai.com".to_string(),
            path: "/v1/chat/completions".to_string(),
        };
        let err = enforce_model_route(
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
        let expected = ModelRoute {
            provider: "openai".to_string(),
            base_url: "https://api.openai.com".to_string(),
            path: "/v1/chat/completions".to_string(),
        };
        let err = enforce_model_route(
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
        let expected = ModelRoute {
            provider: "openai".to_string(),
            base_url: "https://api.openai.com".to_string(),
            path: "/v1/chat/completions".to_string(),
        };
        let err = enforce_model_route("openai", "https://api.openai.com", "/v1/chát", &expected)
            .unwrap_err();
        assert!(err.contains("path must be ascii"));
    }

    #[test]
    fn enforce_route_blocks_non_ascii_expected_path() {
        let expected = ModelRoute {
            provider: "openai".to_string(),
            base_url: "https://api.openai.com".to_string(),
            path: "/v1/chát".to_string(),
        };
        let err = enforce_model_route(
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
        let expected = ModelRoute {
            provider: "openai".to_string(),
            base_url: "https://api.openai.com".to_string(),
            path: "/v1/chat/completions".to_string(),
        };
        let err = enforce_model_route("openai", "https://api.openai.com", "   ", &expected)
            .unwrap_err();
        assert!(err.contains("path must be non-empty"));
    }

    #[test]
    fn enforce_route_blocks_empty_expected_path() {
        let expected = ModelRoute {
            provider: "openai".to_string(),
            base_url: "https://api.openai.com".to_string(),
            path: " ".to_string(),
        };
        let err = enforce_model_route(
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
        let expected = ModelRoute {
            provider: "openai".to_string(),
            base_url: "https://api.openai.com".to_string(),
            path: "/v1/chat/completions".to_string(),
        };

        let err_query = enforce_model_route(
            "openai",
            "https://api.openai.com",
            "/v1/chat/completions?stream=true",
            &expected,
        )
        .unwrap_err();
        assert!(err_query.contains("path must not include query or fragment"));

        let err_fragment = enforce_model_route(
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
        let expected = ModelRoute {
            provider: "openai".to_string(),
            base_url: "https://api.openai.com".to_string(),
            path: "/v1/chat/completions".to_string(),
        };

        let err = enforce_model_route(
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
        let expected = ModelRoute {
            provider: "openai".to_string(),
            base_url: "https://api.openai.com".to_string(),
            path: "/v1/chat/completions".to_string(),
        };
        let overlong = format!("https://{}", "a".repeat(2100));
        let err = enforce_model_route("openai", &overlong, "/v1/chat/completions", &expected)
            .unwrap_err();
        assert!(err.contains("base_url too long"));
    }

    #[test]
    fn enforce_route_blocks_overlong_path() {
        let expected = ModelRoute {
            provider: "openai".to_string(),
            base_url: "https://api.openai.com".to_string(),
            path: "/v1/chat/completions".to_string(),
        };
        let overlong = format!("/{}", "a".repeat(2100));
        let err = enforce_model_route("openai", "https://api.openai.com", &overlong, &expected)
            .unwrap_err();
        assert!(err.contains("path too long"));
    }

    #[test]
    fn enforce_route_blocks_base_url_mismatch() {
        let expected = ModelRoute {
            provider: "openai".to_string(),
            base_url: "https://api.openai.com".to_string(),
            path: "/v1/chat/completions".to_string(),
        };
        let err = enforce_model_route(
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
        let expected = ModelRoute {
            provider: "openai".to_string(),
            base_url: "https://api.openai.com".to_string(),
            path: "/v1/chat/completions".to_string(),
        };
        let err = enforce_model_route(
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
        let expected = ModelRoute {
            provider: "openai".to_string(),
            base_url: "https://api.openai.com".to_string(),
            path: "/v1/chat/completions".to_string(),
        };
        let err = enforce_model_route(
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
        let expected = ModelRoute {
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
            let err = enforce_model_route(
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
        let expected = ModelRoute {
            provider: "openai".to_string(),
            base_url: "https://api.openai.com/v1".to_string(),
            path: "/v1/chat/completions".to_string(),
        };

        let err = enforce_model_route(
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
        let expected = ModelRoute {
            provider: "openai".to_string(),
            base_url: "https://api.openai.com".to_string(),
            path: "/v1/chat/completions".to_string(),
        };
        let result = enforce_model_route(
            "openai",
            "https://api.openai.com",
            "v1/chat/completions",
            &expected,
        );
        assert!(result.is_ok());
    }

    #[test]
    fn enforce_route_accepts_base_url_with_trailing_slash() {
        let expected = ModelRoute {
            provider: "openai".to_string(),
            base_url: "https://api.openai.com".to_string(),
            path: "/v1/chat/completions".to_string(),
        };
        let result = enforce_model_route(
            "openai",
            "https://api.openai.com/",
            "/v1/chat/completions",
            &expected,
        );
        assert!(result.is_ok());
    }

    #[test]
    fn enforce_route_accepts_base_url_with_mixed_case_host() {
        let expected = ModelRoute {
            provider: "openai".to_string(),
            base_url: "https://api.openai.com".to_string(),
            path: "/v1/chat/completions".to_string(),
        };
        let result = enforce_model_route(
            "openai",
            "https://API.OpenAI.com",
            "/v1/chat/completions",
            &expected,
        );
        assert!(result.is_ok());
    }

    #[test]
    fn enforce_route_accepts_base_url_with_uppercase_scheme() {
        let expected = ModelRoute {
            provider: "openai".to_string(),
            base_url: "https://api.openai.com".to_string(),
            path: "/v1/chat/completions".to_string(),
        };
        let result = enforce_model_route(
            "openai",
            "HTTPS://api.openai.com",
            "/v1/chat/completions",
            &expected,
        );
        assert!(result.is_ok());
    }

    #[test]
    fn enforce_route_accepts_path_with_trailing_slash() {
        let expected = ModelRoute {
            provider: "openai".to_string(),
            base_url: "https://api.openai.com".to_string(),
            path: "/v1/chat/completions".to_string(),
        };
        let result = enforce_model_route(
            "openai",
            "https://api.openai.com",
            "/v1/chat/completions/",
            &expected,
        );
        assert!(result.is_ok());
    }

    #[test]
    fn enforce_route_accepts_trimmed_provider_and_base_url() {
        let expected = ModelRoute {
            provider: "openai".to_string(),
            base_url: "https://api.openai.com".to_string(),
            path: "/v1/chat/completions".to_string(),
        };
        let result = enforce_model_route(
            " openai ",
            " https://api.openai.com/ ",
            "v1/chat/completions",
            &expected,
        );
        assert!(result.is_ok());
    }

    #[test]
    fn enforce_route_blocks_path_with_surrounding_whitespace() {
        let expected = ModelRoute {
            provider: "openai".to_string(),
            base_url: "https://api.openai.com".to_string(),
            path: "/v1/chat/completions".to_string(),
        };
        let err = enforce_model_route(
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
        let expected = ModelRoute {
            provider: "openai".to_string(),
            base_url: "https://api.openai.com".to_string(),
            path: "/v1/chat/completions".to_string(),
        };
        let err = enforce_model_route(
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
        let expected = ModelRoute {
            provider: "openai".to_string(),
            base_url: "https://api.openai.com".to_string(),
            path: "/v1/chat/comp letions".to_string(),
        };
        let err = enforce_model_route(
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
        let expected = ModelRoute {
            provider: "openai".to_string(),
            base_url: "https://api.openai.com".to_string(),
            path: "/v1/chat/completions".to_string(),
        };
        let result = enforce_model_route(
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
        assert!(enforce_model_request_body(&body).is_ok());
    }

    #[test]
    fn llm_request_body_blocks_oversized_payload() {
        let body = vec![b'a'; 1024 * 1024 + 1];
        let err = enforce_model_request_body(&body).unwrap_err();
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
    fn model_error_body_preview_keeps_small_body() {
        let body = b"small error".to_vec();
        let preview = model_error_body_preview(&body);
        assert_eq!(preview, "small error");
    }

    #[test]
    fn model_error_body_preview_truncates_large_body() {
        let body = vec![b'a'; 8 * 1024 + 128];
        let preview = model_error_body_preview(&body);
        assert!(preview.starts_with(&"a".repeat(32)));
        assert!(preview.contains("[truncated: model-bridge error body exceeded 8192 bytes]"));
    }

    // ── fallback route (MODEL_FALLBACK_PROVIDER) ──────────────────────────────

    #[test]
    fn enforce_route_any_accepts_primary_or_fallback_and_rejects_others() {
        // The host half of the guest's documented cross-provider fallback: with a
        // fallback route set, a request matching EITHER route is accepted, and a
        // third arbitrary provider is still rejected (allow-list stays closed).
        let primary =
            ModelRoute::for_test("anthropic", "https://api.anthropic.com", "/v1/messages");
        let fallback =
            ModelRoute::for_test("ollama", "http://127.0.0.1:11434", "/v1/chat/completions");

        // Primary request: accepted.
        assert!(enforce_model_route_any(
            "anthropic",
            "https://api.anthropic.com",
            "/v1/messages",
            &primary,
            Some(&fallback),
        )
        .is_ok());

        // Fallback request: accepted (this is exactly what was blocked before).
        assert!(enforce_model_route_any(
            "ollama",
            "http://127.0.0.1:11434",
            "/v1/chat/completions",
            &primary,
            Some(&fallback),
        )
        .is_ok());

        // A third provider neither route allows: still rejected.
        assert!(enforce_model_route_any(
            "openai",
            "https://api.openai.com",
            "/v1/chat/completions",
            &primary,
            Some(&fallback),
        )
        .is_err());
    }

    #[test]
    fn enforce_route_any_without_fallback_returns_the_primary_error_unchanged() {
        // No fallback (the common case) must behave byte-identically to the
        // single-route matcher: the same request that enforce_model_route rejects
        // yields the SAME error string through enforce_model_route_any.
        let primary =
            ModelRoute::for_test("anthropic", "https://api.anthropic.com", "/v1/messages");

        let single = enforce_model_route(
            "ollama",
            "http://127.0.0.1:11434",
            "/v1/chat/completions",
            &primary,
        );
        let any = enforce_model_route_any(
            "ollama",
            "http://127.0.0.1:11434",
            "/v1/chat/completions",
            &primary,
            None,
        );
        assert!(single.is_err());
        assert_eq!(single, any, "unset fallback must not change the error path");
    }

    #[test]
    fn fallback_from_env_is_none_when_unset_and_route_when_set() {
        let _guard = ENV_LOCK.lock().unwrap();
        reset_model_env();
        std::env::remove_var("MODEL_FALLBACK_PROVIDER");
        assert!(
            ModelRoute::fallback_from_env().is_none(),
            "unset MODEL_FALLBACK_PROVIDER must yield no fallback route (identical to today)"
        );

        std::env::set_var("MODEL_FALLBACK_PROVIDER", "ollama");
        let route = ModelRoute::fallback_from_env().expect("set fallback resolves a route");
        assert_eq!(route.provider, "ollama");
        assert_eq!(route.base_url, "http://localhost:11434");
        assert_eq!(route.path, "/v1/chat/completions");

        // A non-lowercase (malformed) token is rejected — fails closed, not routed.
        std::env::set_var("MODEL_FALLBACK_PROVIDER", "OLLAMA");
        assert!(ModelRoute::fallback_from_env().is_none());

        reset_model_env();
    }

    #[test]
    fn zero_config_host_route_agrees_with_the_guest_ollama_floor() {
        // Change B counterpart on the host side: with NO routing env set, the host
        // resolves the ollama floor — the same provider the guest now defaults to —
        // so a zero-config request is accepted instead of provider-mismatch-blocked.
        let _guard = ENV_LOCK.lock().unwrap();
        reset_model_env();
        std::env::remove_var("MODEL_FALLBACK_PROVIDER");

        let expected = ModelRoute::from_env();
        assert_eq!(expected.provider, "ollama");
        assert_eq!(expected.base_url, "http://localhost:11434");
        assert_eq!(expected.path, "/v1/chat/completions");

        assert!(enforce_model_route(
            "ollama",
            "http://localhost:11434",
            "/v1/chat/completions",
            &expected,
        )
        .is_ok());

        reset_model_env();
    }
