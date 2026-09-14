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
    // Still fail-shut for a name NO runtime declares — O4 widened the vocabulary, it did
    // not remove the refusal. `dist-http` is the specific name to pin: the 07-30 design's
    // prose uses it for the `refarm web serve` listener, and this slice deliberately
    // admits that listener under ONE name (`web`, after the listener) rather than two.
    for unknown in ["totally-made-up", "dist-http"] {
        let cfg = serde_json::json!({ "surfaces": { unknown: { "expose": "loopback" } } });
        let err = parse_surfaces(&cfg).unwrap_err();
        assert!(err.contains(unknown), "must name the offending key: {err}");
        assert!(err.contains("is not a surface any refarm runtime declares"), "unexpected: {err}");
        assert!(err.contains("web"), "must name the vocabulary it could have meant: {err}");
    }
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

// ── O1 — `"gate": "none"` is an explicit value: a CHOICE, not a forgetting ────────
// (docs/superpowers/specs/2026-07-30-open-by-declaration-surfaces-design.md)

#[test]
fn parse_surfaces_gate_none_parses_as_an_explicit_declaration() {
    // The value that makes honesty sayable: a TS surface that verifies no bearer may now
    // declare openness instead of declaring nothing.
    for surface in [SURFACE_CAPABILITIES, SURFACE_WEB] {
        let cfg = serde_json::json!({
            "surfaces": { surface: { "expose": "tailnet", "gate": "none" } }
        });
        let decl = &parse_surfaces(&cfg).unwrap()[surface];
        assert_eq!(decl.expose, SurfaceExpose::Tailnet, "{surface}: unexpected expose");
        assert_eq!(decl.gate, Some(SurfaceGate::Open), "{surface}: unexpected gate");
    }
}

#[test]
fn parse_surfaces_gate_none_is_distinguishable_from_an_absent_gate() {
    // THE O1 mutation guard, and the whole reason the value exists: if `"gate": "none"`
    // ever parsed to the SAME thing as writing no `gate` key at all, an auditor could no
    // longer tell a deliberate choice from an oversight — which is the entire distinction
    // this slice buys. `Some(Open)` and `None` must stay two different values.
    let declared = serde_json::json!({
        "surfaces": { "web": { "expose": "loopback", "gate": "none" } }
    });
    let forgotten = serde_json::json!({ "surfaces": { "web": { "expose": "loopback" } } });
    assert_eq!(parse_surfaces(&declared).unwrap()[SURFACE_WEB].gate, Some(SurfaceGate::Open));
    assert_eq!(parse_surfaces(&forgotten).unwrap()[SURFACE_WEB].gate, None);
    assert_ne!(
        parse_surfaces(&declared).unwrap()[SURFACE_WEB],
        parse_surfaces(&forgotten).unwrap()[SURFACE_WEB],
        "a declared openness must not collapse into silence"
    );
}

#[test]
fn parse_surfaces_gate_none_with_loopback_is_admissible_and_means_nothing_special() {
    // Loopback + "none" parses for EVERY surface, Rust-owned included: loopback was
    // already the floor S1 gives everything, so declaring openness there grants nothing.
    for surface in [SURFACE_SIDECAR_HTTP, SURFACE_DAEMON_WS, SURFACE_CAPABILITIES, SURFACE_WEB] {
        let cfg = serde_json::json!({
            "surfaces": { surface: { "expose": "loopback", "gate": "none" } }
        });
        let decl = &parse_surfaces(&cfg).unwrap()[surface];
        assert_eq!(decl.expose, SurfaceExpose::Loopback, "{surface}: unexpected expose");
        assert_eq!(decl.gate, Some(SurfaceGate::Open), "{surface}: unexpected gate");
    }
}

// ── O2 — openness is admissible ONLY with the constraints that make it safe ────────
// Every one of these is REFUSED AT PARSE TIME, never warned about.

#[test]
fn parse_surfaces_gate_none_with_a_literal_host_is_refused() {
    // O2's core refusal: a literal address is not evidence that its peers were admitted.
    let cfg = serde_json::json!({
        "surfaces": { "web": { "expose": "host:192.168.1.5", "gate": "none" } }
    });
    let err = parse_surfaces(&cfg).unwrap_err();
    assert!(err.contains("192.168.1.5"), "must echo the declared value: {err}");
    assert!(
        err.contains("\"expose\": \"tailnet\""),
        "must name the fix, not merely the refusal: {err}"
    );
}

