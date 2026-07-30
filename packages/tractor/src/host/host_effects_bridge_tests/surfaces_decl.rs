// Declared surfaces (S1/S3 — docs/superpowers/specs/2026-07-29-declared-surfaces-design.md).
//
// This file is textually spliced into the SAME `mod tests` as every other included sibling
// (see spawn_env.rs's own header comment for the mechanics). `env_lock` and
// `ensure_sovereign_dir_env` (defined in connection_host.rs) are reused as-is.

// ── parse_surfaces / parse_one_surface — pure JSON parsing, no I/O ──────────────────

#[test]
fn parse_surfaces_absent_block_is_empty() {
    let cfg = serde_json::json!({ "trusted_plugins": ["agent"] });
    assert!(parse_surfaces(&cfg).unwrap().is_empty());
}

#[test]
fn parse_surfaces_null_block_is_rejected() {
    // Unlike `spawnEnv`/`connections`, `null` is not treated as "absent" here: the key
    // being PRESENT (even as null) is a shape the operator wrote, and `null` is not an
    // object — fails the same way any other non-object value does.
    let cfg = serde_json::json!({ "surfaces": null });
    let err = parse_surfaces(&cfg).unwrap_err();
    assert!(err.contains("surfaces must be an object"), "unexpected: {err}");
}

#[test]
fn parse_surfaces_non_object_is_rejected() {
    let cfg = serde_json::json!({ "surfaces": "nope" });
    let err = parse_surfaces(&cfg).unwrap_err();
    assert!(err.contains("surfaces must be an object"), "unexpected: {err}");
}

#[test]
fn parse_surfaces_too_many_entries_is_rejected() {
    let mut obj = serde_json::Map::new();
    for i in 0..(MAX_SURFACES + 1) {
        obj.insert(format!("unknown-{i}"), serde_json::json!({ "expose": "loopback" }));
    }
    let cfg = serde_json::json!({ "surfaces": serde_json::Value::Object(obj) });
    let err = parse_surfaces(&cfg).unwrap_err();
    assert!(err.contains("too many surfaces declared"), "unexpected: {err}");
}

#[test]
fn parse_surfaces_unknown_surface_name_is_rejected() {
    let cfg = serde_json::json!({ "surfaces": { "capabilities": { "expose": "loopback" } } });
    let err = parse_surfaces(&cfg).unwrap_err();
    assert!(err.contains("capabilities"), "must name the offending key: {err}");
    assert!(err.contains("not a surface this daemon reads"), "unexpected: {err}");
}

#[test]
fn parse_surfaces_malformed_entry_non_object_is_rejected() {
    let cfg = serde_json::json!({ "surfaces": { "sidecar-http": "loopback" } });
    let err = parse_surfaces(&cfg).unwrap_err();
    assert!(err.contains("sidecar-http"), "must name the surface: {err}");
    assert!(err.contains("must be an object"), "unexpected: {err}");
}

#[test]
fn parse_surfaces_missing_expose_is_rejected() {
    let cfg = serde_json::json!({ "surfaces": { "sidecar-http": {} } });
    let err = parse_surfaces(&cfg).unwrap_err();
    assert!(err.contains("expose is required"), "unexpected: {err}");
}

#[test]
fn parse_surfaces_expose_non_string_is_rejected() {
    let cfg = serde_json::json!({ "surfaces": { "sidecar-http": { "expose": 5 } } });
    let err = parse_surfaces(&cfg).unwrap_err();
    assert!(err.contains("expose is required and must be a string"), "unexpected: {err}");
}

#[test]
fn parse_surfaces_unknown_expose_value_is_rejected() {
    let cfg = serde_json::json!({ "surfaces": { "sidecar-http": { "expose": "banana" } } });
    let err = parse_surfaces(&cfg).unwrap_err();
    assert!(err.contains("banana"), "must echo the bad value: {err}");
    assert!(err.contains("is not a known value"), "unexpected: {err}");
}

