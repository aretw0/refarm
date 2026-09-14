// P10 — the operator-declared spawn environment
// (docs/superpowers/specs/2026-07-29-process-administration-layer-design.md).
//
// This file is textually spliced into the SAME `mod tests` as every other included
// sibling (see `policy_and_fs.rs`'s `#[path] mod tests;`). `fs_shell_core.rs`'s own
// `use super::*;` already reaches the entire flattened `host_effects_bridge` module
// for the WHOLE `mod tests` body (Rust resolves `use` module-wide, not by textual
// position) — a second `use super::*;` here would only warn as unused. Likewise
// `env_lock` and `ensure_sovereign_dir_env` (defined once in connection_host.rs) are
// reused as-is; re-declaring either would collide (E0252/E0428).

// ── SpawnEnvDecl::injected_vars — pure composition, no I/O ──────────────────────

#[test]
fn spawn_env_decl_default_injects_nothing() {
    assert!(SpawnEnvDecl::default().injected_vars().is_empty());
}

#[test]
fn spawn_env_decl_empty_path_injects_no_path_key() {
    // An explicit empty list is treated exactly like an absent one — undeclared
    // means absent (P10's fourth constraint), and an empty Vec is the same case as
    // "no path field at all", not a distinct "PATH=" empty-string injection.
    let decl = SpawnEnvDecl { path: vec![], home: None };
    assert!(decl.injected_vars().is_empty());
}

#[test]
fn spawn_env_decl_injects_path_joined_in_declared_order() {
    let decl = SpawnEnvDecl {
        path: vec!["/opt/z".to_string(), "/opt/a".to_string(), "/usr/bin".to_string()],
        home: None,
    };
    assert_eq!(decl.injected_vars(), vec![("PATH".to_string(), "/opt/z:/opt/a:/usr/bin".to_string())]);
}

#[test]
fn spawn_env_decl_injects_home() {
    let decl = SpawnEnvDecl { path: vec![], home: Some("/home/operator".to_string()) };
    assert_eq!(decl.injected_vars(), vec![("HOME".to_string(), "/home/operator".to_string())]);
}

#[test]
fn spawn_env_decl_injects_both_path_and_home() {
    let decl = SpawnEnvDecl { path: vec!["/usr/bin".to_string()], home: Some("/home/op".to_string()) };
    assert_eq!(
        decl.injected_vars(),
        vec![
            ("PATH".to_string(), "/usr/bin".to_string()),
            ("HOME".to_string(), "/home/op".to_string()),
        ]
    );
}

// ── parse_spawn_env — pure JSON parsing, no I/O ──────────────────────────────────

#[test]
fn parse_spawn_env_absent_block_is_default() {
    let cfg = serde_json::json!({ "trusted_plugins": ["agent"] });
    assert_eq!(parse_spawn_env(&cfg).unwrap(), SpawnEnvDecl::default());
}

#[test]
fn parse_spawn_env_null_block_is_default() {
    let cfg = serde_json::json!({ "spawnEnv": null });
    assert_eq!(parse_spawn_env(&cfg).unwrap(), SpawnEnvDecl::default());
}

#[test]
fn parse_spawn_env_non_object_is_rejected() {
    let cfg = serde_json::json!({ "spawnEnv": "nope" });
    let err = parse_spawn_env(&cfg).unwrap_err();
    assert!(err.contains("spawnEnv must be an object"), "unexpected: {err}");
}

#[test]
fn parse_spawn_env_path_non_array_is_rejected() {
    let cfg = serde_json::json!({ "spawnEnv": { "path": "/usr/bin" } });
    let err = parse_spawn_env(&cfg).unwrap_err();
    assert!(err.contains("spawnEnv.path must be an array of strings"), "unexpected: {err}");
}

#[test]
fn parse_spawn_env_path_relative_entry_is_rejected() {
    let cfg = serde_json::json!({ "spawnEnv": { "path": ["relative/dir"] } });
    let err = parse_spawn_env(&cfg).unwrap_err();
    assert!(err.contains("spawnEnv.path[0] must be an absolute path"), "unexpected: {err}");
}

