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
        // `idleMs: 0` is the only idle window that is actually implemented: `apply_linger`
        // drops the connection the moment it becomes claimless. A non-zero window is
        // rejected at parse time (see below) rather than accepted and ignored.
        let decl = one(serde_json::json!({
            "establish": ["bin"],
            "probe": { "run": ["true"] },
            "probeIntervalMs": 250,
            "readyTimeoutMs": 5000,
            "notices": [{ "pattern": "Conectando", "message": "aprove o push" }],
            "linger": { "idleMs": 0 }
        }))
        .unwrap();
        assert_eq!(decl.probe_interval_ms, 250);
        assert_eq!(decl.ready_timeout_ms, 5000);
        assert_eq!(decl.notices[0].message, "aprove o push");
        assert!(matches!(decl.linger, Linger::Idle { ms: 0 }));
    }

    #[test]
    fn rejects_a_non_zero_idle_linger_window_because_no_sweeper_exists() {
        // The window parsed fine and then did nothing: `apply_linger` only acts on `ms: 0`,
        // so a declared 60s window kept the connection up forever with no signal that the
        // declaration was inert.
        let err = one(serde_json::json!({
            "establish": ["bin"],
            "probe": { "run": ["true"] },
            "linger": { "idleMs": 60000 }
        }))
        .unwrap_err();
        assert!(err.contains("not implemented yet"), "unexpected: {err}");
        assert!(err.contains("idleMs"), "the message must name the field: {err}");
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

    // ── The parser must never rewrite what the operator declared ────────────────────────
    //
    // Each of these used to be dropped or defaulted in silence. A declaration is an
    // operation catalog: the machine runs exactly what is written, or it says why not.

    #[test]
    fn rejects_a_non_string_entry_in_the_establish_argv() {
        // The dangerous one: `["ovpnctl", 5, "connect"]` used to run `ovpnctl connect` —
        // a DIFFERENT command than the one declared, with nothing said about it.
        let err = one(serde_json::json!({
            "establish": ["ovpnctl", 5, "connect"],
            "probe": { "run": ["true"] }
        }))
        .unwrap_err();
        assert!(err.contains("establish[1]"), "the message must name the entry: {err}");
        assert!(err.contains("must be a string"), "unexpected: {err}");
    }

    #[test]
    fn rejects_a_non_string_entry_in_the_probe_argv() {
        let err = one(serde_json::json!({
            "establish": ["bin"],
            "probe": { "run": ["ip", { "link": true }, "show"] }
        }))
        .unwrap_err();
        assert!(err.contains("probe.run[1]"), "unexpected: {err}");
    }

    #[test]
    fn rejects_a_non_string_env_value() {
        // A dropped env entry changes the environment the command runs in.
        let err = one(serde_json::json!({
            "establish": ["bin"],
            "probe": { "run": ["true"] },
            "env": { "OVPN_PROFILE": "serpro", "OVPN_PORT": 1194 }
        }))
        .unwrap_err();
        assert!(err.contains("env['OVPN_PORT']"), "the message must name the key: {err}");
    }

    #[test]
    fn rejects_a_non_array_notices_block() {
        let err = one(serde_json::json!({
            "establish": ["bin"],
            "probe": { "run": ["true"] },
            "notices": { "pattern": "Conectando", "message": "aprove o push" }
        }))
        .unwrap_err();
        assert!(err.contains("notices must be an array"), "unexpected: {err}");
    }

    #[test]
    fn rejects_non_integer_timeout_and_interval_instead_of_defaulting() {
        // Falling back to the default reads as "my timeout is being honoured" when it is
        // not — a 5s declaration silently becoming the 120s default is a two-minute hang.
        let err = one(serde_json::json!({
            "establish": ["bin"], "probe": { "run": ["true"] }, "readyTimeoutMs": "5000"
        }))
        .unwrap_err();
        assert!(err.contains("readyTimeoutMs"), "unexpected: {err}");

        let err = one(serde_json::json!({
            "establish": ["bin"], "probe": { "run": ["true"] }, "probeIntervalMs": 1.5
        }))
        .unwrap_err();
        assert!(err.contains("probeIntervalMs"), "unexpected: {err}");

        let err = one(serde_json::json!({
            "establish": ["bin"], "probe": { "run": ["true"] }, "probeIntervalMs": 0
        }))
        .unwrap_err();
        assert!(err.contains("greater than 0"), "unexpected: {err}");
    }

    #[test]
    fn rejects_a_non_string_probe_expect_instead_of_dropping_readiness_to_exit_code_only() {
        let err = one(serde_json::json!({
            "establish": ["bin"],
            "probe": { "run": ["true"], "expect": ["UP"] }
        }))
        .unwrap_err();
        assert!(err.contains("probe.expect must be a string"), "unexpected: {err}");
    }

    #[test]
    fn rejects_a_non_string_cwd() {
        let err = one(serde_json::json!({
            "establish": ["bin"], "probe": { "run": ["true"] }, "cwd": 7
        }))
        .unwrap_err();
        assert!(err.contains("cwd must be a string"), "unexpected: {err}");
    }
}
