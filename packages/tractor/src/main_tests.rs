//! Tests for the tractor binary (main.rs). Split into a sibling file to keep
//! main.rs lean; included via #[path] so `super::*` still resolves to main.rs.

use super::*;
use std::sync::Arc;

use tokio::net::TcpListener;
use tractor::{NativeStorage, NativeSync, PluginChannels, TelemetryBus};

/// An `AuthPolicySource` for tests that are not about the policy: a refarm dir that does
/// not exist and NO declared `device-token` gate, so nothing is resolvable and the
/// preflight's answer depends only on the thing the test is actually asserting. The unit
/// coverage for the derivation itself lives beside it, in `sidecar::auth`.
fn no_auth_source() -> tractor::sidecar::AuthPolicySource {
    tractor::sidecar::AuthPolicySource::new(
        std::path::PathBuf::from("/nonexistent-refarm-dir"),
        false,
    )
}

/// The RESOLVED counterpart, for `WsServer::new` — which since the single-resolution fix
/// takes the answer, not the source (main.rs resolves once at boot and hands the value to
/// both gates). Resolving `no_auth_source()` yields "no gate" with no file read and no log
/// line, which is what tests that are not about the policy want.
fn no_auth_policy() -> tractor::sidecar::ResolvedAuthPolicy {
    tractor::sidecar::ResolvedAuthPolicy::resolve(&no_auth_source())
}

fn test_response_event(content: &str, is_final: bool, prompt_ref: Option<&str>) -> ResponseEvent {
    ResponseEvent {
        id: format!("event-{content}-{is_final}"),
        source_plugin: Some("agent".to_string()),
        updated_at: "2026-04-29T00:00:00Z".to_string(),
        sequence: 0,
        is_final,
        prompt_ref: prompt_ref.map(ToOwned::to_owned),
        content: content.to_string(),
        timestamp_ns: 0,
        llm_tokens_in: 0,
        llm_tokens_out: 0,
        llm_estimated_usd: 0.0,
        llm_duration_ms: 0,
    }
}

#[test]
fn plain_output_streams_partials_without_reprinting_final_content() {
    let mut state = PlainResponseOutputState::default();

    let first = render_plain_response_event(
        &test_response_event("Olá ", false, Some("prompt-1")),
        &mut state,
    );
    let second = render_plain_response_event(
        &test_response_event("stream", false, Some("prompt-1")),
        &mut state,
    );
    let final_output = render_plain_response_event(
        &test_response_event("Olá stream", true, Some("prompt-1")),
        &mut state,
    );

    assert_eq!(first.stdout, "Olá ");
    assert_eq!(second.stdout, "stream");
    assert_eq!(final_output.stdout, "\n");
    assert!(final_output.stderr.is_empty());
}

#[test]
fn plain_output_tracks_partial_state_per_prompt_ref() {
    let mut state = PlainResponseOutputState::default();

    let _ = render_plain_response_event(
        &test_response_event("first ", false, Some("prompt-a")),
        &mut state,
    );
    let final_b = render_plain_response_event(
        &test_response_event("other", true, Some("prompt-b")),
        &mut state,
    );
    let final_a = render_plain_response_event(
        &test_response_event("first done", true, Some("prompt-a")),
        &mut state,
    );

    assert_eq!(final_b.stdout, "other\n");
    assert_eq!(final_a.stdout, "\n");
}

#[test]
fn plain_output_prints_non_streamed_final_content_and_metadata() {
    let mut state = PlainResponseOutputState::default();
    let mut event = test_response_event("done", true, Some("prompt-2"));
    event.llm_tokens_in = 3;
    event.llm_tokens_out = 4;
    event.llm_duration_ms = 25;

    let output = render_plain_response_event(&event, &mut state);

    assert_eq!(output.stdout, "done\n");
    assert_eq!(output.stderr, "# 3→4 tokens  $0.0000  25ms\n");
}

#[test]
fn query_cli_filters_stream_rows_by_agent_and_stream_ref() {
    let row = tractor::storage::NodeRow {
        id: "chunk-1".to_string(),
        type_: "StreamChunk".to_string(),
        context: None,
        payload: serde_json::json!({
            "@type": "StreamChunk",
            "stream_ref": "stream-a",
            "sequence": 1,
            "timestamp_ns": 10,
        })
        .to_string(),
        source_plugin: Some("agent".to_string()),
        updated_at: "2026-04-30T00:00:00Z".to_string(),
    };

    assert!(row_matches_cli_filters(&row, "agent", Some("stream-a")));
    assert!(!row_matches_cli_filters(
        &row,
        "other-agent",
        Some("stream-a")
    ));
    assert!(!row_matches_cli_filters(&row, "agent", Some("stream-b")));
}