#[test]
fn parse_surfaces_gate_none_with_a_cgnat_range_host_is_refused_too() {
    // THE RULING, pinned: ONLY the literal `"tailnet"` counts as an admitted-device
    // transport. An address that merely LOOKS like a tailnet's (100.64.0.0/10 is RFC 6598
    // carrier-grade NAT, which Tailscale borrows but ISPs and containers also use) does
    // NOT qualify — `parse_expose` shape-validates a `host:<ip>` without resolving or
    // trusting it (S2), so inferring an ADMISSION property from a numeric range would be
    // the parser manufacturing exactly the appearance-of-a-gate O1/S3 forbid. If this ever
    // flips to `Ok`, the range-sniffing shortcut has been introduced.
    for ip in ["100.64.0.1", "100.100.100.100", "100.127.255.254"] {
        let cfg = serde_json::json!({
            "surfaces": { "web": { "expose": format!("host:{ip}"), "gate": "none" } }
        });
        let err = parse_surfaces(&cfg)
            .expect_err(&format!("host:{ip} + gate none must be refused"));
        assert!(err.contains("100.64.0.0/10"), "{ip}: must explain why the shape is not enough: {err}");
        assert!(err.contains("\"expose\": \"tailnet\""), "{ip}: must name the fix: {err}");
    }
}

#[test]
fn parse_surfaces_gate_none_with_every_interface_is_refused() {
    // O2 names `host:0.0.0.0` specifically as the combination that may never be admitted;
    // `[::]` is the same address in the other family and must not slip past.
    for raw in ["host:0.0.0.0", "host:[::]"] {
        let cfg = serde_json::json!({ "surfaces": { "web": { "expose": raw, "gate": "none" } } });
        let err =
            parse_surfaces(&cfg).expect_err(&format!("{raw} + gate none must be refused"));
        assert!(err.contains("EVERY interface"), "{raw}: must say what it is: {err}");
        assert!(err.contains("\"expose\": \"tailnet\""), "{raw}: must name the fix: {err}");
    }
}

#[test]
fn parse_surfaces_gate_none_on_a_mutating_rust_surface_is_refused_beyond_loopback() {
    // O2's read-only clause: `sidecar-http` dispatches agents and `daemon-ws` carries CRDT
    // writes, so neither may declare itself open on the tailnet — the ONE place a Rust
    // surface could otherwise have used `"none"` to bind wide with nothing enforcing.
    for surface in [SURFACE_SIDECAR_HTTP, SURFACE_DAEMON_WS] {
        let cfg = serde_json::json!({
            "surfaces": { surface: { "expose": "tailnet", "gate": "none" } }
        });
        let err = parse_surfaces(&cfg)
            .expect_err(&format!("{surface} may not declare itself open"));
        assert!(err.contains("accepts mutations"), "{surface}: must say why: {err}");
        assert!(
            err.contains("\"gate\": \"device-token\""),
            "{surface}: must name the fix: {err}"
        );
    }
}

#[test]
fn parse_surfaces_device_token_on_a_surface_that_verifies_nothing_is_refused() {
    // O1's first half (S3): a surface may not declare a gate it cannot enforce — checked
    // at EVERY expose, loopback included, because the claim is false wherever it binds.
    // This is what leaves a TS surface with nothing to say, and therefore what makes
    // `"gate": "none"` necessary rather than convenient.
    for surface in [SURFACE_CAPABILITIES, SURFACE_WEB] {
        for expose in ["loopback", "tailnet", "host:100.64.0.1"] {
            let cfg = serde_json::json!({
                "surfaces": { surface: { "expose": expose, "gate": "device-token" } }
            });
            let err = parse_surfaces(&cfg)
                .expect_err(&format!("{surface}/{expose} must be refused"));
            assert!(
                err.contains("verifies no bearer credential"),
                "{surface}/{expose}: must say why: {err}"
            );
            assert!(
                err.contains("\"gate\": \"none\""),
                "{surface}/{expose}: must name the honest alternative: {err}"
            );
        }
    }
}

#[test]
fn parse_surfaces_ts_surface_beyond_loopback_with_no_gate_at_all_is_still_refused() {
    // Silence is not openness (S1/O1): a TS surface on the tailnet with NO `gate` key is
    // refused exactly as before — widening the vocabulary must not have widened the hole.
    let cfg = serde_json::json!({ "surfaces": { "web": { "expose": "tailnet" } } });
    let err = parse_surfaces(&cfg).unwrap_err();
    assert!(err.contains("no credential gate implemented"), "unexpected: {err}");
    assert!(err.contains("\"gate\": \"none\""), "must name the fix: {err}");
}

// ── O4 — one vocabulary, two enforcers ────────────────────────────────────────────

