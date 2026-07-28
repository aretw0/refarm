// Connection declaration parsing — the operator's catalog of long-lived connections.
// Pure over serde_json::Value: no filesystem, no process.

#[cfg(test)]
mod connection_decl_tests {
    use super::*;

    fn one(json: serde_json::Value) -> Result<ConnectionDeclaration, String> {
        parse_connections(&serde_json::json!({ "connections": { "c": json } }))
            .map(|mut m| m.remove("c").expect("declaration present"))
    }

    fn vpn() -> serde_json::Value {
        serde_json::json!({
            "establish": ["serpro-vpn", "connect"],
            "probe": { "run": ["ip", "-br", "link", "show", "ovpntun0"], "expect": "UP" }
        })
    }

    #[test]
    fn parses_a_minimal_declaration_with_defaults() {
        let decl = one(vpn()).unwrap();
        assert_eq!(decl.name, "c");
        assert_eq!(decl.establish, vec!["serpro-vpn".to_string(), "connect".to_string()]);
        assert_eq!(decl.probe.run[0], "ip");
        assert!(decl.probe.expect.as_ref().unwrap().is_match("ovpntun0 UP <POINTOPOINT>"));
        assert_eq!(decl.probe_interval_ms, DEFAULT_PROBE_INTERVAL_MS);
        assert_eq!(decl.ready_timeout_ms, DEFAULT_READY_TIMEOUT_MS);
        assert!(decl.notices.is_empty());
        assert!(matches!(decl.linger, Linger::Operator));
    }

    #[test]
    fn absent_connections_block_yields_an_empty_catalog() {
        assert!(parse_connections(&serde_json::json!({})).unwrap().is_empty());
    }

    #[test]
    fn a_probe_without_expect_succeeds_on_exit_code_alone() {
        let decl = one(serde_json::json!({
            "establish": ["bin"],
            "probe": { "run": ["true"] }
        }))
        .unwrap();
        assert!(decl.probe.expect.is_none());
    }

    #[test]
    fn parses_notices_intervals_timeout_and_idle_linger() {
        let decl = one(serde_json::json!({
            "establish": ["bin"],
            "probe": { "run": ["true"] },
            "probeIntervalMs": 250,
            "readyTimeoutMs": 5000,
            "notices": [{ "pattern": "Conectando", "message": "aprove o push" }],
            "linger": { "idleMs": 60000 }
        }))
        .unwrap();
        assert_eq!(decl.probe_interval_ms, 250);
        assert_eq!(decl.ready_timeout_ms, 5000);
        assert_eq!(decl.notices[0].message, "aprove o push");
        assert!(matches!(decl.linger, Linger::Idle { ms: 60000 }));
    }

    #[test]
    fn rejects_an_empty_establish_argv() {
        let err = one(serde_json::json!({
            "establish": [], "probe": { "run": ["true"] }
        }))
        .unwrap_err();
        assert!(err.contains("establish must be a non-empty array"), "unexpected: {err}");
    }

    #[test]
    fn rejects_a_missing_probe() {
        // Readiness IS the probe. Without one there is no way to know a connection is up,
        // and falling back to output matching is the ad-hoc coupling this design removes.
        let err = one(serde_json::json!({ "establish": ["bin"] })).unwrap_err();
        assert!(err.contains("probe is required"), "unexpected: {err}");
    }

    #[test]
    fn rejects_a_shell_wrapper_in_the_probe() {
        // `sh -c "... | grep -q UP"` is argv-shaped but reintroduces the shell: allowing
        // `sh` in the allowlist allows everything.
        for shell in ["sh", "bash", "zsh", "/bin/sh", "/usr/bin/env"] {
            let err = one(serde_json::json!({
                "establish": ["bin"],
                "probe": { "run": [shell, "-c", "ip link | grep UP"] }
            }))
            .unwrap_err();
            assert!(
                err.contains("probe must not invoke a shell"),
                "expected a shell rejection for {shell}, got: {err}"
            );
        }
    }

    #[test]
    fn rejects_a_composing_probe_until_the_grant_path_exists() {
        let err = one(serde_json::json!({
            "establish": ["bin"],
            "probe": { "run": ["true"], "shell": "ip link | grep UP", "reason": "needs a pipe" }
        }))
        .unwrap_err();
        assert!(err.contains("probe.shell requires an operator grant"), "unexpected: {err}");
    }

    #[test]
    fn rejects_legacy_ready_and_fail_patterns_loudly() {
        // An older config must not be silently half-honoured: a leftover `ready` would
        // look like it still decides readiness when the probe now does.
        for key in ["ready", "fail"] {
            let err = one(serde_json::json!({
                "establish": ["bin"],
                "probe": { "run": ["true"] },
                key: "whatever"
            }))
            .unwrap_err();
            assert!(
                err.contains("readiness is decided by `probe`"),
                "expected a rejection for {key}, got: {err}"
            );
        }
    }

    #[test]
    fn rejects_prompts_because_no_answer_path_exists_yet() {
        let err = one(serde_json::json!({
            "establish": ["bin"],
            "probe": { "run": ["true"] },
            "prompts": [{ "pattern": "Senha: ", "label": "pw", "answer": { "askHuman": "senha" } }]
        }))
        .unwrap_err();
        assert!(err.contains("prompts are not supported yet"), "unexpected: {err}");
    }

    #[test]
    fn rejects_an_uncompilable_pattern_without_panicking() {
        let err = one(serde_json::json!({
            "establish": ["bin"],
            "probe": { "run": ["true"], "expect": "([" }
        }))
        .unwrap_err();
        assert!(err.contains("invalid regex"), "unexpected: {err}");
    }

    #[test]
    fn rejects_an_oversized_pattern() {
        let long = "a".repeat(MAX_CONNECTION_PATTERN_LEN + 1);
        let err = one(serde_json::json!({
            "establish": ["bin"],
            "probe": { "run": ["true"], "expect": long }
        }))
        .unwrap_err();
        assert!(err.contains("pattern exceeds max length"), "unexpected: {err}");
    }

    #[test]
    fn rejects_too_many_connections() {
        let mut conns = serde_json::Map::new();
        for i in 0..=MAX_CONNECTIONS {
            conns.insert(
                format!("c{i}"),
                serde_json::json!({ "establish": ["bin"], "probe": { "run": ["true"] } }),
            );
        }
        let err = parse_connections(&serde_json::json!({ "connections": conns })).unwrap_err();
        assert!(err.contains("too many connections"), "unexpected: {err}");
    }

    #[test]
    fn rejects_too_many_notice_rules() {
        let notices: Vec<_> = (0..=MAX_CONNECTION_NOTICES)
            .map(|i| serde_json::json!({ "pattern": format!("n{i}"), "message": "m" }))
            .collect();
        let err = one(serde_json::json!({
            "establish": ["bin"], "probe": { "run": ["true"] }, "notices": notices
        }))
        .unwrap_err();
        assert!(err.contains("too many notice rules"), "unexpected: {err}");
    }

    #[test]
    fn rejects_a_non_object_connections_block() {
        let err = parse_connections(&serde_json::json!({ "connections": [] })).unwrap_err();
        assert!(err.contains("connections must be an object"), "unexpected: {err}");
    }
}