#[test]
fn query_cli_orders_stream_rows_by_timestamp_and_sequence() {
    let mut rows = vec![
        tractor::storage::NodeRow {
            id: "chunk-b".to_string(),
            type_: "StreamChunk".to_string(),
            context: None,
            payload: serde_json::json!({ "timestamp_ns": 10, "sequence": 2 }).to_string(),
            source_plugin: Some("agent".to_string()),
            updated_at: "2026-04-30T00:00:00Z".to_string(),
        },
        tractor::storage::NodeRow {
            id: "chunk-a".to_string(),
            type_: "StreamChunk".to_string(),
            context: None,
            payload: serde_json::json!({ "timestamp_ns": 10, "sequence": 1 }).to_string(),
            source_plugin: Some("agent".to_string()),
            updated_at: "2026-04-30T00:00:00Z".to_string(),
        },
    ];

    rows.sort_by(cli_node_order);

    assert_eq!(rows[0].id, "chunk-a");
    assert_eq!(rows[1].id, "chunk-b");
}

#[test]
fn daemon_cli_accepts_model_stream_responses_flag() {
    let cli = Cli::try_parse_from(["tractor", "--model-stream-responses"]).expect("cli parse");

    assert!(cli.daemon.model_stream_responses);
}

#[test]
fn daemon_cli_ws_host_is_absent_by_default() {
    // Mutation guard for Problem 1: `--ws-host` (and `--http-host`) must NOT carry a
    // `default_value` anymore. Under S5 (a flag may only narrow, never widen) a CLI
    // default is not neutral — a default value is indistinguishable from an explicit
    // operator choice, so a value that is ALWAYS present would ALWAYS narrow, and a
    // `surfaces.*` declaration could never take effect. Absence is what lets the
    // declaration decide; see `daemon::preflight_ws_bind_host` /
    // `sidecar::bind_guard::resolve_sidecar_bind_host` for where that resolution lives.
    let cli = Cli::try_parse_from(["tractor"]).expect("cli parse");
    assert_eq!(cli.daemon.ws_host, None);
}

#[test]
fn daemon_cli_accepts_ws_host_override() {
    let cli =
        Cli::try_parse_from(["tractor", "--ws-host", "0.0.0.0"]).expect("cli parse");
    assert_eq!(cli.daemon.ws_host, Some("0.0.0.0".to_string()));
}

#[test]
fn daemon_cli_http_host_is_absent_by_default() {
    // Same mutation guard as `daemon_cli_ws_host_is_absent_by_default`, for the flag
    // that was ACTUALLY broken by a `default_value` (`--ws-host` is unconditionally
    // refused non-loopback regardless, so its old default was harmless; `--http-host`'s
    // default is what made `surfaces.sidecar-http` inert — see main.rs's doc comment).
    let cli = Cli::try_parse_from(["tractor"]).expect("cli parse");
    assert_eq!(cli.daemon.http_host, None);
}

#[test]
fn ws_host_preflight_resolves_absent_flag_to_loopback() {
    // `daemon::preflight_ws_bind_host` now RESOLVES the bind host too (not just
    // validates): an absent flag + no declaration resolves to loopback and is
    // returned, not just Ok(()). It also returns the EFFECTIVE declaration (`tailnet`
    // resolution — see `sidecar::tailnet_resolve`); `None` in, `None` out here.
    let (host, effective_surface) = daemon::preflight_ws_bind_host(None, None, &no_auth_source()).unwrap();
    assert_eq!(host, "127.0.0.1");
    assert!(effective_surface.is_none());
}

#[test]
fn ws_host_preflight_refuses_nonloopback_before_boot() {
    // `--ws-host` PARSES anything (the test above) — the refusal is a separate,
    // deliberate step so the operator gets a reason, not a clap usage error. This
    // asserts `run_daemon`'s FIRST act rejects a non-loopback host with no declaration,
    // PURE: no runtime booted, no socket opened. Mutation guard for deleting the
    // preflight call — without it the refusal moves to after a full boot (and used to
    // skip shutdown).
    assert!(daemon::preflight_ws_bind_host(Some("0.0.0.0"), None, &no_auth_source()).is_err());
    assert!(daemon::preflight_ws_bind_host(Some("100.64.0.1"), None, &no_auth_source()).is_err());
    assert!(daemon::preflight_ws_bind_host(Some("127.0.0.1"), None, &no_auth_source()).is_ok());
}