#[test]
fn parse_spawn_env_path_non_string_entry_is_rejected() {
    // A dropped entry would silently search FEWER directories than declared — this
    // must be a clear configuration error naming the field, never a silent skip.
    let cfg = serde_json::json!({ "spawnEnv": { "path": ["/usr/bin", 5] } });
    let err = parse_spawn_env(&cfg).unwrap_err();
    assert!(err.contains("spawnEnv.path[1] must be a string"), "unexpected: {err}");
}

#[test]
fn parse_spawn_env_path_control_char_entry_is_rejected() {
    let cfg = serde_json::json!({ "spawnEnv": { "path": ["/usr/\u{0}bin"] } });
    let err = parse_spawn_env(&cfg).unwrap_err();
    assert!(err.contains("spawnEnv.path[0] contains control characters"), "unexpected: {err}");
}

#[test]
fn parse_spawn_env_path_entry_over_cap_length_is_rejected() {
    let long = format!("/{}", "a".repeat(MAX_SPAWN_ENV_PATH_ENTRY_LEN));
    let cfg = serde_json::json!({ "spawnEnv": { "path": [long] } });
    let err = parse_spawn_env(&cfg).unwrap_err();
    assert!(err.contains("spawnEnv.path[0] exceeds max length"), "unexpected: {err}");
}

#[test]
fn parse_spawn_env_path_over_cap_entries_is_rejected() {
    let path: Vec<String> = (0..(MAX_SPAWN_ENV_PATH_ENTRIES + 1)).map(|i| format!("/d{i}")).collect();
    let cfg = serde_json::json!({ "spawnEnv": { "path": path } });
    let err = parse_spawn_env(&cfg).unwrap_err();
    assert!(err.contains("spawnEnv.path exceeds max entries"), "unexpected: {err}");
}

#[test]
fn parse_spawn_env_path_over_cap_total_length_is_rejected() {
    // 64 entries (AT the count cap, not over it) of 1025 bytes each = 65600 bytes,
    // over the 64 KiB total-length cap — proves the total-length guard fires
    // independently of the entry-count guard.
    let entry_len = (MAX_SPAWN_ENV_PATH_TOTAL_LEN / MAX_SPAWN_ENV_PATH_ENTRIES) + 1;
    let path: Vec<String> = (0..MAX_SPAWN_ENV_PATH_ENTRIES)
        .map(|_| format!("/{}", "a".repeat(entry_len - 1)))
        .collect();
    assert_eq!(path.len(), MAX_SPAWN_ENV_PATH_ENTRIES, "must stay at, not over, the count cap");
    let cfg = serde_json::json!({ "spawnEnv": { "path": path } });
    let err = parse_spawn_env(&cfg).unwrap_err();
    assert!(err.contains("spawnEnv.path exceeds max total length"), "unexpected: {err}");
}

#[test]
fn parse_spawn_env_empty_path_array_is_treated_as_undeclared() {
    let cfg = serde_json::json!({ "spawnEnv": { "path": [] } });
    let decl = parse_spawn_env(&cfg).unwrap();
    assert!(decl.path.is_empty());
    assert!(decl.injected_vars().is_empty(), "an empty declared list must not inject an empty PATH=");
}

#[test]
fn parse_spawn_env_home_relative_is_rejected() {
    let cfg = serde_json::json!({ "spawnEnv": { "home": "relative/home" } });
    let err = parse_spawn_env(&cfg).unwrap_err();
    assert!(err.contains("spawnEnv.home must be an absolute path"), "unexpected: {err}");
}

#[test]
fn parse_spawn_env_home_non_string_is_rejected() {
    let cfg = serde_json::json!({ "spawnEnv": { "home": 5 } });
    let err = parse_spawn_env(&cfg).unwrap_err();
    assert!(err.contains("spawnEnv.home must be a string"), "unexpected: {err}");
}

#[test]
fn parse_spawn_env_home_control_char_is_rejected() {
    let cfg = serde_json::json!({ "spawnEnv": { "home": "/home/op\u{1}erator" } });
    let err = parse_spawn_env(&cfg).unwrap_err();
    assert!(err.contains("spawnEnv.home contains control characters"), "unexpected: {err}");
}

