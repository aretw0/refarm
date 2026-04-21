    use super::*;
    use crate::storage::NativeStorage;

    #[test]
    fn refarm_config_env_vars_returns_empty_when_no_file() {
        // CWD in test environment has no .refarm/config.json — must not panic.
        let base = std::env::current_dir().unwrap_or_default();
        let vars = refarm_config_env_vars_from(&base);
        // Can't assert empty (dev machine might have a config), but must not error.
        let _ = vars;
    }

    #[test]
    fn forwardable_llm_env_key_filters_sensitive_suffixes() {
        let allowed = ["LLM_PROVIDER", "LLM_BASE_URL"];
        for key in allowed {
            assert!(is_forwardable_llm_env_key(key), "expected key to be allowed: {key}");
        }

        let blocked = [
            "LLM_",
            "LLM_SHELL_ALLOWLIST",
            "LLM_FS_ROOT",
            "LLM-provider",
            "LLM_PROVIDER NAME",
            "LLM_provider",
            "OPENAI_API_KEY",
            "LLM_OPENAI_API_KEY",
            "LLM_SESSION_TOKEN",
            "LLM_SHARED_SECRET",
            "LLM_DB_PASSWORD",
            "LLM_PROVIDER_CREDENTIALS",
            "LLM_SSH_PRIVATE_KEY",
            "LLM_AWS_ACCESS_KEY",
            "LLM_REQUEST_SIGNING_KEY",
            "LLM_PROXY_AUTH",
            "LLM_AUTH_HEADER",
            "LLM_AUTHORIZATION",
            "LLM_SESSION_BEARER",
        ];
        for key in blocked {
            assert!(!is_forwardable_llm_env_key(key), "expected key to be blocked: {key}");
        }
        assert!(!is_forwardable_llm_env_key(&format!("LLM_{}", "A".repeat(97))));

        let good_values = ["openai", "https://api.openai.com/v1"];
        for value in good_values {
            assert!(
                is_forwardable_llm_env_value(value),
                "expected value to be allowed: {value}"
            );
        }

        let blocked_values = ["   ", " openai ", "open\nai", "open\u{0000}ai", "opénaí"];
        for value in blocked_values {
            assert!(
                !is_forwardable_llm_env_value(value),
                "expected value to be blocked: {value:?}"
            );
        }
        assert!(!is_forwardable_llm_env_value(&"a".repeat(4097)));
    }

    #[test]
    fn forwarded_llm_env_vars_from_iter_filters_and_caps_entries() {
        let mut vars = vec![
            ("LLM_PROVIDER".to_string(), "openai".to_string()),
            ("LLM_SHELL_ALLOWLIST".to_string(), "echo,ls".to_string()),
            ("LLM_FS_ROOT".to_string(), "/workspace".to_string()),
            ("LLM_OPENAI_API_KEY".to_string(), "secret".to_string()),
            ("OTHER_VAR".to_string(), "x".to_string()),
            ("LLM_BAD".to_string(), "bad\nvalue".to_string()),
        ];
        vars.extend((0..130).map(|i| (format!("LLM_SAFE_{i}"), "ok".to_string())));

        let out = forwarded_llm_env_vars_from_iter(vars);
        let map: std::collections::HashMap<_, _> = out.into_iter().collect();

        assert_eq!(map.get("LLM_PROVIDER"), Some(&"openai".to_string()));
        assert!(!map.contains_key("LLM_SHELL_ALLOWLIST"));
        assert!(!map.contains_key("LLM_FS_ROOT"));
        assert!(!map.contains_key("LLM_OPENAI_API_KEY"));
        assert!(!map.contains_key("OTHER_VAR"));
        assert!(!map.contains_key("LLM_BAD"));
        assert_eq!(map.len(), 128);
    }

    #[test]
    fn forwarded_llm_env_vars_from_iter_caps_total_bytes() {
        let vars: Vec<(String, String)> = (0..40)
            .map(|i| (format!("LLM_A{i:03}"), "x".repeat(3000)))
            .collect();

        let out = forwarded_llm_env_vars_from_iter(vars);
        let map: std::collections::HashMap<_, _> = out.into_iter().collect();

        assert_eq!(map.len(), 21);
        assert!(map.contains_key("LLM_A000"));
        assert!(map.contains_key("LLM_A020"));
        assert!(!map.contains_key("LLM_A021"));
    }

    #[test]
    fn forwarded_llm_env_vars_from_iter_deduplicates_keys() {
        let vars = vec![
            ("LLM_PROVIDER".to_string(), "openai".to_string()),
            ("LLM_PROVIDER".to_string(), "ollama".to_string()),
            ("LLM_MODEL".to_string(), "gpt-4.1-mini".to_string()),
        ];

        let out = forwarded_llm_env_vars_from_iter(vars);
        let map: std::collections::HashMap<_, _> = out.into_iter().collect();

        assert_eq!(map.len(), 2);
        assert_eq!(map.get("LLM_PROVIDER"), Some(&"openai".to_string()));
        assert_eq!(map.get("LLM_MODEL"), Some(&"gpt-4.1-mini".to_string()));
    }

    #[test]
    fn forwarded_llm_env_vars_from_iter_limits_input_scan_window() {
        let mut vars: Vec<(String, String)> = (0..512)
            .map(|i| (format!("OTHER_{i}"), "x".to_string()))
            .collect();
        vars.push(("LLM_PROVIDER".to_string(), "openai".to_string()));

        let out = forwarded_llm_env_vars_from_iter(vars);
        assert!(out.is_empty());
    }

    #[test]
    fn refarm_config_env_vars_maps_fields_correctly() {
        let dir = tempfile::tempdir().unwrap();
        let refarm_dir = dir.path().join(".refarm");
        std::fs::create_dir_all(&refarm_dir).unwrap();
        std::fs::write(
            refarm_dir.join("config.json"),
            r#"{"provider":"anthropic","model":"claude-opus-4-7","default_provider":"ollama","budgets":{"anthropic":5.0,"openai":2.5}}"#,
        ).unwrap();
        let vars = refarm_config_env_vars_from(dir.path());
        let map: std::collections::HashMap<_, _> = vars.into_iter().collect();
        assert_eq!(map["LLM_PROVIDER"], "anthropic");
        assert_eq!(map["LLM_MODEL"], "claude-opus-4-7");
        assert_eq!(map["LLM_DEFAULT_PROVIDER"], "ollama");
        assert_eq!(map["LLM_BUDGET_ANTHROPIC_USD"], "5");
        assert_eq!(map["LLM_BUDGET_OPENAI_USD"], "2.5");
    }

    #[test]
    fn refarm_config_env_vars_ignores_non_numeric_budgets() {
        let dir = tempfile::tempdir().unwrap();
        let refarm_dir = dir.path().join(".refarm");
        std::fs::create_dir_all(&refarm_dir).unwrap();
        std::fs::write(
            refarm_dir.join("config.json"),
            r#"{"budgets":{"anthropic":"5.0","openai":null,"ollama":1.25}}"#,
        )
        .unwrap();

        let vars = refarm_config_env_vars_from(dir.path());
        let map: std::collections::HashMap<_, _> = vars.into_iter().collect();

        assert!(!map.contains_key("LLM_BUDGET_ANTHROPIC_USD"));
        assert!(!map.contains_key("LLM_BUDGET_OPENAI_USD"));
        assert_eq!(map["LLM_BUDGET_OLLAMA_USD"], "1.25");
    }

    #[test]
    fn refarm_config_env_vars_trim_and_skip_empty_string_fields() {
        let dir = tempfile::tempdir().unwrap();
        let refarm_dir = dir.path().join(".refarm");
        std::fs::create_dir_all(&refarm_dir).unwrap();
        std::fs::write(
            refarm_dir.join("config.json"),
            r#"{"provider":"  openai  ","model":"   ","default_provider":"\tollama\t"}"#,
        )
        .unwrap();

        let vars = refarm_config_env_vars_from(dir.path());
        let map: std::collections::HashMap<_, _> = vars.into_iter().collect();

        assert_eq!(map["LLM_PROVIDER"], "openai");
        assert_eq!(map["LLM_DEFAULT_PROVIDER"], "ollama");
        assert!(!map.contains_key("LLM_MODEL"));
    }

    #[test]
    fn refarm_config_env_vars_skip_string_fields_with_control_chars() {
        let dir = tempfile::tempdir().unwrap();
        let refarm_dir = dir.path().join(".refarm");
        std::fs::create_dir_all(&refarm_dir).unwrap();
        std::fs::write(
            refarm_dir.join("config.json"),
            r#"{"provider":"open\nai","model":"gpt\u0000x","default_provider":" ollama "}"#,
        )
        .unwrap();

        let vars = refarm_config_env_vars_from(dir.path());
        let map: std::collections::HashMap<_, _> = vars.into_iter().collect();

        assert!(!map.contains_key("LLM_PROVIDER"));
        assert!(!map.contains_key("LLM_MODEL"));
        assert_eq!(map["LLM_DEFAULT_PROVIDER"], "ollama");
    }

    #[test]
    fn refarm_config_env_vars_skip_overlong_string_fields() {
        let dir = tempfile::tempdir().unwrap();
        let refarm_dir = dir.path().join(".refarm");
        std::fs::create_dir_all(&refarm_dir).unwrap();
        let long = "a".repeat(4097);
        std::fs::write(
            refarm_dir.join("config.json"),
            format!(
                r#"{{"provider":"{long}","model":"{long}","default_provider":" ollama "}}"#
            ),
        )
        .unwrap();

        let vars = refarm_config_env_vars_from(dir.path());
        let map: std::collections::HashMap<_, _> = vars.into_iter().collect();

        assert!(!map.contains_key("LLM_PROVIDER"));
        assert!(!map.contains_key("LLM_MODEL"));
        assert_eq!(map["LLM_DEFAULT_PROVIDER"], "ollama");
    }

    #[test]
    fn refarm_config_env_vars_normalize_provider_fields_to_lowercase() {
        let dir = tempfile::tempdir().unwrap();
        let refarm_dir = dir.path().join(".refarm");
        std::fs::create_dir_all(&refarm_dir).unwrap();
        std::fs::write(
            refarm_dir.join("config.json"),
            r#"{"provider":" OpenAI ","default_provider":" OLLAMA "}"#,
        )
        .unwrap();

        let vars = refarm_config_env_vars_from(dir.path());
        let map: std::collections::HashMap<_, _> = vars.into_iter().collect();

        assert_eq!(map["LLM_PROVIDER"], "openai");
        assert_eq!(map["LLM_DEFAULT_PROVIDER"], "ollama");
    }

    #[test]
    fn refarm_config_env_vars_skip_provider_fields_with_invalid_chars() {
        let dir = tempfile::tempdir().unwrap();
        let refarm_dir = dir.path().join(".refarm");
        std::fs::create_dir_all(&refarm_dir).unwrap();
        std::fs::write(
            refarm_dir.join("config.json"),
            r#"{"provider":"open ai","default_provider":"anthropic/v1","model":"gpt-4o-mini"}"#,
        )
        .unwrap();

        let vars = refarm_config_env_vars_from(dir.path());
        let map: std::collections::HashMap<_, _> = vars.into_iter().collect();

        assert!(!map.contains_key("LLM_PROVIDER"));
        assert!(!map.contains_key("LLM_DEFAULT_PROVIDER"));
        assert_eq!(map["LLM_MODEL"], "gpt-4o-mini");
    }

    #[test]
    fn refarm_config_env_vars_trim_budget_provider_names() {
        let dir = tempfile::tempdir().unwrap();
        let refarm_dir = dir.path().join(".refarm");
        std::fs::create_dir_all(&refarm_dir).unwrap();
        std::fs::write(
            refarm_dir.join("config.json"),
            r#"{"budgets":{" openai ":2.5,"   ":1.0}}"#,
        )
        .unwrap();

        let vars = refarm_config_env_vars_from(dir.path());
        let map: std::collections::HashMap<_, _> = vars.into_iter().collect();

        assert_eq!(map["LLM_BUDGET_OPENAI_USD"], "2.5");
        assert!(!map.contains_key("LLM_BUDGET___USD"));
    }

    #[test]
    fn refarm_config_env_vars_cap_budget_entries() {
        let dir = tempfile::tempdir().unwrap();
        let refarm_dir = dir.path().join(".refarm");
        std::fs::create_dir_all(&refarm_dir).unwrap();

        let mut budgets = serde_json::Map::new();
        for i in 0..80 {
            budgets.insert(format!("provider-{i}"), serde_json::Value::from(i as f64));
        }
        let cfg = serde_json::json!({"budgets": budgets});
        std::fs::write(refarm_dir.join("config.json"), cfg.to_string()).unwrap();

        let vars = refarm_config_env_vars_from(dir.path());
        let budget_count = vars
            .iter()
            .filter(|(k, _)| k.starts_with("LLM_BUDGET_"))
            .count();

        assert_eq!(budget_count, 64);
    }

    #[test]
    fn refarm_config_env_vars_sanitize_budget_provider_tokens() {
        let dir = tempfile::tempdir().unwrap();
        let refarm_dir = dir.path().join(".refarm");
        std::fs::create_dir_all(&refarm_dir).unwrap();
        std::fs::write(
            refarm_dir.join("config.json"),
            r#"{"budgets":{"openai-codex/v1":2.5,"***":1.0}}"#,
        )
        .unwrap();

        let vars = refarm_config_env_vars_from(dir.path());
        let map: std::collections::HashMap<_, _> = vars.into_iter().collect();

        assert_eq!(map["LLM_BUDGET_OPENAI_CODEX_V1_USD"], "2.5");
        assert!(!map.contains_key("LLM_BUDGET___USD"));
    }

    #[test]
    fn refarm_config_env_vars_skip_overlong_budget_provider_token() {
        let dir = tempfile::tempdir().unwrap();
        let refarm_dir = dir.path().join(".refarm");
        std::fs::create_dir_all(&refarm_dir).unwrap();
        let overlong = "a".repeat(65);
        std::fs::write(
            refarm_dir.join("config.json"),
            format!(r#"{{"budgets":{{"{overlong}":2.5,"openai":1.0}}}}"#),
        )
        .unwrap();

        let vars = refarm_config_env_vars_from(dir.path());
        let map: std::collections::HashMap<_, _> = vars.into_iter().collect();

        assert_eq!(map["LLM_BUDGET_OPENAI_USD"], "1");
        assert_eq!(map.len(), 1);
    }

    #[test]
    fn refarm_config_env_vars_skip_budget_provider_with_control_chars() {
        let dir = tempfile::tempdir().unwrap();
        let refarm_dir = dir.path().join(".refarm");
        std::fs::create_dir_all(&refarm_dir).unwrap();
        std::fs::write(
            refarm_dir.join("config.json"),
            r#"{"budgets":{"open\nai":2.5,"openai":1.0}}"#,
        )
        .unwrap();

        let vars = refarm_config_env_vars_from(dir.path());
        let map: std::collections::HashMap<_, _> = vars.into_iter().collect();

        assert_eq!(map["LLM_BUDGET_OPENAI_USD"], "1");
        assert_eq!(map.len(), 1);
    }

    #[test]
    fn refarm_config_env_vars_dedupe_provider_and_budget_keys_after_normalization() {
        let dir = tempfile::tempdir().unwrap();
        let refarm_dir = dir.path().join(".refarm");
        std::fs::create_dir_all(&refarm_dir).unwrap();
        std::fs::write(
            refarm_dir.join("config.json"),
            r#"{"provider":"openai","budgets":{"openai-codex/v1":1.0,"openai codex v1":2.5}}"#,
        )
        .unwrap();

        let vars = refarm_config_env_vars_from(dir.path());
        let map: std::collections::HashMap<_, _> = vars.into_iter().collect();

        assert_eq!(map["LLM_PROVIDER"], "openai");
        assert_eq!(map["LLM_BUDGET_OPENAI_CODEX_V1_USD"], "2.5");
    }

    #[test]
    fn refarm_config_env_vars_ignores_negative_budgets() {
        let dir = tempfile::tempdir().unwrap();
        let refarm_dir = dir.path().join(".refarm");
        std::fs::create_dir_all(&refarm_dir).unwrap();
        std::fs::write(
            refarm_dir.join("config.json"),
            r#"{"budgets":{"openai":-1.0,"ollama":0.0}}"#,
        )
        .unwrap();

        let vars = refarm_config_env_vars_from(dir.path());
        let map: std::collections::HashMap<_, _> = vars.into_iter().collect();

        assert!(!map.contains_key("LLM_BUDGET_OPENAI_USD"));
        assert_eq!(map["LLM_BUDGET_OLLAMA_USD"], "0");
    }

    #[test]
    fn refarm_config_env_vars_ignores_invalid_json() {
        let dir = tempfile::tempdir().unwrap();
        let refarm_dir = dir.path().join(".refarm");
        std::fs::create_dir_all(&refarm_dir).unwrap();
        std::fs::write(refarm_dir.join("config.json"), b"not json").unwrap();
        let vars = refarm_config_env_vars_from(dir.path());
        assert!(vars.is_empty());
    }

    #[test]
    fn refarm_config_env_vars_empty_when_no_file() {
        let dir = tempfile::tempdir().unwrap();
        let vars = refarm_config_env_vars_from(dir.path());
        assert!(vars.is_empty());
    }

    #[test]
    fn refarm_config_env_vars_ignores_oversized_config_file() {
        let dir = tempfile::tempdir().unwrap();
        let refarm_dir = dir.path().join(".refarm");
        std::fs::create_dir_all(&refarm_dir).unwrap();
        std::fs::write(refarm_dir.join("config.json"), vec![b'a'; 256 * 1024 + 1]).unwrap();

        let vars = refarm_config_env_vars_from(dir.path());
        assert!(vars.is_empty());
    }

    #[test]
    fn refarm_config_reader_allows_exact_limit_file() {
        let dir = tempfile::tempdir().unwrap();
        let refarm_dir = dir.path().join(".refarm");
        std::fs::create_dir_all(&refarm_dir).unwrap();
        let path = refarm_dir.join("config.json");
        std::fs::write(&path, vec![b'a'; 256 * 1024]).unwrap();

        let bytes = read_refarm_config_bytes(&path).expect("expected bytes at exact limit");
        assert_eq!(bytes.len(), 256 * 1024);
    }

    #[test]
    fn refarm_config_reader_ignores_non_regular_file_entry() {
        let dir = tempfile::tempdir().unwrap();
        let refarm_dir = dir.path().join(".refarm");
        std::fs::create_dir_all(&refarm_dir).unwrap();
        let path = refarm_dir.join("config.json");
        std::fs::create_dir_all(&path).unwrap();

        let bytes = read_refarm_config_bytes(&path);
        assert!(bytes.is_none());
    }

    #[cfg(unix)]
    #[test]
    fn refarm_config_reader_ignores_symlink_entry() {
        let dir = tempfile::tempdir().unwrap();
        let refarm_dir = dir.path().join(".refarm");
        std::fs::create_dir_all(&refarm_dir).unwrap();

        let target = dir.path().join("real-config.json");
        std::fs::write(&target, br#"{"provider":"openai"}"#).unwrap();

        let link = refarm_dir.join("config.json");
        std::os::unix::fs::symlink(&target, &link).unwrap();

        let bytes = read_refarm_config_bytes(&link);
        assert!(bytes.is_none());
    }

    #[cfg(unix)]
    #[test]
    fn refarm_config_path_guard_accepts_matching_open_file() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("config.json");
        std::fs::write(&path, br#"{"provider":"openai"}"#).unwrap();

        let file = std::fs::File::open(&path).unwrap();
        assert!(refarm_config_path_matches_open_file(&path, &file));
    }

    #[cfg(unix)]
    #[test]
    fn refarm_config_path_guard_rejects_mismatched_open_file() {
        let dir = tempfile::tempdir().unwrap();
        let path_a = dir.path().join("a.json");
        let path_b = dir.path().join("b.json");
        std::fs::write(&path_a, br#"{"provider":"openai"}"#).unwrap();
        std::fs::write(&path_b, br#"{"provider":"ollama"}"#).unwrap();

        let file = std::fs::File::open(&path_a).unwrap();
        assert!(!refarm_config_path_matches_open_file(&path_b, &file));
    }

    #[test]
    fn refarm_config_json_from_reads_valid_json() {
        let dir = tempfile::tempdir().unwrap();
        let refarm_dir = dir.path().join(".refarm");
        std::fs::create_dir_all(&refarm_dir).unwrap();
        std::fs::write(
            refarm_dir.join("config.json"),
            r#"{"provider":"openai","model":"gpt-4o-mini"}"#,
        )
        .unwrap();

        let cfg = refarm_config_json_from(dir.path()).expect("config should parse");
        assert_eq!(cfg["provider"], "openai");
        assert_eq!(cfg["model"], "gpt-4o-mini");
    }

    #[test]
    fn refarm_config_json_from_returns_none_on_invalid_json() {
        let dir = tempfile::tempdir().unwrap();
        let refarm_dir = dir.path().join(".refarm");
        std::fs::create_dir_all(&refarm_dir).unwrap();
        std::fs::write(refarm_dir.join("config.json"), b"not-json").unwrap();

        let cfg = refarm_config_json_from(dir.path());
        assert!(cfg.is_none());
    }

    #[test]
    fn refarm_config_json_from_returns_none_on_oversized_file() {
        let dir = tempfile::tempdir().unwrap();
        let refarm_dir = dir.path().join(".refarm");
        std::fs::create_dir_all(&refarm_dir).unwrap();
        std::fs::write(refarm_dir.join("config.json"), vec![b'a'; 256 * 1024 + 1]).unwrap();

        let cfg = refarm_config_json_from(dir.path());
        assert!(cfg.is_none());
    }

    #[test]
    fn merge_plugin_env_vars_config_overrides_llm_vars() {
        let llm = vec![
            ("LLM_PROVIDER".to_string(), "openai".to_string()),
            ("LLM_MODEL".to_string(), "gpt-4o-mini".to_string()),
        ];
        let cfg = vec![
            ("LLM_PROVIDER".to_string(), "ollama".to_string()),
            ("LLM_BASE_URL".to_string(), "http://127.0.0.1:11434".to_string()),
        ];

        let merged = merge_plugin_env_vars(llm, cfg);
        let map: std::collections::HashMap<_, _> = merged.into_iter().collect();

        assert_eq!(map["LLM_PROVIDER"], "ollama");
        assert_eq!(map["LLM_MODEL"], "gpt-4o-mini");
        assert_eq!(map["LLM_BASE_URL"], "http://127.0.0.1:11434");
    }

    #[test]
    fn merge_plugin_env_vars_caps_total_entries() {
        let llm: Vec<(String, String)> = (0..220)
            .map(|i| (format!("LLM_SAFE_{i:03}"), "ok".to_string()))
            .collect();

        let merged = merge_plugin_env_vars(llm, vec![]);
        assert_eq!(merged.len(), 192);
    }

    #[test]
    fn merge_plugin_env_vars_caps_total_payload_bytes() {
        let llm: Vec<(String, String)> = (0..40)
            .map(|i| (format!("LLM_A{i:03}"), "x".repeat(3000)))
            .collect();

        let merged = merge_plugin_env_vars(llm, vec![]);
        assert_eq!(merged.len(), 32);
        assert!(merged.iter().any(|(k, _)| k == "LLM_A000"));
        assert!(merged.iter().any(|(k, _)| k == "LLM_A031"));
        assert!(!merged.iter().any(|(k, _)| k == "LLM_A032"));
    }

    #[test]
    fn refarm_config_node_payload_contains_expected_fields() {
        let dir = tempfile::tempdir().unwrap();
        let env_vars = vec![
            ("LLM_PROVIDER".to_string(), "ollama".to_string()),
            ("LLM_MODEL".to_string(), "llama3.2".to_string()),
        ];
        let cfg = serde_json::json!({"provider": "ollama", "model": "llama3.2"});

        let payload = refarm_config_node_payload("pi_agent", dir.path(), &env_vars, Some(&cfg));

        assert_eq!(payload["@type"], "RefarmConfig");
        assert_eq!(payload["plugin_id"], "pi_agent");
        assert_eq!(payload["llm_env"]["LLM_PROVIDER"], "ollama");
        assert_eq!(payload["config_json"]["model"], "llama3.2");
        assert!(payload["@id"].as_str().unwrap_or("").starts_with("urn:tractor:refarm-config:pi_agent:"));
    }

    #[test]
    fn store_refarm_config_node_persists_queryable_audit_record() {
        let storage = NativeStorage::open(":memory:").unwrap();
        let sync = NativeSync::new(storage, "test-refarm-config").unwrap();
        let dir = tempfile::tempdir().unwrap();
        let env_vars = vec![
            ("LLM_PROVIDER".to_string(), "ollama".to_string()),
            ("LLM_MODEL".to_string(), "llama3.2".to_string()),
        ];
        let cfg = serde_json::json!({"provider": "ollama", "model": "llama3.2"});

        store_refarm_config_node(&sync, "pi_agent", dir.path(), &env_vars, Some(&cfg)).unwrap();

        let rows = sync.query_nodes("RefarmConfig").unwrap();
        assert_eq!(rows.len(), 1);
        let row = &rows[0];
        assert_eq!(row.type_, "RefarmConfig");
        assert_eq!(row.source_plugin.as_deref(), Some("tractor-host"));

        let payload: serde_json::Value = serde_json::from_str(&row.payload).unwrap();
        assert_eq!(payload["@type"], "RefarmConfig");
        assert_eq!(payload["plugin_id"], "pi_agent");
        assert_eq!(payload["llm_env"]["LLM_PROVIDER"], "ollama");
    }

    #[test]
    fn refarm_config_node_payload_uses_null_config_when_missing() {
        let dir = tempfile::tempdir().unwrap();
        let env_vars = vec![("LLM_PROVIDER".to_string(), "ollama".to_string())];

        let payload = refarm_config_node_payload("pi_agent", dir.path(), &env_vars, None);

        assert_eq!(payload["@type"], "RefarmConfig");
        assert!(payload["config_json"].is_null());
    }