#[test]
fn ws_host_preflight_ignores_a_configured_auth_policy_when_undeclared() {
    // S1: an UNDECLARED `daemon-ws` binds loopback only, and a configured policy does
    // not widen that — same as the sidecar's own S1 guard. Setting the env the sidecar
    // (and, since ADR-093, the WS handshake) uses must change nothing here when there
    // is no `surfaces.daemon-ws` declaration at all. Uses a path that need not exist:
    // the preflight's cheap presence peek never reads the file's contents.
    std::env::set_var("REFARM_AUTH_POLICY", "/nonexistent/policy.json");
    let refused = daemon::preflight_ws_bind_host(Some("100.64.0.1"), None, &no_auth_source()).is_err();
    std::env::remove_var("REFARM_AUTH_POLICY");
    assert!(refused, "an undeclared surface must not be unlocked by a policy alone");
}

#[test]
fn watch_cli_accepts_generic_stream_filters() {
    let cli = Cli::try_parse_from([
        "tractor",
        "watch",
        "--type",
        "StreamChunk",
        "--stream-ref",
        "urn:tractor:stream:response:prompt-1",
        "--until-final",
    ])
    .expect("cli parse");

    let Some(Command::Watch(args)) = cli.command else {
        panic!("expected watch command");
    };
    assert_eq!(args.r#type, "StreamChunk");
    assert_eq!(
        args.stream_ref.as_deref(),
        Some("urn:tractor:stream:response:prompt-1")
    );
    assert!(args.until_final);
}

#[test]
fn watch_cli_accepts_prompt_ref_stream_filter() {
    let cli = Cli::try_parse_from([
        "tractor",
        "watch",
        "--type",
        "StreamChunk",
        "--prompt-ref",
        "prompt-1",
        "--until-final",
    ])
    .expect("cli parse");

    let Some(Command::Watch(args)) = cli.command else {
        panic!("expected watch command");
    };
    assert_eq!(args.r#type, "StreamChunk");
    assert_eq!(args.prompt_ref.as_deref(), Some("prompt-1"));
    assert!(args.until_final);
    assert_eq!(
        resolve_stream_ref_filter(args.stream_ref.as_deref(), args.prompt_ref.as_deref())
            .expect("stream ref filter"),
        Some("urn:tractor:stream:response:prompt-1".to_string())
    );
}

#[test]
fn query_cli_accepts_prompt_ref_stream_filter() {
    let cli = Cli::try_parse_from([
        "tractor",
        "query",
        "--type",
        "StreamSession",
        "--prompt-ref",
        "prompt-1",
    ])
    .expect("cli parse");

    let Some(Command::Query(args)) = cli.command else {
        panic!("expected query command");
    };
    assert_eq!(args.r#type, "StreamSession");
    assert_eq!(args.prompt_ref.as_deref(), Some("prompt-1"));
    assert_eq!(
        resolve_stream_ref_filter(args.stream_ref.as_deref(), args.prompt_ref.as_deref())
            .expect("stream ref filter"),
        Some("urn:tractor:stream:response:prompt-1".to_string())
    );
}

#[test]
fn stream_ref_filter_rejects_ambiguous_inputs() {
    let err = resolve_stream_ref_filter(Some("stream-a"), Some("prompt-a"))
        .expect_err("ambiguous stream filters should fail");
    assert!(err
        .to_string()
        .contains("either --stream-ref or --prompt-ref"));
}

#[test]
fn stream_ref_filter_rejects_empty_prompt_refs() {
    let err = resolve_stream_ref_filter(None, Some("")).expect_err("empty prompt refs should fail");
    assert!(err.to_string().contains("--prompt-ref must not be empty"));
}

#[test]
fn generic_watch_detects_terminal_stream_rows() {
    let final_chunk = tractor::storage::NodeRow {
        id: "chunk-final".to_string(),
        type_: "StreamChunk".to_string(),
        context: None,
        payload: serde_json::json!({ "is_final": true }).to_string(),
        source_plugin: Some("agent".to_string()),
        updated_at: "2026-04-30T00:00:00Z".to_string(),
    };
    let final_marker = tractor::storage::NodeRow {
        id: "chunk-marker".to_string(),
        type_: "StreamChunk".to_string(),
        context: None,
        payload: serde_json::json!({ "payload_kind": STREAM_CHUNK_PAYLOAD_KIND_FINAL_TOOL_CALL })
            .to_string(),
        source_plugin: Some("agent".to_string()),
        updated_at: "2026-04-30T00:00:00Z".to_string(),
    };
    let failed_session = tractor::storage::NodeRow {
        id: "session-failed".to_string(),
        type_: "StreamSession".to_string(),
        context: None,
        payload: serde_json::json!({ "status": STREAM_SESSION_STATUS_FAILED }).to_string(),
        source_plugin: Some("agent".to_string()),
        updated_at: "2026-04-30T00:00:00Z".to_string(),
    };
    let active_session = tractor::storage::NodeRow {
        id: "session-active".to_string(),
        type_: "StreamSession".to_string(),
        context: None,
        payload: serde_json::json!({ "status": "active" }).to_string(),
        source_plugin: Some("agent".to_string()),
        updated_at: "2026-04-30T00:00:00Z".to_string(),
    };

    assert!(node_row_is_terminal(&final_chunk));
    assert!(node_row_is_terminal(&final_marker));
    assert!(node_row_is_terminal(&failed_session));
    assert!(!node_row_is_terminal(&active_session));
}

#[test]
fn plugin_load_policy_defaults_to_warn_and_continue() {
    let cli = Cli::try_parse_from(["tractor"]).expect("cli parse");
    assert_eq!(
        plugin_load_policy(&cli.daemon),
        PluginLoadPolicy::WarnAndContinue
    );
}

#[test]
fn plugin_load_policy_switches_to_fail_fast_when_flag_is_set() {
    let cli = Cli::try_parse_from(["tractor", "--require-plugin-load"]).expect("cli parse");
    assert_eq!(plugin_load_policy(&cli.daemon), PluginLoadPolicy::FailFast);
}

#[test]
fn require_plugin_load_flag_allows_plugin_arguments() {
    let cli = Cli::try_parse_from([
        "tractor",
        "--require-plugin-load",
        "--plugin",
        "./plugins/agent.wasm",
    ])
    .expect("cli parse");

    assert_eq!(plugin_load_policy(&cli.daemon), PluginLoadPolicy::FailFast);
    assert_eq!(cli.daemon.plugin.len(), 1);
}

#[test]
fn plugin_ingest_policy_defaults_to_skip() {
    let cli = Cli::try_parse_from(["tractor"]).expect("cli parse");
    assert_eq!(plugin_ingest_policy(&cli.daemon), PluginIngestPolicy::Skip);
}

#[test]
fn plugin_ingest_policy_switches_to_warn_and_continue_when_enabled() {
    let cli = Cli::try_parse_from(["tractor", "--ingest-on-load"]).expect("cli parse");
    assert_eq!(
        plugin_ingest_policy(&cli.daemon),
        PluginIngestPolicy::WarnAndContinue
    );
}

#[test]
fn plugin_ingest_policy_switches_to_fail_fast_when_flag_is_set() {
    let cli = Cli::try_parse_from(["tractor", "--require-plugin-ingest"]).expect("cli parse");
    assert_eq!(
        plugin_ingest_policy(&cli.daemon),
        PluginIngestPolicy::FailFast
    );
}

#[test]
fn require_plugin_ingest_flag_allows_plugin_arguments() {
    let cli = Cli::try_parse_from([
        "tractor",
        "--require-plugin-ingest",
        "--plugin",
        "./plugins/agent.wasm",
    ])
    .expect("cli parse");

    assert_eq!(
        plugin_ingest_policy(&cli.daemon),
        PluginIngestPolicy::FailFast
    );
    assert_eq!(cli.daemon.plugin.len(), 1);
}

#[tokio::test]
async fn maybe_ingest_on_load_runs_with_plugin_fixture() {
    // `tests/fixtures/null-plugin.wasm` has no sibling `plugin.json` in the SHARED fixtures
    // directory (other fixtures sit right beside it, and a manifest is resolved by PARENT
    // DIRECTORY — writing one there would become THEIR manifest too), so it declares no
    // integrity and loads only where the node declared it is under development. A guessed
    // file-stem id must never reach that config-declared route (see
    // `resolve_under_development_at_load`'s doc in env_and_runtime.rs) — one node-wide
    // `refarm plugin develop plugin` must not waive every manifest-less artifact — so this
    // copies the fixture into an isolated dir with its own manifest naming its REAL exported
    // identity (`null-plugin`/`0.1.0`) below. `test_support` is private to the `tractor`
    // LIBRARY crate and not reachable from this bin-crate test, so the env override is
    // declared directly: a temp `.refarm/config.json` under a dedicated SOVEREIGN_BASE,
    // restored on drop.
    struct RestoreEnv {
        prev_base: Option<String>,
        prev_dir: Option<String>,
    }
    impl Drop for RestoreEnv {
        fn drop(&mut self) {
            match self.prev_base.take() {
                Some(v) => std::env::set_var("SOVEREIGN_BASE", v),
                None => std::env::remove_var("SOVEREIGN_BASE"),
            }
            match self.prev_dir.take() {
                Some(v) => std::env::set_var("SOVEREIGN_DIR", v),
                None => std::env::remove_var("SOVEREIGN_DIR"),
            }
        }
    }
    let _restore = RestoreEnv {
        prev_base: std::env::var("SOVEREIGN_BASE").ok(),
        prev_dir: std::env::var("SOVEREIGN_DIR").ok(),
    };
    let dev_dir = tempfile::tempdir().expect("tempdir");
    let refarm_dir = dev_dir.path().join(".refarm");
    std::fs::create_dir_all(&refarm_dir).expect("mkdir .refarm");
    std::fs::write(
        refarm_dir.join("config.json"),
        r#"{"pluginDevelopment":{"null-plugin":{"declaredAt":"2026-08-26"}}}"#,
    )
    .expect("write config.json");
    std::env::set_var("SOVEREIGN_BASE", dev_dir.path());
    std::env::set_var("SOVEREIGN_DIR", ".refarm");

    let plugin_dir = dev_dir.path().join("plugin");
    std::fs::create_dir_all(&plugin_dir).expect("mkdir plugin dir");
    let fixture = plugin_dir.join("plugin.wasm");
    std::fs::copy("tests/fixtures/null-plugin.wasm", &fixture)
        .expect("copy null-plugin.wasm fixture");
    std::fs::write(
        plugin_dir.join("plugin.json"),
        r#"{"id":"null-plugin","version":"0.1.0","entry":"plugin.wasm","observability":{"hooks":["onLoad","onInit","onRequest","onError","onTeardown"]}}"#,
    )
    .expect("write plugin.json");

    let config = TractorNativeConfig {
        namespace: ":memory:".to_string(),
        port: 0,
        security_mode: SecurityMode::None,
        ..Default::default()
    };

    let tractor = TractorNative::boot(config).await.expect("boot tractor");
    let fixture = fixture.as_path();
    let mut handle = tractor
        .load_plugin(fixture)
        .await
        .expect("load fixture plugin");

    let result =
        maybe_ingest_on_load(&mut handle, fixture, PluginIngestPolicy::WarnAndContinue).await;
    assert!(result.is_ok(), "ingest-on-load should succeed: {result:?}");

    let metadata = handle.call_metadata().await.expect("metadata call");
    assert_eq!(metadata["name"], "null-plugin");

    tractor.shutdown().await.expect("shutdown tractor");
}

#[tokio::test]
async fn runtime_boot_probe_succeeds_in_memory_namespace() {
    let result = probe_runtime_boot(":memory:").await;
    assert!(result.is_ok(), "boot probe should succeed: {result:?}");
}

#[tokio::test]
async fn ws_probe_returns_error_when_daemon_is_unavailable() {
    let result = probe_ws_daemon(1, Duration::from_millis(200)).await;
    assert!(
        result.is_err(),
        "ws probe should fail when daemon is unavailable"
    );
}

#[tokio::test]
async fn ws_probe_succeeds_when_daemon_is_listening() {
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind listener");
    let port = listener.local_addr().expect("listener local addr").port();

    let storage = NativeStorage::open(":memory:").expect("open storage");
    let sync = Arc::new(NativeSync::new(storage, "health-probe").expect("new sync"));
    let telemetry = TelemetryBus::new(10);
    let channels: PluginChannels =
        Arc::new(std::sync::RwLock::new(std::collections::HashMap::new()));
    let server = daemon::WsServer::new(
        sync,
        "127.0.0.1".to_string(),
        port,
        telemetry,
        channels,
        tractor::EventRouter::default(),
        None,
        no_auth_policy(),
    );

    tokio::spawn(async move {
        let _ = server.run(listener).await;
    });
    tokio::time::sleep(Duration::from_millis(50)).await;

    let result = probe_ws_daemon(port, Duration::from_millis(500)).await;
    assert!(
        result.is_ok(),
        "ws probe should succeed when daemon is listening: {result:?}"
    );
}