#[test]
fn parse_surfaces_ts_surfaces_are_in_the_vocabulary_but_enforce_nothing() {
    // The catalog widened (a TS entry no longer stops the daemon booting), and the
    // enforcement table did NOT: Rust still owns exactly two surfaces.
    for surface in [SURFACE_CAPABILITIES, SURFACE_WEB] {
        let cfg = serde_json::json!({ "surfaces": { surface: { "expose": "loopback" } } });
        assert!(parse_surfaces(&cfg).is_ok(), "{surface} must parse");
        assert_eq!(surface_enforceable_gate(surface), None, "{surface} must enforce nothing");
    }
}

#[test]
fn parse_surfaces_a_declared_ts_surface_never_reaches_binding_logic() {
    // O4's split, proven behaviourally rather than asserted: an OPEN `web` declaration
    // parses, and yet nothing about the Rust binds changes. Both Rust guards look their
    // declaration up BY KEY (main.rs does the same), so they see `None` — S1's loopback
    // ceiling — and refuse a non-loopback bind exactly as if nothing had been declared.
    let cfg = serde_json::json!({
        "surfaces": { "web": { "expose": "tailnet", "gate": "none" } }
    });
    let surfaces = parse_surfaces(&cfg).unwrap();
    assert!(surfaces.get(SURFACE_SIDECAR_HTTP).is_none());
    assert!(surfaces.get(SURFACE_DAEMON_WS).is_none());
    assert!(
        crate::sidecar::bind_guard::refuse_unguarded_nonloopback_bind(
            "100.64.0.1",
            true,
            surfaces.get(SURFACE_SIDECAR_HTTP),
        )
        .is_err(),
        "an open TS surface must never widen the sidecar's bind"
    );
    assert!(
        crate::sidecar::bind_guard::refuse_unguarded_nonloopback_ws_bind(
            "100.64.0.1",
            true,
            surfaces.get(SURFACE_DAEMON_WS),
        )
        .is_err(),
        "an open TS surface must never widen the WS bind"
    );
}

