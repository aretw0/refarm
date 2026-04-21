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
