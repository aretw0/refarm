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
    async fn spawn_rejects_blocked_loader_env_keys() {
        let argv = vec!["echo".to_string(), "ok".to_string()];

        let cases = [
            ("LD_PRELOAD", "evil.so"),
            ("ld_audit", "evil.so"),
            ("DYLD_FRAMEWORK_PATH", "/tmp/pwn-fw"),
            ("DYLD_FALLBACK_LIBRARY_PATH", "/tmp/pwn-dylib"),
        ];

        for (key, value) in cases {
            let err = spawn_process(
                &argv,
                &[(key.to_string(), value.to_string())],
                None,
                1000,
                None,
            )
            .await
            .unwrap_err();
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
            let err = spawn_process(
                &argv,
                &[(key.to_string(), value.to_string())],
                None,
                1000,
                None,
            )
            .await
            .unwrap_err();
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
            ("LUA_PATH", "/tmp/pwn-lua"),
            ("LUA_CPATH", "/tmp/pwn-lua-c"),
        ];

        for (key, value) in cases {
            let err = spawn_process(
                &argv,
                &[(key.to_string(), value.to_string())],
                None,
                1000,
                None,
            )
            .await
            .unwrap_err();
            assert!(
                err.contains("blocked env key"),
                "expected blocked env key for {key}, got: {err}"
            );
        }
    }

    #[tokio::test]
    async fn spawn_rejects_duplicate_env_keys() {
        let argv = vec!["echo".to_string(), "ok".to_string()];
        let env = vec![
            ("SAFE_KEY".to_string(), "one".to_string()),
            ("SAFE_KEY".to_string(), "two".to_string()),
        ];
        let err = spawn_process(&argv, &env, None, 1000, None).await.unwrap_err();
        assert!(err.contains("duplicate env key"));
    }

    #[tokio::test]
    async fn spawn_rejects_duplicate_env_keys_case_insensitive() {
        let argv = vec!["echo".to_string(), "ok".to_string()];
        let env = vec![
            ("SAFE_KEY".to_string(), "one".to_string()),
            ("safe_key".to_string(), "two".to_string()),
        ];
        let err = spawn_process(&argv, &env, None, 1000, None).await.unwrap_err();
        assert!(err.contains("duplicate env key"));
    }

    #[tokio::test]
    async fn spawn_rejects_too_many_env_vars() {
        let argv = vec!["echo".to_string(), "ok".to_string()];
        let env: Vec<(String, String)> = (0..129)
            .map(|i| (format!("K{i}"), "x".to_string()))
            .collect();
        let err = spawn_process(&argv, &env, None, 1000, None).await.unwrap_err();
        assert!(err.contains("too many env vars"));
    }

    #[tokio::test]
    async fn spawn_rejects_overlong_total_env_payload() {
        let argv = vec!["echo".to_string(), "ok".to_string()];
        let env: Vec<(String, String)> = (0..44)
            .map(|i| (format!("K{i}"), "x".repeat(3000)))
            .collect();
        let err = spawn_process(&argv, &env, None, 1000, None).await.unwrap_err();
        assert!(err.contains("env payload exceeds max total bytes"));
    }

    #[tokio::test]
    async fn spawn_rejects_cwd_with_control_chars() {
        let argv = vec!["echo".to_string(), "ok".to_string()];
        let err = spawn_process(&argv, &[], Some("/tmp\nboom"), 1000, None)
            .await
            .unwrap_err();
        assert!(err.contains("cwd contains control characters"));
    }

    #[tokio::test]
    async fn spawn_rejects_cwd_with_non_ascii() {
        let argv = vec!["echo".to_string(), "ok".to_string()];
        let err = spawn_process(&argv, &[], Some("/tmp/olá"), 1000, None)
            .await
            .unwrap_err();
        assert!(err.contains("cwd must be ascii"));
    }

    #[tokio::test]
    async fn spawn_rejects_cwd_with_internal_whitespace() {
        let argv = vec!["echo".to_string(), "ok".to_string()];
        let err = spawn_process(&argv, &[], Some("/tmp/white space"), 1000, None)
            .await
            .unwrap_err();
        assert!(err.contains("cwd must not contain whitespace"));
    }

    #[test]
    fn spawn_cwd_within_fs_root_is_allowed() {
        let root_dir = tempfile::tempdir().unwrap();
        let root = std::fs::canonicalize(root_dir.path()).unwrap();
        let inside = root.join("subdir");

        let ok = enforce_spawn_cwd_with(inside.to_string_lossy().as_ref(), Some(&root));
        assert!(ok.is_ok(), "expected cwd inside root to be allowed: {ok:?}");
    }

    #[test]
    fn spawn_cwd_outside_fs_root_is_blocked() {
        let root_dir = tempfile::tempdir().unwrap();
        let outside_dir = tempfile::tempdir().unwrap();
        let root = std::fs::canonicalize(root_dir.path()).unwrap();
        let outside = outside_dir.path().join("elsewhere");

        let err = enforce_spawn_cwd_with(outside.to_string_lossy().as_ref(), Some(&root)).unwrap_err();
        assert!(err.contains("cwd outside LLM_FS_ROOT"));
    }

    #[test]
    fn spawn_timeout_has_floor_and_cap() {
        assert_eq!(effective_spawn_timeout_ms(0), 1);
        assert_eq!(effective_spawn_timeout_ms(1), 1);
        assert_eq!(effective_spawn_timeout_ms(300_000), 300_000);
        assert_eq!(effective_spawn_timeout_ms(300_001), 300_000);
    }

    #[test]
    fn shell_allowlist_allows_bare_binary_name() {
        let allowlist = parse_shell_allowlist("ls,grep");

        let direct = vec!["ls".to_string(), "-la".to_string()];
        assert!(enforce_shell_allowlist_with(&direct, Some(&allowlist)).is_ok());
    }

    #[test]
    fn shell_allowlist_blocks_path_when_only_basename_allowed() {
        let allowlist = parse_shell_allowlist("ls,grep");

        let absolute = vec!["/bin/ls".to_string(), "-la".to_string()];
        let err = enforce_shell_allowlist_with(&absolute, Some(&allowlist)).unwrap_err();
        assert!(err.contains("/bin/ls not in allowlist"));
    }

    #[test]
    fn shell_allowlist_allows_exact_binary_path_entry() {
        let allowlist = parse_shell_allowlist("/bin/ls");

        let absolute = vec!["/bin/ls".to_string(), "-la".to_string()];
        assert!(enforce_shell_allowlist_with(&absolute, Some(&allowlist)).is_ok());
    }

    #[test]
    fn shell_allowlist_blocks_unknown_command() {
        let allowlist = parse_shell_allowlist("ls,grep");
        let argv = vec!["cat".to_string()];
        let err = enforce_shell_allowlist_with(&argv, Some(&allowlist)).unwrap_err();
        assert!(err.contains("not in allowlist"));
    }

    #[test]
    fn shell_allowlist_empty_string_blocks_all() {
        let allowlist = parse_shell_allowlist("   ");
        let argv = vec!["echo".to_string()];
        assert!(enforce_shell_allowlist_with(&argv, Some(&allowlist)).is_err());
    }

    #[test]
    fn shell_allowlist_unset_is_permissive() {
        let argv = vec!["echo".to_string(), "ok".to_string()];
        let result = enforce_shell_allowlist_with(&argv, None);
        assert!(result.is_ok());
    }

    #[test]
    fn shell_allowlist_unset_still_enforces_argv_count_cap() {
        let mut argv = vec!["echo".to_string()];
        argv.extend((0..128).map(|i| i.to_string()));

        let err = enforce_shell_allowlist_with(&argv, None).unwrap_err();
        assert!(err.contains("too many argv entries"));
    }

    #[test]
    fn shell_allowlist_env_unset_wrapper_still_enforces_argv_count_cap() {
        let _guard = ENV_LOCK.lock().unwrap();
        let prev = std::env::var("LLM_SHELL_ALLOWLIST").ok();
        std::env::remove_var("LLM_SHELL_ALLOWLIST");

        let mut argv = vec!["echo".to_string()];
        argv.extend((0..128).map(|i| i.to_string()));

        let err = enforce_shell_allowlist(&argv).unwrap_err();
        assert!(err.contains("too many argv entries"));

        if let Some(prev) = prev {
            std::env::set_var("LLM_SHELL_ALLOWLIST", prev);
        }
    }

    #[test]
    fn shell_allowlist_rejects_overlong_argv_entry() {
        let allowlist = parse_shell_allowlist("*");
        let argv = vec!["echo".to_string(), "a".repeat(4097)];

        let err = enforce_shell_allowlist_with(&argv, Some(&allowlist)).unwrap_err();
        assert!(err.contains("argv entry exceeds max length"));
    }

    #[test]
    fn shell_allowlist_rejects_overlong_total_argv_payload() {
        let allowlist = parse_shell_allowlist("*");
        let mut argv = vec!["echo".to_string()];
        argv.extend((0..20).map(|_| "a".repeat(4000)));

        let err = enforce_shell_allowlist_with(&argv, Some(&allowlist)).unwrap_err();
        assert!(err.contains("argv payload exceeds max total bytes"));
    }

    #[test]
    fn shell_allowlist_wildcard_allows_any_command() {
        let allowlist = parse_shell_allowlist(" * ");
        let argv = vec!["definitely-not-in-list".to_string()];
        let result = enforce_shell_allowlist_with(&argv, Some(&allowlist));
        assert!(result.is_ok());
    }

    #[test]
    fn shell_allowlist_wildcard_still_rejects_empty_argv() {
        let allowlist = parse_shell_allowlist("*");
        let argv = vec![];
        let result = enforce_shell_allowlist_with(&argv, Some(&allowlist));
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("argv must be non-empty"));
    }

    #[test]
    fn shell_allowlist_rejects_too_many_argv_entries() {
        let allowlist = parse_shell_allowlist("*");
        let mut argv = vec!["echo".to_string()];
        argv.extend((0..128).map(|i| i.to_string()));

        let result = enforce_shell_allowlist_with(&argv, Some(&allowlist));
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("too many argv entries"));
    }

    #[test]
    fn shell_allowlist_rejects_binary_with_surrounding_whitespace() {
        let allowlist = parse_shell_allowlist("ls");
        let argv = vec![" ls ".to_string()];
        let err = enforce_shell_allowlist_with(&argv, Some(&allowlist)).unwrap_err();
        assert!(err.contains("surrounding whitespace"));
    }

    #[test]
    fn shell_allowlist_rejects_empty_binary_token() {
        let allowlist = parse_shell_allowlist("*");
        let argv = vec!["".to_string()];
        let err = enforce_shell_allowlist_with(&argv, Some(&allowlist)).unwrap_err();
        assert!(err.contains("binary must be non-empty"));
    }

    #[test]
    fn shell_allowlist_rejects_binary_with_control_characters() {
        let allowlist = parse_shell_allowlist("*");
        let argv = vec!["l\ns".to_string()];
        let err = enforce_shell_allowlist_with(&argv, Some(&allowlist)).unwrap_err();
        assert!(err.contains("control characters"));
    }

    #[test]
    fn shell_allowlist_rejects_binary_with_internal_whitespace() {
        let allowlist = parse_shell_allowlist("*");
        let argv = vec!["my cmd".to_string()];
        let err = enforce_shell_allowlist_with(&argv, Some(&allowlist)).unwrap_err();
        assert!(err.contains("contains whitespace"));
    }

    #[test]
    fn shell_allowlist_rejects_non_ascii_binary() {
        let allowlist = parse_shell_allowlist("*");
        let argv = vec!["échø".to_string()];
        let err = enforce_shell_allowlist_with(&argv, Some(&allowlist)).unwrap_err();
        assert!(err.contains("must be ascii"));
    }

    #[test]
    fn shell_allowlist_parser_ignores_empty_entries_and_trims_whitespace() {
        let allowlist = parse_shell_allowlist(" ls , ,grep,   cat  ,");
        assert!(allowlist.contains("ls"));
        assert!(allowlist.contains("grep"));
        assert!(allowlist.contains("cat"));
        assert_eq!(allowlist.len(), 3);
    }

    #[test]
    fn shell_allowlist_parser_drops_entries_with_control_characters() {
        let allowlist = parse_shell_allowlist("ls,gr\nep,cat");
        assert!(allowlist.contains("ls"));
        assert!(allowlist.contains("cat"));
        assert!(!allowlist.contains("gr\nep"));
        assert_eq!(allowlist.len(), 2);
    }

    #[test]
    fn shell_allowlist_parser_drops_entries_with_whitespace() {
        let allowlist = parse_shell_allowlist("ls,my cmd,cat");
        assert!(allowlist.contains("ls"));
        assert!(allowlist.contains("cat"));
        assert!(!allowlist.contains("my cmd"));
        assert_eq!(allowlist.len(), 2);
    }

    #[test]
    fn shell_allowlist_parser_drops_non_ascii_entries() {
        let allowlist = parse_shell_allowlist("ls,échø,cat");
        assert!(allowlist.contains("ls"));
        assert!(allowlist.contains("cat"));
        assert!(!allowlist.contains("échø"));
        assert_eq!(allowlist.len(), 2);
    }

    #[test]
    fn shell_allowlist_parser_wildcard_is_exclusive() {
        let allowlist = parse_shell_allowlist("ls,*,cat");
        assert!(allowlist.contains("*"));
        assert_eq!(allowlist.len(), 1);
    }

    #[test]
    fn shell_allowlist_parser_drops_overlong_entries() {
        let overlong = "a".repeat(257);
        let allowlist = parse_shell_allowlist(&format!("ls,{overlong},cat"));
        assert!(allowlist.contains("ls"));
        assert!(allowlist.contains("cat"));
        assert!(!allowlist.contains(&overlong));
        assert_eq!(allowlist.len(), 2);
    }

    #[test]
    fn shell_allowlist_parser_caps_entry_count() {
        let raw = (0..300)
            .map(|i| format!("cmd{i}"))
            .collect::<Vec<_>>()
            .join(",");
        let allowlist = parse_shell_allowlist(&raw);

        assert_eq!(allowlist.len(), 256);
        assert!(allowlist.contains("cmd0"));
        assert!(allowlist.contains("cmd255"));
        assert!(!allowlist.contains("cmd256"));
    }

    #[test]
    fn shell_allowlist_parser_limits_input_scan_window() {
        let mut entries = vec!["bad cmd".to_string(); 512];
        entries.push("echo".to_string());
        let raw = entries.join(",");

        let allowlist = parse_shell_allowlist(&raw);
        assert!(!allowlist.contains("echo"));
    }

    #[test]
    fn shell_allowlist_parser_blocks_overlong_raw_input() {
        let raw = "a".repeat(16 * 1024 + 1);
        let allowlist = parse_shell_allowlist(&raw);
        assert!(allowlist.is_empty());
    }

    #[test]
    fn shell_allowlist_rejects_overlong_binary() {
        let allowlist = parse_shell_allowlist("*");
        let argv = vec!["a".repeat(257)];
        let err = enforce_shell_allowlist_with(&argv, Some(&allowlist)).unwrap_err();
        assert!(err.contains("exceeds max length"));
    }

    #[test]
    fn configured_fs_root_rejects_surrounding_whitespace() {
        let _guard = ENV_LOCK.lock().unwrap();
        let prev = std::env::var("LLM_FS_ROOT").ok();

        let dir = tempfile::tempdir().unwrap();
        let raw = format!(" {} ", dir.path().to_string_lossy());
        std::env::set_var("LLM_FS_ROOT", raw);

        let err = configured_fs_root().unwrap_err();
        assert!(err.contains("surrounding whitespace"));

        if let Some(prev) = prev {
            std::env::set_var("LLM_FS_ROOT", prev);
        } else {
            std::env::remove_var("LLM_FS_ROOT");
        }
    }

    #[test]
    fn configured_fs_root_rejects_non_directory_path() {
        let _guard = ENV_LOCK.lock().unwrap();
        let prev = std::env::var("LLM_FS_ROOT").ok();

        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("root.txt");
        std::fs::write(&file, b"not-a-dir").unwrap();
        std::env::set_var("LLM_FS_ROOT", file.to_string_lossy().as_ref());

        let err = configured_fs_root().unwrap_err();
        assert!(err.contains("must be a directory"));

        if let Some(prev) = prev {
            std::env::set_var("LLM_FS_ROOT", prev);
        } else {
            std::env::remove_var("LLM_FS_ROOT");
        }
    }

    #[test]
    fn configured_fs_root_rejects_control_chars() {
        let _guard = ENV_LOCK.lock().unwrap();
        let prev = std::env::var("LLM_FS_ROOT").ok();

        std::env::set_var("LLM_FS_ROOT", "/tmp/root\n");

        let err = configured_fs_root().unwrap_err();
        assert!(err.contains("contains control characters"));

        if let Some(prev) = prev {
            std::env::set_var("LLM_FS_ROOT", prev);
        } else {
            std::env::remove_var("LLM_FS_ROOT");
        }
    }

    #[test]
    fn configured_fs_root_rejects_overlong_value() {
        let _guard = ENV_LOCK.lock().unwrap();
        let prev = std::env::var("LLM_FS_ROOT").ok();

        std::env::set_var("LLM_FS_ROOT", format!("/{}", "a".repeat(4097)));

        let err = configured_fs_root().unwrap_err();
        assert!(err.contains("exceeds max length"));

        if let Some(prev) = prev {
            std::env::set_var("LLM_FS_ROOT", prev);
        } else {
            std::env::remove_var("LLM_FS_ROOT");
        }
    }

    #[test]
    fn fs_root_allows_paths_inside_root() {
        let dir = tempfile::tempdir().unwrap();
        let root = std::fs::canonicalize(dir.path()).unwrap();
        let file = root.join("safe.txt");

        let result = enforce_fs_root_with(file.to_string_lossy().as_ref(), Some(&root));
        assert!(result.is_ok(), "inside path should be allowed: {result:?}");
    }

    #[test]
    fn fs_root_blocks_paths_outside_root() {
        let root_dir = tempfile::tempdir().unwrap();
        let outside_dir = tempfile::tempdir().unwrap();
        let root = std::fs::canonicalize(root_dir.path()).unwrap();
        let outside = outside_dir.path().join("escape.txt");

        let err = enforce_fs_root_with(outside.to_string_lossy().as_ref(), Some(&root)).unwrap_err();
        assert!(err.contains("path outside LLM_FS_ROOT"));
    }

    #[test]
    fn fs_root_blocks_paths_with_control_chars() {
        let root_dir = tempfile::tempdir().unwrap();
        let root = std::fs::canonicalize(root_dir.path()).unwrap();
        let err = enforce_fs_root_with("safe\nname.txt", Some(&root)).unwrap_err();
        assert!(err.contains("control characters"));
    }

    #[test]
    fn fs_root_blocks_empty_path() {
        let root_dir = tempfile::tempdir().unwrap();
        let root = std::fs::canonicalize(root_dir.path()).unwrap();
        let err = enforce_fs_root_with("", Some(&root)).unwrap_err();
        assert!(err.contains("must be non-empty"));
    }

    #[test]
    fn fs_root_blocks_path_with_surrounding_whitespace() {
        let root_dir = tempfile::tempdir().unwrap();
        let root = std::fs::canonicalize(root_dir.path()).unwrap();
        let err = enforce_fs_root_with(" safe.txt ", Some(&root)).unwrap_err();
        assert!(err.contains("surrounding whitespace"));
    }

    #[test]
    fn fs_root_blocks_non_ascii_path() {
        let root_dir = tempfile::tempdir().unwrap();
        let root = std::fs::canonicalize(root_dir.path()).unwrap();
        let err = enforce_fs_root_with("arquivo-ç.txt", Some(&root)).unwrap_err();
        assert!(err.contains("path must be ascii"));
    }

    #[test]
    fn fs_root_blocks_overlong_paths() {
        let root_dir = tempfile::tempdir().unwrap();
        let root = std::fs::canonicalize(root_dir.path()).unwrap();
        let path = format!("/{}", "a".repeat(4097));
        let err = enforce_fs_root_with(&path, Some(&root)).unwrap_err();
        assert!(err.contains("exceeds max length"));
    }

    #[test]
    fn fs_root_empty_marker_blocks_all_paths() {
        let err = enforce_fs_root_with("/tmp/anything", Some(Path::new(""))).unwrap_err();
        assert!(err.contains("path outside LLM_FS_ROOT"));
    }

    #[test]
    fn fs_root_blocks_parent_escape_sequence() {
        let root_dir = tempfile::tempdir().unwrap();
        let root = std::fs::canonicalize(root_dir.path()).unwrap();
        let escape = root.join("..").join("outside.txt");

        let err = enforce_fs_root_with(escape.to_string_lossy().as_ref(), Some(&root)).unwrap_err();
        assert!(err.contains("path outside LLM_FS_ROOT"));
    }

    #[test]
    fn fs_root_blocks_parent_escape_through_missing_segments() {
        let root_dir = tempfile::tempdir().unwrap();
        let root = std::fs::canonicalize(root_dir.path()).unwrap();
        let escape = root
            .join("newdir")
            .join("..")
            .join("..")
            .join("outside.txt");

        let err = enforce_fs_root_with(escape.to_string_lossy().as_ref(), Some(&root)).unwrap_err();
        assert!(
            err.contains("path outside LLM_FS_ROOT") || err.contains("resolve path("),
            "unexpected error: {err}"
        );
    }

    #[test]
    fn trusted_plugins_parse_none_when_unset() {
        let cfg = serde_json::json!({"provider": "ollama"});
        let parsed = parse_trusted_plugins(&cfg).unwrap();
        assert!(parsed.is_none());
    }

    #[test]
    fn trusted_plugins_config_reader_returns_none_when_file_missing() {
        let dir = tempfile::tempdir().unwrap();
        let missing = dir.path().join(".refarm").join("config.json");

        let bytes = read_trusted_plugins_config_bytes(&missing).unwrap();
        assert!(bytes.is_none());
    }

    #[test]
    fn trusted_plugins_config_reader_blocks_oversized_file() {
        let dir = tempfile::tempdir().unwrap();
        let refarm_dir = dir.path().join(".refarm");
        std::fs::create_dir_all(&refarm_dir).unwrap();
        let path = refarm_dir.join("config.json");
        std::fs::write(&path, vec![b'a'; 256 * 1024 + 1]).unwrap();

        let err = read_trusted_plugins_config_bytes(&path).unwrap_err();
        assert!(err.contains("exceeds max size"));
    }

    #[test]
    fn trusted_plugins_config_reader_allows_exact_limit_file() {
        let dir = tempfile::tempdir().unwrap();
        let refarm_dir = dir.path().join(".refarm");
        std::fs::create_dir_all(&refarm_dir).unwrap();
        let path = refarm_dir.join("config.json");
        std::fs::write(&path, vec![b'a'; 256 * 1024]).unwrap();

        let bytes = read_trusted_plugins_config_bytes(&path)
            .unwrap()
            .expect("expected bytes at exact limit");
        assert_eq!(bytes.len(), 256 * 1024);
    }

    #[test]
    fn trusted_plugins_config_reader_blocks_non_regular_file_entry() {
        let dir = tempfile::tempdir().unwrap();
        let refarm_dir = dir.path().join(".refarm");
        std::fs::create_dir_all(&refarm_dir).unwrap();
        let path = refarm_dir.join("config.json");
        std::fs::create_dir_all(&path).unwrap();

        let err = read_trusted_plugins_config_bytes(&path).unwrap_err();
        assert!(err.contains("must be a regular file"));
    }

    #[cfg(unix)]
    #[test]
    fn trusted_plugins_config_reader_blocks_symlink_entry() {
        let dir = tempfile::tempdir().unwrap();
        let refarm_dir = dir.path().join(".refarm");
        std::fs::create_dir_all(&refarm_dir).unwrap();

        let target = dir.path().join("real-config.json");
        std::fs::write(&target, br#"{"trusted_plugins":["pi_agent"]}"#).unwrap();

        let link = refarm_dir.join("config.json");
        std::os::unix::fs::symlink(&target, &link).unwrap();

        let err = read_trusted_plugins_config_bytes(&link).unwrap_err();
        assert!(err.contains("must be a regular file"));
    }

    #[cfg(unix)]
    #[test]
    fn trusted_plugins_config_path_guard_allows_matching_open_file() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("config.json");
        std::fs::write(&path, br#"{"trusted_plugins":["pi_agent"]}"#).unwrap();

        let file = std::fs::File::open(&path).unwrap();
        let result = ensure_trusted_plugins_config_path_matches_open_file(&path, &file);
        assert!(result.is_ok(), "expected guard to accept matching file: {result:?}");
    }

    #[cfg(unix)]
    #[test]
    fn trusted_plugins_config_path_guard_blocks_mismatched_open_file() {
        let dir = tempfile::tempdir().unwrap();
        let path_a = dir.path().join("a.json");
        let path_b = dir.path().join("b.json");
        std::fs::write(&path_a, br#"{"trusted_plugins":["a"]}"#).unwrap();
        std::fs::write(&path_b, br#"{"trusted_plugins":["b"]}"#).unwrap();

        let file = std::fs::File::open(&path_a).unwrap();
        let err = ensure_trusted_plugins_config_path_matches_open_file(&path_b, &file).unwrap_err();
        assert!(err.contains("changed during trusted_plugins read"));
    }

    #[cfg(unix)]
    #[test]
    fn trusted_plugins_config_path_guard_blocks_file_replaced_at_same_path() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("config.json");
        std::fs::write(&path, br#"{"trusted_plugins":["a"]}"#).unwrap();

        let file = std::fs::File::open(&path).unwrap();

        let replacement = dir.path().join("replacement.json");
        std::fs::write(&replacement, br#"{"trusted_plugins":["b"]}"#).unwrap();
        std::fs::rename(&replacement, &path).unwrap();

        let err = ensure_trusted_plugins_config_path_matches_open_file(&path, &file).unwrap_err();
        assert!(err.contains("changed during trusted_plugins read"));
    }

    #[test]
    fn trusted_plugins_parse_blocks_invalid_type() {
        let cfg = serde_json::json!({"trusted_plugins": "pi_agent"});
        let err = parse_trusted_plugins(&cfg).unwrap_err();
        assert!(err.contains("trusted_plugins must be an array"));
    }

    #[test]
    fn trusted_plugins_parse_blocks_too_many_entries() {
        let entries: Vec<serde_json::Value> = (0..257)
            .map(|i| serde_json::Value::String(format!("plugin-{i}")))
            .collect();
        let cfg = serde_json::json!({"trusted_plugins": entries});
        let err = parse_trusted_plugins(&cfg).unwrap_err();
        assert!(err.contains("exceeds max entries"));
    }

    #[test]
    fn trusted_plugins_parse_allows_only_strings() {
        let cfg = serde_json::json!({"trusted_plugins": ["pi_agent", "agent-tools", " "]});
        let parsed = parse_trusted_plugins(&cfg).unwrap().unwrap();
        assert!(parsed.contains("pi_agent"));
        assert!(parsed.contains("agent-tools"));
        assert!(!parsed.contains(""));
    }

    #[test]
    fn trusted_plugins_parse_blocks_control_characters() {
        let cfg = serde_json::json!({"trusted_plugins": ["pi\n_agent"]});
        let err = parse_trusted_plugins(&cfg).unwrap_err();
        assert!(err.contains("cannot contain control characters"));
    }

    #[test]
    fn trusted_plugins_parse_blocks_invalid_characters() {
        let cfg = serde_json::json!({"trusted_plugins": ["pi agent"]});
        let err = parse_trusted_plugins(&cfg).unwrap_err();
        assert!(err.contains("invalid characters"));
    }

    #[test]
    fn trusted_plugins_parse_blocks_overlong_plugin_id() {
        let cfg = serde_json::json!({"trusted_plugins": ["a".repeat(129)]});
        let err = parse_trusted_plugins(&cfg).unwrap_err();
        assert!(err.contains("invalid characters"));
    }

    #[test]
    fn trusted_plugins_parse_trims_and_deduplicates_values() {
        let cfg = serde_json::json!({
            "trusted_plugins": [" pi_agent ", "PI_AGENT", "  ", "agent-tools"]
        });
        let parsed = parse_trusted_plugins(&cfg).unwrap().unwrap();
        assert!(parsed.contains("pi_agent"));
        assert!(parsed.contains("agent-tools"));
        assert_eq!(parsed.len(), 2);
    }

    #[test]
    fn trusted_plugins_enforcement_matches_plugin_id_case_insensitively() {
        let cfg = serde_json::json!({"trusted_plugins": ["Pi_Agent"]});
        let parsed = parse_trusted_plugins(&cfg).unwrap().unwrap();

        let ok_lower = enforce_trusted_plugin_for_shell_with("pi_agent", Some(&parsed));
        assert!(ok_lower.is_ok());

        let ok_upper = enforce_trusted_plugin_for_shell_with("PI_AGENT", Some(&parsed));
        assert!(ok_upper.is_ok());
    }

    #[test]
    fn trusted_plugins_parse_wildcard_with_whitespace_allows_any_plugin() {
        let cfg = serde_json::json!({"trusted_plugins": [" * "]});
        let parsed = parse_trusted_plugins(&cfg).unwrap().unwrap();
        assert!(parsed.contains("*"));
        assert_eq!(parsed.len(), 1);

        let ok = enforce_trusted_plugin_for_shell_with("any_plugin", Some(&parsed));
        assert!(ok.is_ok());
    }

    #[test]
    fn trusted_plugins_parse_blocks_mixed_wildcard_and_specific_ids() {
        let cfg = serde_json::json!({"trusted_plugins": ["*", "pi_agent"]});
        let err = parse_trusted_plugins(&cfg).unwrap_err();
        assert!(err.contains("wildcard must be the only entry"));
    }

    #[test]
    fn trusted_plugins_empty_array_blocks_all_plugins() {
        let cfg = serde_json::json!({"trusted_plugins": []});
        let parsed = parse_trusted_plugins(&cfg).unwrap().unwrap();
        assert!(parsed.is_empty());

        let err = enforce_trusted_plugin_for_shell_with("pi_agent", Some(&parsed)).unwrap_err();
        assert!(err.contains("not allowed to use agent-shell"));
    }

    #[test]
    fn trusted_plugins_whitespace_only_entries_block_all_plugins() {
        let cfg = serde_json::json!({"trusted_plugins": [" ", "\t"]});
        let parsed = parse_trusted_plugins(&cfg).unwrap().unwrap();
        assert!(parsed.is_empty());

        let err = enforce_trusted_plugin_for_shell_with("pi_agent", Some(&parsed)).unwrap_err();
        assert!(err.contains("not allowed to use agent-shell"));
    }

    #[test]
    fn trusted_plugins_enforcement_blocks_unlisted_plugin() {
        let allowed = std::collections::HashSet::from(["pi_agent".to_string()]);
        let err = enforce_trusted_plugin_for_shell_with("other_plugin", Some(&allowed)).unwrap_err();
        assert!(err.contains("not allowed to use agent-shell"));
    }

    #[test]
    fn trusted_plugins_unset_is_permissive() {
        let result = enforce_trusted_plugin_for_shell_with("any_plugin", None);
        assert!(result.is_ok());
    }

    #[test]
    fn trusted_plugins_allows_trimmed_plugin_id() {
        let allowed = std::collections::HashSet::from(["pi_agent".to_string()]);
        let ok = enforce_trusted_plugin_for_shell_with("  PI_AGENT  ", Some(&allowed));
        assert!(ok.is_ok());
    }

    #[test]
    fn trusted_plugins_blocks_empty_plugin_id() {
        let allowed = std::collections::HashSet::from(["*".to_string()]);
        let err = enforce_trusted_plugin_for_shell_with("   ", Some(&allowed)).unwrap_err();
        assert!(err.contains("plugin id is empty"));
    }

    #[test]
    fn trusted_plugins_blocks_control_characters_plugin_id() {
        let allowed = std::collections::HashSet::from(["*".to_string()]);
        let err = enforce_trusted_plugin_for_shell_with("plugin\n-a", Some(&allowed)).unwrap_err();
        assert!(err.contains("control characters"));
    }

    #[test]
    fn trusted_plugins_blocks_invalid_characters_plugin_id() {
        let allowed = std::collections::HashSet::from(["*".to_string()]);
        let err = enforce_trusted_plugin_for_shell_with("plugin a", Some(&allowed)).unwrap_err();
        assert!(err.contains("invalid characters"));
    }

    #[test]
    fn trusted_plugins_blocks_overlong_plugin_id() {
        let allowed = std::collections::HashSet::from(["*".to_string()]);
        let plugin_id = "a".repeat(129);
        let err = enforce_trusted_plugin_for_shell_with(&plugin_id, Some(&allowed)).unwrap_err();
        assert!(err.contains("invalid characters"));
    }

    #[test]
    fn trusted_plugins_enforcement_allows_wildcard() {
        let allowed = std::collections::HashSet::from(["*".to_string()]);
        let ok = enforce_trusted_plugin_for_shell_with("any_plugin", Some(&allowed));
        assert!(ok.is_ok());
    }
