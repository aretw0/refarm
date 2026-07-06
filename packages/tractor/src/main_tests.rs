//! Tests for the tractor binary (main.rs). Split into a sibling file to keep
//! main.rs lean; included via #[path] so `super::*` still resolves to main.rs.

    use super::*;
    use std::sync::Arc;

    use tokio::net::TcpListener;
    use tractor::{PluginChannels, NativeStorage, NativeSync, TelemetryBus};

    fn test_response_event(
        content: &str,
        is_final: bool,
        prompt_ref: Option<&str>,
    ) -> AgentResponseEvent {
        AgentResponseEvent {
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
        let err =
            resolve_stream_ref_filter(None, Some("")).expect_err("empty prompt refs should fail");
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
            payload:
                serde_json::json!({ "payload_kind": STREAM_CHUNK_PAYLOAD_KIND_FINAL_TOOL_CALL })
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
        let config = TractorNativeConfig {
            namespace: ":memory:".to_string(),
            port: 0,
            security_mode: SecurityMode::None,
            ..Default::default()
        };

        let tractor = TractorNative::boot(config).await.expect("boot tractor");
        let fixture = std::path::Path::new("tests/fixtures/null-plugin.wasm");
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
        let server =
            daemon::WsServer::new(sync, port, telemetry, channels, tractor::EventRouter::default());

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