#[test]
fn parse_surfaces_tailnet_parses_as_intent_only() {
    // S2: `expose: "tailnet"` is INTENT, not an address — `parse_expose` never resolves
    // it (no I/O here at all); `sidecar::tailnet_resolve` does that at bind time.
    for surface in [SURFACE_SIDECAR_HTTP, SURFACE_DAEMON_WS] {
        let cfg =
            serde_json::json!({ "surfaces": { surface: { "expose": "tailnet", "gate": "device-token" } } });
        let out = parse_surfaces(&cfg).unwrap();
        let decl = &out[surface];
        assert_eq!(decl.expose, SurfaceExpose::Tailnet, "{surface}: unexpected expose");
        assert_eq!(decl.gate, Some(SurfaceGate::DeviceToken), "{surface}: unexpected gate");
    }
}

#[test]
fn parse_surfaces_tailnet_without_a_gate_is_rejected() {
    // S3: `tailnet` is non-loopback exactly like `host:<ip>` — it needs a gate this
    // surface can enforce, and NO gate at all recreates the hole this design closes.
    for surface in [SURFACE_SIDECAR_HTTP, SURFACE_DAEMON_WS] {
        let cfg = serde_json::json!({ "surfaces": { surface: { "expose": "tailnet" } } });
        let err = parse_surfaces(&cfg).unwrap_err();
        assert!(err.contains("needs a gate"), "{surface}: unexpected: {err}");
        assert!(err.contains("device-token"), "{surface}: must name the fix: {err}");
    }
}

#[test]
fn parse_surfaces_tailnet_with_unenforceable_gate_is_rejected() {
    let cfg = serde_json::json!({ "surfaces": { "sidecar-http": { "expose": "tailnet", "gate": "bearer" } } });
    let err = parse_surfaces(&cfg).unwrap_err();
    assert!(err.contains("is not a known gate"), "unexpected: {err}");
}

#[test]
fn parse_surfaces_host_malformed_ip_is_rejected() {
    let cfg = serde_json::json!({
        "surfaces": { "sidecar-http": { "expose": "host:not-an-ip", "gate": "device-token" } }
    });
    let err = parse_surfaces(&cfg).unwrap_err();
    assert!(err.contains("not-an-ip"), "must echo the bad value: {err}");
    assert!(err.contains("not a valid"), "unexpected: {err}");
}

#[test]
fn parse_surfaces_host_hostname_is_rejected_not_resolved() {
    // "host:<ip>" takes a literal address; a hostname must be refused, not silently
    // accepted and left for a resolver that does not exist here.
    let cfg = serde_json::json!({
        "surfaces": { "sidecar-http": { "expose": "host:example.com", "gate": "device-token" } }
    });
    let err = parse_surfaces(&cfg).unwrap_err();
    assert!(err.contains("not a valid"), "unexpected: {err}");
}

#[test]
fn parse_surfaces_gate_unknown_value_is_rejected() {
    let cfg = serde_json::json!({
        "surfaces": { "sidecar-http": { "expose": "loopback", "gate": "bearer" } }
    });
    let err = parse_surfaces(&cfg).unwrap_err();
    assert!(err.contains("bearer"), "must echo the bad value: {err}");
    assert!(err.contains("is not a known gate"), "unexpected: {err}");
}

#[test]
fn parse_surfaces_gate_non_string_is_rejected() {
    let cfg = serde_json::json!({
        "surfaces": { "sidecar-http": { "expose": "loopback", "gate": 5 } }
    });
    let err = parse_surfaces(&cfg).unwrap_err();
    assert!(err.contains("gate must be a string"), "unexpected: {err}");
}

// ── S3, enforced at load ─────────────────────────────────────────────────────────

#[test]
fn parse_surfaces_sidecar_http_host_with_device_token_gate_is_allowed() {
    let cfg = serde_json::json!({
        "surfaces": {
            "sidecar-http": { "expose": "host:100.64.0.1", "gate": "device-token" }
        }
    });
    let out = parse_surfaces(&cfg).unwrap();
    let decl = &out[SURFACE_SIDECAR_HTTP];
    assert_eq!(decl.expose, SurfaceExpose::Host("100.64.0.1".to_string()));
    assert_eq!(decl.gate, Some(SurfaceGate::DeviceToken));
}

