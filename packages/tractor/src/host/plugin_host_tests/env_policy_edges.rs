    #[test]
    fn forwarded_model_env_vars_from_iter_filters_and_caps_entries() {
        let mut vars = vec![
            ("MODEL_PROVIDER".to_string(), "openai".to_string()),
            ("MODEL_TRUSTED_PLUGINS".to_string(), "agent".to_string()),
            ("MODEL_USER".to_string(), "alice".to_string()),
            ("MODEL_OPENAI_API_KEY".to_string(), "secret".to_string()),
            ("OTHER_VAR".to_string(), "x".to_string()),
            ("MODEL_BAD".to_string(), "bad\nvalue".to_string()),
        ];
        vars.extend((0..130).map(|i| (format!("MODEL_SAFE_{i}"), "ok".to_string())));

        let out = forwarded_model_env_vars_from_iter(vars);
        let map: std::collections::HashMap<_, _> = out.into_iter().collect();

        assert_eq!(map.get("MODEL_PROVIDER"), Some(&"openai".to_string()));
        assert!(!map.contains_key("MODEL_TRUSTED_PLUGINS"));
        assert!(!map.contains_key("MODEL_USER"));
        assert!(!map.contains_key("MODEL_OPENAI_API_KEY"));
        assert!(!map.contains_key("OTHER_VAR"));
        assert!(!map.contains_key("MODEL_BAD"));
        assert_eq!(map.len(), 128);
    }

    #[test]
    fn forwarded_model_env_vars_from_iter_caps_total_bytes() {
        let vars: Vec<(String, String)> = (0..40)
            .map(|i| (format!("MODEL_A{i:03}"), "x".repeat(3000)))
            .collect();

        let out = forwarded_model_env_vars_from_iter(vars);
        let map: std::collections::HashMap<_, _> = out.into_iter().collect();

        assert_eq!(map.len(), 21);
        assert!(map.contains_key("MODEL_A000"));
        assert!(map.contains_key("MODEL_A020"));
        assert!(!map.contains_key("MODEL_A021"));
    }

    #[test]
    fn forwarded_model_env_vars_from_iter_deduplicates_keys() {
        let vars = vec![
            ("MODEL_PROVIDER".to_string(), "openai".to_string()),
            ("MODEL_PROVIDER".to_string(), "ollama".to_string()),
            ("MODEL_ID".to_string(), "gpt-4.1-mini".to_string()),
        ];

        let out = forwarded_model_env_vars_from_iter(vars);
        let map: std::collections::HashMap<_, _> = out.into_iter().collect();

        assert_eq!(map.len(), 2);
        assert_eq!(map.get("MODEL_PROVIDER"), Some(&"openai".to_string()));
        assert_eq!(map.get("MODEL_ID"), Some(&"gpt-4.1-mini".to_string()));
    }

    #[test]
    fn forwarded_model_env_vars_from_iter_allows_stream_responses_flag() {
        let out = forwarded_model_env_vars_from_iter(vec![(
            "MODEL_STREAM_RESPONSES".to_string(),
            "1".to_string(),
        )]);
        let map: std::collections::HashMap<_, _> = out.into_iter().collect();

        assert_eq!(map.get("MODEL_STREAM_RESPONSES"), Some(&"1".to_string()));
    }

    #[test]
    fn forwarded_model_env_vars_from_iter_limits_input_scan_window() {
        let mut vars: Vec<(String, String)> = (0..512)
            .map(|i| (format!("OTHER_{i}"), "x".to_string()))
            .collect();
        vars.push(("MODEL_PROVIDER".to_string(), "openai".to_string()));

        let out = forwarded_model_env_vars_from_iter(vars);
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
        let vars = refarm_config_env_vars_from(dir.path(), None);
        let map: std::collections::HashMap<_, _> = vars.into_iter().collect();
        assert_eq!(map["MODEL_PROVIDER"], "anthropic");
        assert_eq!(map["MODEL_ID"], "claude-opus-4-7");
        assert_eq!(map["MODEL_DEFAULT_PROVIDER"], "ollama");
        assert_eq!(map["MODEL_BUDGET_ANTHROPIC_USD"], "5");
        assert_eq!(map["MODEL_BUDGET_OPENAI_USD"], "2.5");
    }

    #[test]
    fn refarm_config_env_vars_maps_stream_responses_bool() {
        let dir = tempfile::tempdir().unwrap();
        let refarm_dir = dir.path().join(".refarm");
        std::fs::create_dir_all(&refarm_dir).unwrap();
        std::fs::write(refarm_dir.join("config.json"), r#"{"stream_responses":true}"#)
            .unwrap();

        let vars = refarm_config_env_vars_from(dir.path(), None);
        let map: std::collections::HashMap<_, _> = vars.into_iter().collect();

        assert_eq!(map["MODEL_STREAM_RESPONSES"], "1");
    }

    #[test]
    fn refarm_config_env_vars_maps_stream_responses_false() {
        let dir = tempfile::tempdir().unwrap();
        let refarm_dir = dir.path().join(".refarm");
        std::fs::create_dir_all(&refarm_dir).unwrap();
        std::fs::write(refarm_dir.join("config.json"), r#"{"stream_responses":false}"#)
            .unwrap();

        let vars = refarm_config_env_vars_from(dir.path(), None);
        let map: std::collections::HashMap<_, _> = vars.into_iter().collect();

        assert_eq!(map["MODEL_STREAM_RESPONSES"], "0");
    }

    #[test]
    fn refarm_config_env_vars_ignores_non_bool_stream_responses() {
        let dir = tempfile::tempdir().unwrap();
        let refarm_dir = dir.path().join(".refarm");
        std::fs::create_dir_all(&refarm_dir).unwrap();
        std::fs::write(refarm_dir.join("config.json"), r#"{"stream_responses":"true"}"#)
            .unwrap();

        let vars = refarm_config_env_vars_from(dir.path(), None);
        let map: std::collections::HashMap<_, _> = vars.into_iter().collect();

        assert!(!map.contains_key("MODEL_STREAM_RESPONSES"));
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

        let vars = refarm_config_env_vars_from(dir.path(), None);
        let map: std::collections::HashMap<_, _> = vars.into_iter().collect();

        assert!(!map.contains_key("MODEL_BUDGET_ANTHROPIC_USD"));
        assert!(!map.contains_key("MODEL_BUDGET_OPENAI_USD"));
        assert_eq!(map["MODEL_BUDGET_OLLAMA_USD"], "1.25");
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

        let vars = refarm_config_env_vars_from(dir.path(), None);
        let map: std::collections::HashMap<_, _> = vars.into_iter().collect();

        assert_eq!(map["MODEL_PROVIDER"], "openai");
        assert_eq!(map["MODEL_DEFAULT_PROVIDER"], "ollama");
        assert!(!map.contains_key("MODEL_ID"));
    }

    #[test]
    fn refarm_config_env_vars_skip_string_fields_with_whitespace() {
        let dir = tempfile::tempdir().unwrap();
        let refarm_dir = dir.path().join(".refarm");
        std::fs::create_dir_all(&refarm_dir).unwrap();
        std::fs::write(
            refarm_dir.join("config.json"),
            r#"{"provider":"openai","model":"gpt 4.1-mini","default_provider":"ollama"}"#,
        )
        .unwrap();

        let vars = refarm_config_env_vars_from(dir.path(), None);
        let map: std::collections::HashMap<_, _> = vars.into_iter().collect();

        assert_eq!(map["MODEL_PROVIDER"], "openai");
        assert_eq!(map["MODEL_DEFAULT_PROVIDER"], "ollama");
        assert!(!map.contains_key("MODEL_ID"));
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

        let vars = refarm_config_env_vars_from(dir.path(), None);
        let map: std::collections::HashMap<_, _> = vars.into_iter().collect();

        assert!(!map.contains_key("MODEL_PROVIDER"));
        assert!(!map.contains_key("MODEL_ID"));
        assert_eq!(map["MODEL_DEFAULT_PROVIDER"], "ollama");
    }

    #[test]
    fn refarm_config_env_vars_skip_string_fields_with_non_ascii() {
        let dir = tempfile::tempdir().unwrap();
        let refarm_dir = dir.path().join(".refarm");
        std::fs::create_dir_all(&refarm_dir).unwrap();
        std::fs::write(
            refarm_dir.join("config.json"),
            r#"{"provider":"openai","model":"gpt-4o-miní","default_provider":"ollamá"}"#,
        )
        .unwrap();

        let vars = refarm_config_env_vars_from(dir.path(), None);
        let map: std::collections::HashMap<_, _> = vars.into_iter().collect();

        assert_eq!(map["MODEL_PROVIDER"], "openai");
        assert!(!map.contains_key("MODEL_ID"));
        assert!(!map.contains_key("MODEL_DEFAULT_PROVIDER"));
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

        let vars = refarm_config_env_vars_from(dir.path(), None);
        let map: std::collections::HashMap<_, _> = vars.into_iter().collect();

        assert!(!map.contains_key("MODEL_PROVIDER"));
        assert!(!map.contains_key("MODEL_ID"));
        assert_eq!(map["MODEL_DEFAULT_PROVIDER"], "ollama");
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

        let vars = refarm_config_env_vars_from(dir.path(), None);
        let map: std::collections::HashMap<_, _> = vars.into_iter().collect();

        assert_eq!(map["MODEL_PROVIDER"], "openai");
        assert_eq!(map["MODEL_DEFAULT_PROVIDER"], "ollama");
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

        let vars = refarm_config_env_vars_from(dir.path(), None);
        let map: std::collections::HashMap<_, _> = vars.into_iter().collect();

        assert!(!map.contains_key("MODEL_PROVIDER"));
        assert!(!map.contains_key("MODEL_DEFAULT_PROVIDER"));
        assert_eq!(map["MODEL_ID"], "gpt-4o-mini");
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

        let vars = refarm_config_env_vars_from(dir.path(), None);
        let map: std::collections::HashMap<_, _> = vars.into_iter().collect();

        assert_eq!(map["MODEL_BUDGET_OPENAI_USD"], "2.5");
        assert!(!map.contains_key("MODEL_BUDGET___USD"));
    }

    #[test]
    fn refarm_config_env_vars_skip_non_ascii_budget_provider_names() {
        let dir = tempfile::tempdir().unwrap();
        let refarm_dir = dir.path().join(".refarm");
        std::fs::create_dir_all(&refarm_dir).unwrap();
        std::fs::write(
            refarm_dir.join("config.json"),
            r#"{"budgets":{"opénai":2.5,"openai":1.0}}"#,
        )
        .unwrap();

        let vars = refarm_config_env_vars_from(dir.path(), None);
        let map: std::collections::HashMap<_, _> = vars.into_iter().collect();

        assert_eq!(map["MODEL_BUDGET_OPENAI_USD"], "1");
        assert_eq!(map.len(), 1);
    }

    #[test]
    fn refarm_config_env_vars_skip_budget_provider_names_with_whitespace() {
        let dir = tempfile::tempdir().unwrap();
        let refarm_dir = dir.path().join(".refarm");
        std::fs::create_dir_all(&refarm_dir).unwrap();
        std::fs::write(
            refarm_dir.join("config.json"),
            r#"{"budgets":{"open ai":2.5,"openai":1.0}}"#,
        )
        .unwrap();

        let vars = refarm_config_env_vars_from(dir.path(), None);
        let map: std::collections::HashMap<_, _> = vars.into_iter().collect();

        assert_eq!(map["MODEL_BUDGET_OPENAI_USD"], "1");
        assert_eq!(map.len(), 1);
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

        let vars = refarm_config_env_vars_from(dir.path(), None);
        let budget_count = vars
            .iter()
            .filter(|(k, _)| k.starts_with("MODEL_BUDGET_"))
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

        let vars = refarm_config_env_vars_from(dir.path(), None);
        let map: std::collections::HashMap<_, _> = vars.into_iter().collect();

        assert_eq!(map["MODEL_BUDGET_OPENAI_CODEX_V1_USD"], "2.5");
        assert!(!map.contains_key("MODEL_BUDGET___USD"));
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

        let vars = refarm_config_env_vars_from(dir.path(), None);
        let map: std::collections::HashMap<_, _> = vars.into_iter().collect();

        assert_eq!(map["MODEL_BUDGET_OPENAI_USD"], "1");
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

        let vars = refarm_config_env_vars_from(dir.path(), None);
        let map: std::collections::HashMap<_, _> = vars.into_iter().collect();

        assert_eq!(map["MODEL_BUDGET_OPENAI_USD"], "1");
        assert_eq!(map.len(), 1);
    }

    #[test]
    fn refarm_config_env_vars_dedupe_provider_and_budget_keys_after_normalization() {
        let dir = tempfile::tempdir().unwrap();
        let refarm_dir = dir.path().join(".refarm");
        std::fs::create_dir_all(&refarm_dir).unwrap();
        std::fs::write(
            refarm_dir.join("config.json"),
            r#"{"provider":"openai","budgets":{"openai-codex/v1":1.0,"openai-codex_v1":2.5}}"#,
        )
        .unwrap();

        let vars = refarm_config_env_vars_from(dir.path(), None);
        let map: std::collections::HashMap<_, _> = vars.into_iter().collect();

        assert_eq!(map["MODEL_PROVIDER"], "openai");
        assert_eq!(map["MODEL_BUDGET_OPENAI_CODEX_V1_USD"], "1");
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

        let vars = refarm_config_env_vars_from(dir.path(), None);
        let map: std::collections::HashMap<_, _> = vars.into_iter().collect();

        assert!(!map.contains_key("MODEL_BUDGET_OPENAI_USD"));
        assert_eq!(map["MODEL_BUDGET_OLLAMA_USD"], "0");
    }

    #[test]
    fn refarm_config_env_vars_ignores_invalid_json() {
        let dir = tempfile::tempdir().unwrap();
        let refarm_dir = dir.path().join(".refarm");
        std::fs::create_dir_all(&refarm_dir).unwrap();
        std::fs::write(refarm_dir.join("config.json"), b"not json").unwrap();
        let vars = refarm_config_env_vars_from(dir.path(), None);
        assert!(vars.is_empty());
    }

    #[test]
    fn refarm_config_env_vars_empty_when_no_file() {
        let dir = tempfile::tempdir().unwrap();
        let vars = refarm_config_env_vars_from(dir.path(), None);
        assert!(vars.is_empty());
    }

    #[test]
    fn refarm_config_env_vars_ignores_oversized_config_file() {
        let dir = tempfile::tempdir().unwrap();
        let refarm_dir = dir.path().join(".refarm");
        std::fs::create_dir_all(&refarm_dir).unwrap();
        std::fs::write(refarm_dir.join("config.json"), vec![b'a'; 256 * 1024 + 1]).unwrap();

        let vars = refarm_config_env_vars_from(dir.path(), None);
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

    #[cfg(unix)]
    #[test]
    fn refarm_config_path_guard_rejects_file_replaced_at_same_path() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("config.json");
        std::fs::write(&path, br#"{"provider":"openai"}"#).unwrap();

        let file = std::fs::File::open(&path).unwrap();

        let replacement = dir.path().join("replacement.json");
        std::fs::write(&replacement, br#"{"provider":"ollama"}"#).unwrap();
        std::fs::rename(&replacement, &path).unwrap();

        assert!(!refarm_config_path_matches_open_file(&path, &file));
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
    fn merge_plugin_env_vars_config_overrides_model_vars() {
        let model = vec![
            ("MODEL_PROVIDER".to_string(), "openai".to_string()),
            ("MODEL_ID".to_string(), "gpt-4o-mini".to_string()),
        ];
        let cfg = vec![
            ("MODEL_PROVIDER".to_string(), "ollama".to_string()),
            ("MODEL_BASE_URL".to_string(), "http://127.0.0.1:11434".to_string()),
        ];

        let merged = merge_plugin_env_vars(model, cfg);
        let map: std::collections::HashMap<_, _> = merged.into_iter().collect();

        assert_eq!(map["MODEL_PROVIDER"], "ollama");
        assert_eq!(map["MODEL_ID"], "gpt-4o-mini");
        assert_eq!(map["MODEL_BASE_URL"], "http://127.0.0.1:11434");
    }

    #[test]
    fn plugin_runtime_env_vars_forwards_streams_dir() {
        let previous = std::env::var("REFARM_STREAMS_DIR").ok();
        std::env::set_var("REFARM_STREAMS_DIR", "/tmp/refarm-streams-test");

        let vars = plugin_runtime_env_vars();
        let map: std::collections::HashMap<_, _> = vars.into_iter().collect();

        assert_eq!(
            map.get("REFARM_STREAMS_DIR"),
            Some(&"/tmp/refarm-streams-test".to_string())
        );

        if let Some(value) = previous {
            std::env::set_var("REFARM_STREAMS_DIR", value);
        } else {
            std::env::remove_var("REFARM_STREAMS_DIR");
        }
    }

    #[test]
    fn merge_plugin_env_vars_caps_total_entries() {
        let model: Vec<(String, String)> = (0..220)
            .map(|i| (format!("MODEL_SAFE_{i:03}"), "ok".to_string()))
            .collect();

        let merged = merge_plugin_env_vars(model, vec![]);
        assert_eq!(merged.len(), 192);
    }

    #[test]
    fn merge_plugin_env_vars_caps_total_payload_bytes() {
        let model: Vec<(String, String)> = (0..40)
            .map(|i| (format!("MODEL_A{i:03}"), "x".repeat(3000)))
            .collect();

        let merged = merge_plugin_env_vars(model, vec![]);
        assert_eq!(merged.len(), 32);
        assert!(merged.iter().any(|(k, _)| k == "MODEL_A000"));
        assert!(merged.iter().any(|(k, _)| k == "MODEL_A031"));
        assert!(!merged.iter().any(|(k, _)| k == "MODEL_A032"));
    }

    #[test]
    fn config_node_payload_is_the_unified_contract_and_redacts_secrets() {
        use crate::host::plugin_host::config_node::build_config_node_payload;
        let cfg = serde_json::json!({
            "provider": "ollama",
            "model": "llama3.2",
            "apiKey": "sk-super-secret",
            "budgets": { "openai": 10 },
        });

        let payload = build_config_node_payload(&cfg, "tractor-host");

        // The TS contract fields (config-node.js) — so the TS configFromNode accepts it.
        assert_eq!(payload["schema"], "refarm.config.node.v1");
        assert_eq!(payload["kind"], "refarm/config");
        assert_eq!(payload["id"], "urn:refarm:config:workspace");
        // The graph JSON-LD mirror — so query/reaper (type_) + payload readers work.
        assert_eq!(payload["@type"], "RefarmConfig");
        assert_eq!(payload["@id"], "urn:refarm:config:workspace");
        // data is the REDACTED sovereign config — the secret is gone, not the leak
        // (raw model_env) the old node replicated across devices.
        assert_eq!(payload["data"]["provider"], "ollama");
        assert_eq!(payload["data"]["apiKey"], "<redacted>");
        assert_eq!(payload["data"]["budgets"]["openai"], 10);
        assert_eq!(payload["evidence"]["redactedPaths"][0], "apiKey");
        assert!(payload["revision"].as_str().unwrap().starts_with("sha256:"));
    }

    #[test]
    fn store_config_node_upserts_one_node_not_an_accumulating_audit_log() {
        let storage = NativeStorage::open(":memory:").unwrap();
        let sync = NativeSync::new(storage, "test-refarm-config").unwrap();
        let cfg = serde_json::json!({"provider": "ollama", "model": "llama3.2"});

        // Two loads of the SAME config → one node (stable @id upsert), not two rows.
        store_refarm_config_node(&sync, Some(&cfg)).unwrap();
        store_refarm_config_node(&sync, Some(&cfg)).unwrap();

        let rows = sync.query_nodes("RefarmConfig").unwrap();
        assert_eq!(rows.len(), 1, "stable id must upsert, not accumulate");
        let row = &rows[0];
        assert_eq!(row.type_, "RefarmConfig");
        assert_eq!(row.source_plugin.as_deref(), Some("tractor-host"));
        let payload: serde_json::Value = serde_json::from_str(&row.payload).unwrap();
        assert_eq!(payload["schema"], "refarm.config.node.v1");
        assert_eq!(payload["data"]["provider"], "ollama");
    }

    #[test]
    fn store_config_node_is_a_noop_when_no_sovereign_config() {
        let storage = NativeStorage::open(":memory:").unwrap();
        let sync = NativeSync::new(storage, "test-refarm-config-none").unwrap();
        store_refarm_config_node(&sync, None).unwrap();
        assert_eq!(sync.query_nodes("RefarmConfig").unwrap().len(), 0);
    }

    #[test]
    fn config_resolves_from_the_graph_node_when_there_is_no_local_fs_file() {
        // The read-back that makes "config is a graph node" TRUE: a device with NO
        // local .refarm/config.json but a config node replicated from a peer reads
        // its MODEL_* config from the graph node's data.
        let storage = NativeStorage::open(":memory:").unwrap();
        let sync = NativeSync::new(storage, "test-config-readback").unwrap();
        // Publish a config node (as a peer's sync would have delivered it).
        let cfg = serde_json::json!({
            "provider": "anthropic",
            "model": "claude-opus-4-8",
            "budgets": { "anthropic": 5 },
        });
        store_refarm_config_node(&sync, Some(&cfg)).unwrap();

        // An EMPTY dir — no .refarm/config.json on this device.
        let empty = tempfile::tempdir().unwrap();
        let vars = refarm_config_env_vars_from(empty.path(), Some(&sync));
        let map: std::collections::HashMap<_, _> = vars.into_iter().collect();

        // Resolved from the graph node, not the (absent) fs file.
        assert_eq!(map["MODEL_PROVIDER"], "anthropic");
        assert_eq!(map["MODEL_ID"], "claude-opus-4-8");
        assert_eq!(map["MODEL_BUDGET_ANTHROPIC_USD"], "5");
    }

    #[test]
    fn local_fs_config_wins_over_the_graph_node() {
        // Precedence: the operator of THIS device (local fs) is authoritative; the
        // graph node is only the fallback. A local file must win over a differing
        // node so a synced config never silently overrides the local operator.
        let storage = NativeStorage::open(":memory:").unwrap();
        let sync = NativeSync::new(storage, "test-config-precedence").unwrap();
        store_refarm_config_node(
            &sync,
            Some(&serde_json::json!({ "provider": "from-graph-node" })),
        )
        .unwrap();

        let dir = tempfile::tempdir().unwrap();
        let refarm_dir = dir.path().join(".refarm");
        std::fs::create_dir_all(&refarm_dir).unwrap();
        std::fs::write(refarm_dir.join("config.json"), r#"{"provider":"from-local-fs"}"#).unwrap();

        let vars = refarm_config_env_vars_from(dir.path(), Some(&sync));
        let map: std::collections::HashMap<_, _> = vars.into_iter().collect();
        assert_eq!(
            map["MODEL_PROVIDER"], "from-local-fs",
            "the local fs file must win over the graph node"
        );
    }

    // ── B: grant read-back — the SECURITY axis, deny-dominates ─────────────────

    #[test]
    fn grants_resolve_from_the_node_when_there_is_no_local_fs_file() {
        // The leak B closes: a device with NO local .refarm/config.json but a config
        // node replicated from a peer reads its GRANTS from the node — not None
        // (permissive). The model reader already did this; the grant readers didn't.
        let storage = NativeStorage::open(":memory:").unwrap();
        let sync = NativeSync::new(storage, "test-grant-readback").unwrap();
        store_refarm_config_node(
            &sync,
            Some(&serde_json::json!({
                "trusted_plugins": ["vault"],
                "approvedPermissions": { "vault": ["fs:read"] },
            })),
        )
        .unwrap();

        let empty = tempfile::tempdir().unwrap(); // no local file on this device
        let trusted =
            crate::host::host_effects_bridge::resolve_trusted_plugins(empty.path(), Some(&sync))
                .unwrap()
                .expect("trusted resolved from node, not None");
        assert!(trusted.contains("vault"), "node allowlist must be honored cross-device");

        let approved =
            crate::host::host_effects_bridge::resolve_approved_permissions(empty.path(), Some(&sync))
                .unwrap()
                .expect("approved resolved from node, not None");
        assert_eq!(
            approved.get("vault"),
            Some(&std::collections::HashSet::from(["fs:read".to_string()]))
        );
    }

    #[test]
    fn grants_intersect_fs_and_node_deny_dominates() {
        // fs grants a WIDER set; the node (converged from a device that revoked) grants a
        // NARROWER set. The merge is the intersection — the revocation binds even though
        // the stale local file still lists the wider capability. Approving fewer restricts,
        // and the restriction converges across devices.
        let storage = NativeStorage::open(":memory:").unwrap();
        let sync = NativeSync::new(storage, "test-grant-intersect").unwrap();
        store_refarm_config_node(
            &sync,
            Some(&serde_json::json!({
                "trusted_plugins": ["vault"], // node dropped "quality"
                "approvedPermissions": { "vault": ["fs:read"] }, // node revoked network
            })),
        )
        .unwrap();

        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(dir.path().join(".refarm")).unwrap();
        std::fs::write(
            dir.path().join(".refarm/config.json"),
            r#"{"trusted_plugins":["vault","quality"],"approvedPermissions":{"vault":["fs:read","network:outbound"]}}"#,
        )
        .unwrap();

        let trusted =
            crate::host::host_effects_bridge::resolve_trusted_plugins(dir.path(), Some(&sync))
                .unwrap()
                .unwrap();
        // "quality" on fs but not node → dropped (deny dominates).
        assert!(trusted.contains("vault"));
        assert!(!trusted.contains("quality"), "revoked-on-node must not load from stale fs");

        let approved =
            crate::host::host_effects_bridge::resolve_approved_permissions(dir.path(), Some(&sync))
                .unwrap()
                .unwrap();
        // network:outbound on fs but revoked on node → dropped.
        assert_eq!(
            approved.get("vault"),
            Some(&std::collections::HashSet::from(["fs:read".to_string()]))
        );
    }

    #[test]
    fn grants_use_fs_when_there_is_no_node() {
        // A device with a local file but no config node yet → fs is the only signal
        // (row 2 of the merge table), unchanged from pre-B behavior.
        let storage = NativeStorage::open(":memory:").unwrap();
        let sync = NativeSync::new(storage, "test-grant-fs-only").unwrap(); // no node stored

        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(dir.path().join(".refarm")).unwrap();
        std::fs::write(
            dir.path().join(".refarm/config.json"),
            r#"{"trusted_plugins":["vault"]}"#,
        )
        .unwrap();

        let trusted =
            crate::host::host_effects_bridge::resolve_trusted_plugins(dir.path(), Some(&sync))
                .unwrap()
                .unwrap();
        assert!(trusted.contains("vault"));
    }

    // ── G: revocation tombstones (monotonic deny; a stale presence can't resurrect) ──

    use crate::host::plugin_host::revocation_node::{
        annulment_node_id, build_revocation_annulment_payload, build_revocation_tombstone_payload,
        capability_revocation_node_id, revocation_node_id, REVOCATION_NODE_TYPE,
    };

    fn seed_tombstone(sync: &NativeSync, plugin_id: &str, capability: Option<&str>) {
        seed_tombstone_seq(sync, plugin_id, capability, 1);
    }

    fn seed_tombstone_seq(sync: &NativeSync, plugin_id: &str, capability: Option<&str>, seq: u64) {
        let id = match capability {
            None => revocation_node_id(plugin_id),
            Some(c) => capability_revocation_node_id(plugin_id, c),
        };
        let payload = build_revocation_tombstone_payload(plugin_id, capability, seq);
        sync.store_node(&id, REVOCATION_NODE_TYPE, None, &payload.to_string(), Some("test"))
            .unwrap();
    }

    fn seed_annulment(sync: &NativeSync, plugin_id: &str, capability: Option<&str>, seq: u64) {
        let payload = build_revocation_annulment_payload(plugin_id, capability, seq);
        sync.store_node(
            &annulment_node_id(plugin_id, capability),
            REVOCATION_NODE_TYPE,
            None,
            &payload.to_string(),
            Some("test"),
        )
        .unwrap();
    }

    #[test]
    fn revoked_approved_cap_is_subtracted_after_merge() {
        // approvedPermissions grants vault [fs:read, network:outbound]; a tombstone
        // revokes network:outbound → the effective approved set drops it, monotonically.
        let storage = NativeStorage::open(":memory:").unwrap();
        let sync = NativeSync::new(storage, "test-revoke-cap").unwrap();
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(dir.path().join(".refarm")).unwrap();
        std::fs::write(
            dir.path().join(".refarm/config.json"),
            r#"{"approvedPermissions":{"vault":["fs:read","network:outbound"]}}"#,
        )
        .unwrap();

        seed_tombstone(&sync, "vault", Some("network:outbound"));

        let approved = crate::host::host_effects_bridge::resolve_approved_permissions(
            dir.path(),
            Some(&sync),
        )
        .unwrap()
        .unwrap();
        assert_eq!(
            approved.get("vault"),
            Some(&std::collections::HashSet::from(["fs:read".to_string()])),
            "revoked cap must be subtracted; a concurrent grant cannot resurrect it"
        );
    }

    #[test]
    fn whole_plugin_revocation_drops_all_its_approved_caps() {
        let storage = NativeStorage::open(":memory:").unwrap();
        let sync = NativeSync::new(storage, "test-revoke-plugin").unwrap();
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(dir.path().join(".refarm")).unwrap();
        std::fs::write(
            dir.path().join(".refarm/config.json"),
            r#"{"approvedPermissions":{"vault":["fs:read"],"quality":["fs:read"]}}"#,
        )
        .unwrap();

        seed_tombstone(&sync, "vault", None); // revoke the whole plugin

        let approved = crate::host::host_effects_bridge::resolve_approved_permissions(
            dir.path(),
            Some(&sync),
        )
        .unwrap()
        .unwrap();
        assert!(approved.get("vault").is_none(), "revoked plugin drops from the approved map");
        assert!(approved.get("quality").is_some(), "other plugins untouched");
    }

    #[test]
    fn resolve_revocations_collects_the_tombstones() {
        let storage = NativeStorage::open(":memory:").unwrap();
        let sync = NativeSync::new(storage, "test-collect-revoke").unwrap();
        seed_tombstone(&sync, "quality", None);
        seed_tombstone(&sync, "vault", Some("shell:spawn"));

        let ts = crate::host::host_effects_bridge::resolve_revocations(Some(&sync));
        assert!(ts.plugins.contains("quality"));
        assert!(ts.capabilities.get("vault").unwrap().contains("shell:spawn"));
    }

    #[test]
    fn host_materializes_config_revocations_into_tombstone_nodes() {
        // G2: the operator's add-only revocation list in the sovereign config is
        // projected into per-revocation graph tombstones at load — the write half.
        let storage = NativeStorage::open(":memory:").unwrap();
        let sync = NativeSync::new(storage, "test-materialize-revoke").unwrap();
        let config = serde_json::json!({
            "revokedPlugins": ["quality"],
            "revokedPermissions": { "vault": ["network:outbound"] },
        });

        materialize_revocation_tombstones(&sync, Some(&config)).unwrap();

        // The tombstones now exist as graph nodes and are collected by the read side.
        let ts = crate::host::host_effects_bridge::resolve_revocations(Some(&sync));
        assert!(ts.plugins.contains("quality"));
        assert!(ts.capabilities.get("vault").unwrap().contains("network:outbound"));

        // Idempotent: re-materializing the same config is a no-op upsert (same node ids).
        materialize_revocation_tombstones(&sync, Some(&config)).unwrap();
        let ts2 = crate::host::host_effects_bridge::resolve_revocations(Some(&sync));
        assert_eq!(ts, ts2);
    }

    #[test]
    fn resolve_revocations_nets_out_an_annulled_id() {
        // The read side: a revoke@1 + an annulment@2 for the same id → net not-revoked.
        let storage = NativeStorage::open(":memory:").unwrap();
        let sync = NativeSync::new(storage, "test-net-annul").unwrap();
        seed_tombstone_seq(&sync, "vault", None, 1);
        assert!(
            crate::host::host_effects_bridge::resolve_revocations(Some(&sync))
                .plugins
                .contains("vault"),
            "revoked before the annulment"
        );

        seed_annulment(&sync, "vault", None, 2);
        assert!(
            !crate::host::host_effects_bridge::resolve_revocations(Some(&sync))
                .plugins
                .contains("vault"),
            "annulment@2 nets out revoke@1"
        );
    }

    #[test]
    fn approved_cap_readmitted_after_annulment() {
        // End-to-end on the approved axis: a cap is revoked then un-revoked, and the
        // resolved approved set gets it back.
        let storage = NativeStorage::open(":memory:").unwrap();
        let sync = NativeSync::new(storage, "test-readmit-cap").unwrap();
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(dir.path().join(".refarm")).unwrap();
        std::fs::write(
            dir.path().join(".refarm/config.json"),
            r#"{"approvedPermissions":{"vault":["fs:read","network:outbound"]}}"#,
        )
        .unwrap();

        seed_tombstone_seq(&sync, "vault", Some("network:outbound"), 1);
        let scoped = crate::host::host_effects_bridge::resolve_approved_permissions(
            dir.path(),
            Some(&sync),
        )
        .unwrap()
        .unwrap();
        assert_eq!(scoped.get("vault"), Some(&std::collections::HashSet::from(["fs:read".to_string()])));

        // Un-revoke the cap: it is re-admitted into the approved set.
        seed_annulment(&sync, "vault", Some("network:outbound"), 2);
        let readmitted = crate::host::host_effects_bridge::resolve_approved_permissions(
            dir.path(),
            Some(&sync),
        )
        .unwrap()
        .unwrap();
        assert_eq!(
            readmitted.get("vault"),
            Some(&std::collections::HashSet::from([
                "fs:read".to_string(),
                "network:outbound".to_string()
            ])),
            "the un-revoked cap is re-admitted"
        );
    }

    #[test]
    fn host_materializes_annulment_and_nets_it_out() {
        // The write half of un-revoke: the config carries a revoke + an annul seq, the
        // host materializes both nodes, and the net resolves to not-revoked. A re-revoke
        // (bumped seq above the annul) denies again — reversible + monotone.
        let storage = NativeStorage::open(":memory:").unwrap();
        let sync = NativeSync::new(storage, "test-materialize-annul").unwrap();

        let revoked = serde_json::json!({ "revokedPlugins": ["vault"] });
        materialize_revocation_tombstones(&sync, Some(&revoked)).unwrap();
        assert!(
            crate::host::host_effects_bridge::resolve_revocations(Some(&sync))
                .plugins
                .contains("vault")
        );

        // Un-revoke: annul seq 2 > the base revoke seq 1.
        let unrevoked = serde_json::json!({
            "revokedPlugins": ["vault"],
            "revokedPluginsAnnul": { "vault": 2 },
        });
        materialize_revocation_tombstones(&sync, Some(&unrevoked)).unwrap();
        assert!(
            !crate::host::host_effects_bridge::resolve_revocations(Some(&sync))
                .plugins
                .contains("vault"),
            "materialized annulment nets out the revocation"
        );

        // Re-revoke: bump the revoke seq to 3 > annul 2 → denied again.
        let re_revoked = serde_json::json!({
            "revokedPlugins": ["vault"],
            "revokedPluginsSeq": { "vault": 3 },
            "revokedPluginsAnnul": { "vault": 2 },
        });
        materialize_revocation_tombstones(&sync, Some(&re_revoked)).unwrap();
        assert!(
            crate::host::host_effects_bridge::resolve_revocations(Some(&sync))
                .plugins
                .contains("vault"),
            "re-revoke with a higher seq denies again"
        );
    }

    // MANDATORY conformance: the Rust canonical digest MUST byte-match the TS
    // canonicalJson()+sha256 for the same config, or a node written by the tractor
    // and one written by the TS side would compute DIFFERENT revisions and defeat
    // the unification. The expected revisions below were produced by the TS encoder
    // (packages/config/src/config-node.js createConfigNode(...).revision) for these
    // exact inputs — INCLUDING the integer-valued float `budgets.openai:10`, which
    // JS emits as `10` (one number type) and naive serde would emit as `10.0`.
    #[test]
    fn config_node_revision_matches_the_ts_canonical_digest() {
        use crate::host::plugin_host::config_node::build_config_node_payload;
        let cases: &[(serde_json::Value, &str)] = &[
            (
                serde_json::json!({ "provider": "ollama" }),
                "sha256:a0a1c09f1df2debd141a0dfb9d78905c1a573a7b401b76fba76650eaff4a5f5a",
            ),
            (
                serde_json::json!({
                    "provider": "ollama",
                    "model": "llama3.2",
                    "apiKey": "sk-secret",
                    "budgets": { "openai": 10 }
                }),
                "sha256:f18c3af84c62eda4771cabb72074e4f09b4a882e11d43ef5f29f2a9a82439006",
            ),
        ];
        for (config, expected_revision) in cases {
            let payload = build_config_node_payload(config, "tractor-host");
            assert_eq!(
                payload["revision"].as_str(),
                Some(*expected_revision),
                "Rust digest must byte-match the TS revision for {config}"
            );
        }

        // The load-bearing number case: 10 and 10.0 must canonicalize identically
        // (JS has one number type), and key order must not change the digest.
        let intkey = build_config_node_payload(&serde_json::json!({"budgets": {"openai": 10}}), "t");
        let flat = build_config_node_payload(&serde_json::json!({"budgets": {"openai": 10.0}}), "t");
        assert_eq!(intkey["revision"], flat["revision"], "10 vs 10.0 must canonicalize the same");
        let a = build_config_node_payload(&serde_json::json!({"a": 1, "b": 2}), "t");
        let b = build_config_node_payload(&serde_json::json!({"b": 2, "a": 1}), "t");
        assert_eq!(a["revision"], b["revision"], "key order must not change the digest");
    }