#[test]
fn parse_spawn_env_home_null_is_absent() {
    let cfg = serde_json::json!({ "spawnEnv": { "path": ["/usr/bin"], "home": null } });
    let decl = parse_spawn_env(&cfg).unwrap();
    assert_eq!(decl.home, None);
}

#[test]
fn parse_spawn_env_valid_declaration_parses_in_declared_order() {
    let cfg = serde_json::json!({
        "spawnEnv": {
            "path": ["/opt/node/bin", "/usr/bin", "/bin"],
            "home": "/home/operator"
        }
    });
    let decl = parse_spawn_env(&cfg).unwrap();
    assert_eq!(decl.path, vec!["/opt/node/bin", "/usr/bin", "/bin"]);
    assert_eq!(decl.home.as_deref(), Some("/home/operator"));
}

// ── spawn_env_from_config_at — filesystem-only resolution ────────────────────────
//
// Mirrors `resolve_connections`'s own precedent: pass an explicit `base` (a tempdir),
// never chdir the test process, so these run safely alongside every other test.

fn write_spawn_env_config(dir: &std::path::Path, spawn_env_json: &str) {
    let refarm_dir = dir.join(".refarm");
    std::fs::create_dir_all(&refarm_dir).unwrap();
    std::fs::write(refarm_dir.join("config.json"), format!(r#"{{"spawnEnv":{spawn_env_json}}}"#)).unwrap();
}

#[test]
fn spawn_env_from_config_at_absent_file_is_default() {
    let _env = crate::test_support::env_lock();
    ensure_sovereign_dir_env();
    let dir = tempfile::tempdir().unwrap();
    // No .refarm/config.json written at all.
    assert_eq!(spawn_env_from_config_at(dir.path()).unwrap(), SpawnEnvDecl::default());
}

#[test]
fn spawn_env_from_config_at_reads_the_declared_block() {
    let _env = crate::test_support::env_lock();
    ensure_sovereign_dir_env();
    let dir = tempfile::tempdir().unwrap();
    write_spawn_env_config(dir.path(), r#"{"path":["/usr/bin","/bin"],"home":"/home/op"}"#);
    let decl = spawn_env_from_config_at(dir.path()).unwrap();
    assert_eq!(decl.path, vec!["/usr/bin", "/bin"]);
    assert_eq!(decl.home.as_deref(), Some("/home/op"));
}

#[test]
fn spawn_env_from_config_at_malformed_file_fails_shut() {
    let _env = crate::test_support::env_lock();
    ensure_sovereign_dir_env();
    let dir = tempfile::tempdir().unwrap();
    let refarm_dir = dir.path().join(".refarm");
    std::fs::create_dir_all(&refarm_dir).unwrap();
    std::fs::write(refarm_dir.join("config.json"), b"not json").unwrap();
    let err = spawn_env_from_config_at(dir.path()).unwrap_err();
    assert!(err.contains("invalid sovereign config.json"), "unexpected: {err}");
}

// ── spawn_process — the real effect, through HostEffectPolicy ────────────────────
//
// `/usr/bin/env` with NO args dumps its own (post-`env_clear()`) environment back on
// stdout — the cheapest possible probe for "what did the child actually receive",
// and it needs no PATH to be launched itself (absolute path, argv[0] has a slash).

async fn dump_child_env(policy: &HostEffectPolicy) -> String {
    let argv = vec!["/usr/bin/env".to_string()];
    let (stdout, stderr, exit_code, timed_out) =
        spawn_process(&argv, &[], None, 5_000, None, policy).await.unwrap();
    assert_eq!(
        exit_code, 0,
        "stdout={:?} stderr={:?} timed_out={timed_out}",
        String::from_utf8_lossy(&stdout),
        String::from_utf8_lossy(&stderr)
    );
    String::from_utf8_lossy(&stdout).to_string()
}

#[tokio::test]
async fn spawn_env_undeclared_injects_nothing_undeclared_means_absent_not_inherited() {
    // Constraint 4 mutation-verify: the TEST process certainly has a PATH/HOME/…
    // of its own. If a regression let ANY of it leak through (e.g. `env_clear()`
    // dropped, or a fallback to ambient env introduced), this dump would show
    // dozens of vars instead of being completely empty.
    let dump = dump_child_env(&HostEffectPolicy::default()).await;
    assert!(dump.is_empty(), "expected a fully empty child env, got: {dump:?}");
}

#[tokio::test]
async fn spawn_env_declared_path_is_injected_verbatim_never_the_daemon_ambient_path() {
    // Constraint 1 + 2 mutation-verify: the declared value ("/usr/bin:/bin", 2
    // entries) is deliberately far shorter than this TEST PROCESS's own real
    // ambient PATH (which has a dozen-plus entries — nvm/cargo/sdkman/etc. — see
    // `echo $PATH` on this host). If `spawn_process` ever sourced PATH from
    // `std::env::var("PATH")` instead of the declaration, this exact-match
    // assertion fails immediately; if it ever reordered the declared entries,
    // it fails too.
    let policy = HostEffectPolicy::new(
        None,
        Ok(None),
        String::new(),
        Ok(SpawnEnvDecl { path: vec!["/usr/bin".to_string(), "/bin".to_string()], home: None }),
    );
    let dump = dump_child_env(&policy).await;
    assert_eq!(dump.trim(), "PATH=/usr/bin:/bin", "unexpected child env: {dump:?}");
}

#[tokio::test]
async fn spawn_env_declared_home_is_injected() {
    let policy = HostEffectPolicy::new(
        None,
        Ok(None),
        String::new(),
        Ok(SpawnEnvDecl { path: vec![], home: Some("/declared/home".to_string()) }),
    );
    let dump = dump_child_env(&policy).await;
    assert_eq!(dump.trim(), "HOME=/declared/home", "unexpected child env: {dump:?}");
}

#[tokio::test]
async fn spawn_env_plugin_supplied_path_is_still_rejected_even_with_operator_spawn_env_declared() {
    // The operator's declaration existing at all must not soften `enforce_spawn_env`
    // for the PLUGIN's own env — the plugin never had a say in PATH/HOME either way.
    let policy = HostEffectPolicy::new(
        None,
        Ok(None),
        String::new(),
        Ok(SpawnEnvDecl { path: vec!["/usr/bin".to_string()], home: None }),
    );
    let argv = vec!["echo".to_string(), "ok".to_string()];
    let env = vec![("PATH".to_string(), "/attacker/bin".to_string())];
    let err = spawn_process(&argv, &env, None, 1_000, None, &policy).await.unwrap_err();
    assert!(err.contains("blocked env key"), "unexpected: {err}");
}

#[tokio::test]
async fn spawn_env_malformed_declaration_fails_at_spawn_use_not_at_policy_construction() {
    // Mirrors `fs_root`'s own established pattern: constructing a policy with a bad
    // resolved value never panics; the error surfaces the first time a spawn
    // actually needs it.
    let policy =
        HostEffectPolicy::new(None, Ok(None), String::new(), Err("spawnEnv boom".to_string()));
    let argv = vec!["echo".to_string(), "ok".to_string()];
    let err = spawn_process(&argv, &[], None, 1_000, None, &policy).await.unwrap_err();
    assert!(err.contains("spawnEnv boom"), "unexpected: {err}");
}

/// Discover `node`'s real directory via the TEST process's own (normal) PATH — used
/// only to build the P10 probe below, never fed into the child under test.
fn discover_a_path_only_binary_dir() -> Option<String> {
    let output = std::process::Command::new("sh").arg("-c").arg("command -v node").output().ok()?;
    if !output.status.success() {
        return None;
    }
    let printed = String::from_utf8(output.stdout).ok()?;
    let bin_path = printed.trim();
    if bin_path.is_empty() {
        return None;
    }
    std::path::Path::new(bin_path).parent().map(|p| p.to_string_lossy().to_string())
}

#[tokio::test]
async fn spawn_env_undeclared_blocks_and_declared_unblocks_a_shebang_that_needs_path() {
    // The real dogfooding bug this design fixes, reproduced directly: a Node-
    // ecosystem binary resolved via `#!/usr/bin/env node` cannot run without PATH,
    // even by absolute argv[0], because the SHEBANG's own `execvp("node", …)` needs
    // it. `sh` is NOT a valid stand-in for this probe on a glibc host: `execvp`
    // falls back to `confstr(_CS_PATH)` (typically `/bin:/usr/bin`) when PATH is
    // entirely unset, so `sh` (living in /bin) resolves regardless of any spawnEnv
    // declaration — verified empirically on this host before writing this test, per
    // the design's own instruction to verify rather than assume. `node` (installed
    // via nvm, outside the glibc fallback path) does NOT have that escape hatch, so
    // it is the genuine probe.
    let Some(node_dir) = discover_a_path_only_binary_dir() else {
        eprintln!("skipping: no `node` resolvable via this test process's own PATH");
        return;
    };
    if node_dir == "/bin" || node_dir == "/usr/bin" {
        eprintln!("skipping: node lives in the OS default search path here, can't distinguish declared-vs-absent PATH");
        return;
    }

    let argv = vec!["node".to_string(), "-e".to_string(), "1".to_string()];

    // No spawnEnv declared: unreachable, exactly today's dogfooding failure.
    let undeclared = spawn_process(&argv, &[], None, 10_000, None, &HostEffectPolicy::default()).await;
    assert!(undeclared.is_err(), "expected spawn to fail without a declared PATH, got {undeclared:?}");

    // Declared spawnEnv naming node's own directory: the SAME argv now runs.
    let policy = HostEffectPolicy::new(
        None,
        Ok(None),
        String::new(),
        Ok(SpawnEnvDecl { path: vec![node_dir], home: None }),
    );
    let (stdout, stderr, exit_code, timed_out) =
        spawn_process(&argv, &[], None, 10_000, None, &policy).await.unwrap();
    assert_eq!(
        exit_code, 0,
        "stdout={:?} stderr={:?} timed_out={timed_out}",
        String::from_utf8_lossy(&stdout),
        String::from_utf8_lossy(&stderr)
    );
}

/// THE DEFECT THE OPERATOR MET, AS A TEST.
///
/// The node is TOLD where its declarations live — `--refarm-dir` is on its argv and
/// `main()` already threads it to the auth policy and Scarecrow. Declaration resolution
/// asked the filesystem where the process was standing instead, so restarting the runtime
/// from a repository made a declared operation resolve against the REPOSITORY's config:
/// the workspace declared something else there, the spawned entrypoint refused, and the
/// phone got `exit 1` with no envelope and no hint.
///
/// A node whose answer to "what may I do" depends on someone's last `cd` is detecting, in
/// the one place where being wrong is silent and remote.
#[test]
fn declarations_follow_the_declared_base_not_the_process_cwd() {
    let _env = crate::test_support::env_lock();
    ensure_sovereign_dir_env();

    let declared = tempfile::tempdir().unwrap();
    let elsewhere = tempfile::tempdir().unwrap();
    write_spawn_env_config(declared.path(), r#"{"path":["/declared/bin"],"home":"/declared"}"#);
    write_spawn_env_config(elsewhere.path(), r#"{"path":["/cwd/bin"],"home":"/cwd"}"#);

    let restore = std::env::current_dir().unwrap();
    std::env::set_current_dir(elsewhere.path()).unwrap();
    let previous = std::env::var(crate::host::plugin_host::config_node::SOVEREIGN_BASE_KEY).ok();
    std::env::set_var(crate::host::plugin_host::config_node::SOVEREIGN_BASE_KEY, declared.path());

    let decl = crate::host::host_effects_bridge::spawn_env_from_declared_base().unwrap();

    match previous {
        Some(value) => std::env::set_var(crate::host::plugin_host::config_node::SOVEREIGN_BASE_KEY, value),
        None => std::env::remove_var(crate::host::plugin_host::config_node::SOVEREIGN_BASE_KEY),
    }
    std::env::set_current_dir(restore).unwrap();

    assert_eq!(decl.path, vec!["/declared/bin"], "the node read the cwd, not what it was told");
    assert_eq!(decl.home.as_deref(), Some("/declared"));
}