#[test]
fn parse_surfaces_one_config_parses_for_both_runtimes() {
    // O4's point in one assertion: the operator's live declaration PLUS the TS surfaces
    // that motivated this slice, in ONE file, parsed by the Rust runtime without refusal.
    let cfg = serde_json::json!({
        "surfaces": {
            "sidecar-http": { "expose": "tailnet", "gate": "device-token" },
            "daemon-ws": { "expose": "loopback" },
            "web": { "expose": "tailnet", "gate": "none" },
            "capabilities": { "expose": "loopback" }
        }
    });
    let out = parse_surfaces(&cfg).unwrap();
    assert_eq!(out.len(), 4);
    assert_eq!(out[SURFACE_SIDECAR_HTTP].gate, Some(SurfaceGate::DeviceToken));
    assert_eq!(out[SURFACE_WEB].gate, Some(SurfaceGate::Open));
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

// ── any_surface_declares_device_token_gate — the fact the policy path derives from ──

#[test]
fn no_declared_gate_anywhere_is_false() {
    // Includes the shapes that look adjacent to a gate but are not one: nothing declared
    // at all, and a loopback surface (which needs no gate to be legal).
    assert!(!any_surface_declares_device_token_gate(&parse_surfaces(&serde_json::json!({})).unwrap()));
    let cfg = serde_json::json!({ "surfaces": { "sidecar-http": { "expose": "loopback" } } });
    assert!(!any_surface_declares_device_token_gate(&parse_surfaces(&cfg).unwrap()));
}

#[test]
fn a_single_declared_device_token_gate_is_enough() {
    // This is what makes the conventional policy path meaningful — declaring the gate is
    // the opt-in, so no `REFARM_AUTH_POLICY` export is needed to be believed.
    let cfg = serde_json::json!({
        "surfaces": { "sidecar-http": { "expose": "host:0.0.0.0", "gate": "device-token" } }
    });
    assert!(any_surface_declares_device_token_gate(&parse_surfaces(&cfg).unwrap()));
}

#[test]
fn a_gate_on_one_surface_answers_true_for_the_node_without_widening_the_other() {
    // Node-WIDE by design (one policy file, one resolution). The guard, not this query,
    // is what keeps `daemon-ws` closed: it still requires ITS OWN declaration + gate.
    let cfg = serde_json::json!({
        "surfaces": {
            "sidecar-http": { "expose": "host:0.0.0.0", "gate": "device-token" },
            "daemon-ws": { "expose": "loopback" }
        }
    });
    let surfaces = parse_surfaces(&cfg).unwrap();
    assert!(any_surface_declares_device_token_gate(&surfaces));
    assert!(
        crate::sidecar::bind_guard::refuse_unguarded_nonloopback_ws_bind(
            "100.64.0.1",
            true,
            surfaces.get(SURFACE_DAEMON_WS),
        )
        .is_err(),
        "a gate declared on sidecar-http must never widen a loopback daemon-ws"
    );
}

#[test]
fn open_gate_does_not_derive_an_auth_policy_path() {
    // THE mutation guard for O1's second half: `"gate": "none"` must never satisfy
    // anything that wants a REAL gate. If this predicate ever loosened to
    // `decl.gate.is_some()`, a node whose ONLY declaration is deliberate openness would
    // manufacture the `auth_policy_resolvable` signal `bind_guard` reads as "a credential
    // gate is live" — an open surface conjuring the appearance of a closed one.
    for (label, cfg) in [
        (
            "an open TS surface alone",
            serde_json::json!({ "surfaces": { "web": { "expose": "tailnet", "gate": "none" } } }),
        ),
        (
            "an open surface on loopback",
            serde_json::json!({
                "surfaces": {
                    "capabilities": { "expose": "loopback", "gate": "none" },
                    "sidecar-http": { "expose": "loopback", "gate": "none" }
                }
            }),
        ),
    ] {
        let surfaces = parse_surfaces(&cfg).unwrap();
        assert!(
            !any_surface_declares_device_token_gate(&surfaces),
            "{label}: declared openness is not a declared credential gate"
        );
    }
}

#[test]
fn an_open_surface_alongside_a_gated_one_neither_adds_nor_removes_the_node_wide_fact() {
    // The node-wide answer must come from the DEVICE-TOKEN declaration only — an open
    // surface sitting next to it neither creates the fact nor cancels it.
    let cfg = serde_json::json!({
        "surfaces": {
            "sidecar-http": { "expose": "tailnet", "gate": "device-token" },
            "web": { "expose": "tailnet", "gate": "none" }
        }
    });
    assert!(any_surface_declares_device_token_gate(&parse_surfaces(&cfg).unwrap()));
}

// ── the operator's live config shape, pinned ──────────────────────────────────────

#[test]
fn resolve_surfaces_parses_the_operators_live_declaration() {
    // A FIXTURE of the shape actually in `.refarm/config.json` on the operator's machine
    // (`sidecar-http` on the tailnet behind a device-token gate; `daemon-ws` loopback).
    // Widening the vocabulary and adding a gate value must not disturb the declaration a
    // live daemon is running on right now — this is the regression that would be felt
    // immediately, as a daemon that no longer boots.
    let _env = crate::test_support::env_lock();
    ensure_sovereign_dir_env();
    let dir = tempfile::tempdir().unwrap();
    write_surfaces_config(
        dir.path(),
        r#"{"sidecar-http":{"expose":"tailnet","gate":"device-token"},"daemon-ws":{"expose":"loopback"}}"#,
    );
    let out = resolve_surfaces(dir.path()).unwrap();
    assert_eq!(out.len(), 2);
    assert_eq!(out[SURFACE_SIDECAR_HTTP].expose, SurfaceExpose::Tailnet);
    assert_eq!(out[SURFACE_SIDECAR_HTTP].gate, Some(SurfaceGate::DeviceToken));
    assert_eq!(out[SURFACE_DAEMON_WS].expose, SurfaceExpose::Loopback);
    assert_eq!(out[SURFACE_DAEMON_WS].gate, None);
    assert!(
        any_surface_declares_device_token_gate(&out),
        "the operator's declaration must still derive the auth-policy path"
    );
}

#[test]
fn resolve_surfaces_parses_the_operators_declaration_with_a_ts_surface_added() {
    // The file the next slice writes: the live declaration UNCHANGED, plus the open TS
    // surface that used to stop the daemon booting (O4). Both must load, and the Rust
    // side's two answers must be byte-identical to the fixture above.
    let _env = crate::test_support::env_lock();
    ensure_sovereign_dir_env();
    let dir = tempfile::tempdir().unwrap();
    write_surfaces_config(
        dir.path(),
        r#"{"sidecar-http":{"expose":"tailnet","gate":"device-token"},"daemon-ws":{"expose":"loopback"},"web":{"expose":"tailnet","gate":"none"}}"#,
    );
    let out = resolve_surfaces(dir.path()).unwrap();
    assert_eq!(out.len(), 3);
    assert_eq!(out[SURFACE_SIDECAR_HTTP].expose, SurfaceExpose::Tailnet);
    assert_eq!(out[SURFACE_SIDECAR_HTTP].gate, Some(SurfaceGate::DeviceToken));
    assert_eq!(out[SURFACE_DAEMON_WS].expose, SurfaceExpose::Loopback);
    assert_eq!(out[SURFACE_WEB].gate, Some(SurfaceGate::Open));
}