#[test]
fn parse_surfaces_sidecar_http_host_without_a_gate_is_rejected() {
    // A non-loopback expose that names NO gate at all recreates exactly the hole this
    // design closes: a wide bind whose only witness is silence.
    let cfg = serde_json::json!({ "surfaces": { "sidecar-http": { "expose": "host:100.64.0.1" } } });
    let err = parse_surfaces(&cfg).unwrap_err();
    assert!(err.contains("needs a gate"), "unexpected: {err}");
    assert!(err.contains("device-token"), "must name the fix: {err}");
}

#[test]
fn parse_surfaces_sidecar_http_loopback_permits_no_gate() {
    let cfg = serde_json::json!({ "surfaces": { "sidecar-http": { "expose": "loopback" } } });
    let decl = &parse_surfaces(&cfg).unwrap()[SURFACE_SIDECAR_HTTP];
    assert_eq!(decl.expose, SurfaceExpose::Loopback);
    assert_eq!(decl.gate, None);
}

#[test]
fn parse_surfaces_loopback_with_a_gate_declared_anyway_still_parses() {
    // A gate declared alongside "loopback" is inert (S1/S5 already restrict the actual
    // bind to loopback regardless of `gate`) — this documents that leniency is
    // deliberate, not an accidental gap: it never widens anything.
    for surface in [SURFACE_SIDECAR_HTTP, SURFACE_DAEMON_WS] {
        let cfg = serde_json::json!({
            "surfaces": { surface: { "expose": "loopback", "gate": "device-token" } }
        });
        let decl = &parse_surfaces(&cfg).unwrap()[surface];
        assert_eq!(decl.expose, SurfaceExpose::Loopback);
    }
}

#[test]
fn parse_surfaces_daemon_ws_loopback_is_allowed() {
    let cfg = serde_json::json!({ "surfaces": { "daemon-ws": { "expose": "loopback" } } });
    let decl = &parse_surfaces(&cfg).unwrap()[SURFACE_DAEMON_WS];
    assert_eq!(decl.expose, SurfaceExpose::Loopback);
}

#[test]
fn parse_surfaces_daemon_ws_host_without_a_gate_is_rejected() {
    // Mirrors `parse_surfaces_sidecar_http_host_without_a_gate_is_rejected`: since
    // ADR-093, `daemon-ws` CAN enforce `device-token` — but a non-loopback `expose` with
    // no gate at all still recreates the hole this design closes (a wide bind whose only
    // witness is silence), so it is refused for the same reason, not "unenforceable".
    let cfg = serde_json::json!({ "surfaces": { "daemon-ws": { "expose": "host:100.64.0.1" } } });
    let err = parse_surfaces(&cfg).unwrap_err();
    assert!(err.contains("needs a gate"), "unexpected: {err}");
    assert!(err.contains("device-token"), "must name the fix: {err}");
}

#[test]
fn parse_surfaces_daemon_ws_host_with_device_token_gate_is_allowed() {
    // THE ADR-093 mutation guard: `daemon-ws` used to be unable to declare anything but
    // "loopback" no matter what gate was named, because it had no enforcement mechanism
    // at all. Now that `daemon::ws_server`'s `Sec-WebSocket-Protocol` handshake enforces
    // `device-token` the same way the sidecar does, this declaration must parse — exactly
    // like `parse_surfaces_sidecar_http_host_with_device_token_gate_is_allowed`.
    let cfg = serde_json::json!({
        "surfaces": { "daemon-ws": { "expose": "host:100.64.0.1", "gate": "device-token" } }
    });
    let out = parse_surfaces(&cfg).unwrap();
    let decl = &out[SURFACE_DAEMON_WS];
    assert_eq!(decl.expose, SurfaceExpose::Host("100.64.0.1".to_string()));
    assert_eq!(decl.gate, Some(SurfaceGate::DeviceToken));
}

#[test]
fn surface_enforceable_gate_table_matches_the_design() {
    // Both Rust listeners enforce `device-token` since ADR-093 shipped the WS handshake —
    // the mutation guard for `daemon-ws` reverting to `None` (unenforceable) here.
    assert_eq!(surface_enforceable_gate(SURFACE_SIDECAR_HTTP), Some(SurfaceGate::DeviceToken));
    assert_eq!(surface_enforceable_gate(SURFACE_DAEMON_WS), Some(SurfaceGate::DeviceToken));
    assert_eq!(surface_enforceable_gate("unknown-surface"), None);
}

// ── resolve_surfaces — filesystem-only resolution ────────────────────────────────
//
// Mirrors `spawn_env_from_config_at`'s own precedent: pass an explicit `base` (a
// tempdir), never chdir the test process.

fn write_surfaces_config(dir: &std::path::Path, surfaces_json: &str) {
    let refarm_dir = dir.join(".refarm");
    std::fs::create_dir_all(&refarm_dir).unwrap();
    std::fs::write(refarm_dir.join("config.json"), format!(r#"{{"surfaces":{surfaces_json}}}"#)).unwrap();
}

#[test]
fn resolve_surfaces_absent_file_is_empty() {
    let _env = crate::test_support::env_lock();
    ensure_sovereign_dir_env();
    let dir = tempfile::tempdir().unwrap();
    // No .refarm/config.json written at all.
    assert!(resolve_surfaces(dir.path()).unwrap().is_empty());
}

#[test]
fn resolve_surfaces_reads_the_declared_block() {
    let _env = crate::test_support::env_lock();
    ensure_sovereign_dir_env();
    let dir = tempfile::tempdir().unwrap();
    write_surfaces_config(
        dir.path(),
        r#"{"sidecar-http":{"expose":"loopback"},"daemon-ws":{"expose":"loopback"}}"#,
    );
    let out = resolve_surfaces(dir.path()).unwrap();
    assert_eq!(out.len(), 2);
    assert_eq!(out[SURFACE_SIDECAR_HTTP].expose, SurfaceExpose::Loopback);
    assert_eq!(out[SURFACE_DAEMON_WS].expose, SurfaceExpose::Loopback);
}

#[test]
fn resolve_surfaces_malformed_file_fails_shut() {
    let _env = crate::test_support::env_lock();
    ensure_sovereign_dir_env();
    let dir = tempfile::tempdir().unwrap();
    let refarm_dir = dir.path().join(".refarm");
    std::fs::create_dir_all(&refarm_dir).unwrap();
    std::fs::write(refarm_dir.join("config.json"), b"not json").unwrap();
    let err = resolve_surfaces(dir.path()).unwrap_err();
    assert!(err.contains("invalid sovereign config.json"), "unexpected: {err}");
}

#[test]
fn resolve_surfaces_daemon_ws_violation_is_refused_at_load() {
    // "Refused at load" (design doc S3): a `daemon-ws` declaration wider than loopback
    // with NO gate fails resolution itself — the caller never gets as far as a bind
    // attempt. (Since ADR-093, a GATED `host:<ip>` declaration for `daemon-ws` is legal —
    // see `resolve_surfaces_daemon_ws_host_with_gate_is_allowed` — so this specifically
    // tests the still-illegal ungated shape, not "any non-loopback daemon-ws".)
    let _env = crate::test_support::env_lock();
    ensure_sovereign_dir_env();
    let dir = tempfile::tempdir().unwrap();
    write_surfaces_config(dir.path(), r#"{"daemon-ws":{"expose":"host:0.0.0.0"}}"#);
    let err = resolve_surfaces(dir.path()).unwrap_err();
    assert!(err.contains("needs a gate"), "unexpected: {err}");
}

#[test]
fn resolve_surfaces_daemon_ws_host_with_gate_is_allowed() {
    let _env = crate::test_support::env_lock();
    ensure_sovereign_dir_env();
    let dir = tempfile::tempdir().unwrap();
    write_surfaces_config(
        dir.path(),
        r#"{"daemon-ws":{"expose":"host:100.64.0.1","gate":"device-token"}}"#,
    );
    let out = resolve_surfaces(dir.path()).unwrap();
    assert_eq!(out[SURFACE_DAEMON_WS].expose, SurfaceExpose::Host("100.64.0.1".to_string()));
    assert_eq!(out[SURFACE_DAEMON_WS].gate, Some(SurfaceGate::DeviceToken));
}
