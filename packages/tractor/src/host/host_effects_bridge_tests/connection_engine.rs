// The connection probe loop. The probe decides readiness; output only produces notices.

#[cfg(test)]
mod connection_engine_tests {
    use super::*;
    use crate::{NativeStorage, NativeSync};
    use std::sync::atomic::{AtomicU32, Ordering};
    use std::sync::Arc;
    use tokio::sync::{mpsc, Notify};

    fn sync() -> NativeSync {
        let storage = NativeStorage::open(":memory:").unwrap();
        NativeSync::new(storage, ":memory:").unwrap()
    }

    fn decl_from(json: serde_json::Value) -> ConnectionDeclaration {
        parse_connections(&serde_json::json!({ "connections": { "c": json } }))
            .unwrap()
            .remove("c")
            .unwrap()
    }

    fn base(extra: serde_json::Value) -> ConnectionDeclaration {
        let mut obj = serde_json::json!({
            "establish": ["bin"],
            "probe": { "run": ["true"] },
            "probeIntervalMs": 1,
            "readyTimeoutMs": 200
        });
        if let (Some(o), Some(e)) = (obj.as_object_mut(), extra.as_object()) {
            for (k, v) in e {
                o.insert(k.clone(), v.clone());
            }
        }
        decl_from(obj)
    }

    /// A process that emits `lines` and then STAYS OPEN (a held connection).
    fn holding(lines: &[&str]) -> (FlowProcess, mpsc::Sender<String>, Arc<Notify>) {
        let (tx, rx) = mpsc::channel(64);
        for line in lines {
            tx.try_send((*line).to_string()).unwrap();
        }
        let stop = Arc::new(Notify::new());
        (FlowProcess { chunks: rx, stop: stop.clone() }, tx, stop)
    }

    /// A process that emits `lines` and then ENDS.
    fn ending(lines: &[&str]) -> FlowProcess {
        let (tx, rx) = mpsc::channel(64);
        for line in lines {
            tx.try_send((*line).to_string()).unwrap();
        }
        drop(tx);
        FlowProcess { chunks: rx, stop: Arc::new(Notify::new()) }
    }

    fn clock() -> impl Fn() -> u64 + Sync {
        let c = std::sync::atomic::AtomicU64::new(0);
        move || c.fetch_add(1, Ordering::SeqCst)
    }

    /// A probe that fails `fail_times` times and then succeeds forever.
    fn probe_after(fail_times: u32) -> impl FnMut() -> bool + Send {
        let calls = AtomicU32::new(0);
        move || calls.fetch_add(1, Ordering::SeqCst) >= fail_times
    }

    #[tokio::test]
    async fn ready_when_the_probe_succeeds() {
        let sync = sync();
        let decl = base(serde_json::json!({}));
        let (mut proc_, _tx, _stop) = holding(&["▶ Conectando…\n"]);
        let mut probe = probe_after(0);
        let mut pubr = ConnectionFramePublisher::new("c", 0);
        let clk = clock();

        let out = establish(&decl, &mut proc_, &mut probe, &mut pubr, &sync, &clk).await.unwrap();
        assert!(matches!(out, EstablishOutcome::Ready));
    }

    #[tokio::test]
    async fn output_alone_never_makes_a_connection_ready() {
        // THE point of the probe: a process can claim success in its output and still not
        // be up. Only the probe decides.
        let sync = sync();
        let decl = base(serde_json::json!({ "readyTimeoutMs": 60 }));
        let (mut proc_, _tx, _stop) = holding(&["✅ VPN Serpro CONECTADA\n"]);
        let mut probe = || false;
        let mut pubr = ConnectionFramePublisher::new("c", 0);
        let clk = clock();

        let out = establish(&decl, &mut proc_, &mut probe, &mut pubr, &sync, &clk).await.unwrap();
        assert!(matches!(out, EstablishOutcome::Timeout), "the output lied; the probe did not");
    }

    #[tokio::test]
    async fn the_probe_is_retried_until_it_succeeds() {
        let sync = sync();
        let decl = base(serde_json::json!({}));
        let (mut proc_, _tx, _stop) = holding(&[]);
        let mut probe = probe_after(3);
        let mut pubr = ConnectionFramePublisher::new("c", 0);
        let clk = clock();

        let out = establish(&decl, &mut proc_, &mut probe, &mut pubr, &sync, &clk).await.unwrap();
        assert!(matches!(out, EstablishOutcome::Ready));
    }

    #[tokio::test]
    async fn a_never_succeeding_probe_times_out_and_stops_the_process() {
        let sync = sync();
        let decl = base(serde_json::json!({ "readyTimeoutMs": 60 }));
        let (mut proc_, _tx, stop) = holding(&[]);
        let observed = Arc::new(std::sync::atomic::AtomicBool::new(false));
        let watcher = {
            let stop = stop.clone();
            let observed = observed.clone();
            tokio::spawn(async move {
                stop.notified().await;
                observed.store(true, Ordering::SeqCst);
            })
        };
        tokio::task::yield_now().await;

        let mut probe = || false;
        let mut pubr = ConnectionFramePublisher::new("c", 0);
        let clk = clock();
        let out = establish(&decl, &mut proc_, &mut probe, &mut pubr, &sync, &clk).await.unwrap();

        assert!(matches!(out, EstablishOutcome::Timeout));
        tokio::time::sleep(std::time::Duration::from_millis(20)).await;
        assert!(observed.load(Ordering::SeqCst), "a failed attempt must never leave the process running");
        watcher.abort();
    }

    #[tokio::test]
    async fn the_process_ending_before_the_probe_succeeds_settles_as_exit() {
        let sync = sync();
        let decl = base(serde_json::json!({}));
        let mut proc_ = ending(&["starting…\n", "gave up\n"]);
        let mut probe = || false;
        let mut pubr = ConnectionFramePublisher::new("c", 0);
        let clk = clock();

        let out = establish(&decl, &mut proc_, &mut probe, &mut pubr, &sync, &clk).await.unwrap();
        assert!(matches!(out, EstablishOutcome::Exit));
    }

    #[tokio::test]
    async fn a_notice_fires_once_per_occurrence() {
        let sync = sync();
        let decl = base(serde_json::json!({
            "notices": [{ "pattern": "Conectando", "message": "aprove o push" }],
            "readyTimeoutMs": 60
        }));
        let (mut proc_, _tx, _stop) = holding(&["Conectando…\n", "Conectando…\n"]);
        let mut probe = || false;
        let mut pubr = ConnectionFramePublisher::new("c", 0);
        let clk = clock();

        let _ = establish(&decl, &mut proc_, &mut probe, &mut pubr, &sync, &clk).await.unwrap();

        let notices = sync
            .query_nodes("StreamChunk")
            .unwrap_or_default()
            .iter()
            .filter_map(|row| serde_json::from_str::<serde_json::Value>(&row.payload).ok())
            .filter(|n| n["payload_kind"] == "notice")
            .count();
        assert_eq!(notices, 1, "a notice fires once, not per matching chunk");
    }

    #[tokio::test]
    async fn a_notice_pattern_may_span_two_chunks() {
        // A pipe does not respect line boundaries, and login-flow documents that a prompt
        // may arrive with no trailing newline — so matching is over the accumulated buffer.
        let sync = sync();
        let decl = base(serde_json::json!({
            "notices": [{ "pattern": "Conectando", "message": "aprove o push" }],
            "readyTimeoutMs": 60
        }));
        let (mut proc_, _tx, _stop) = holding(&["Conec", "tando…"]);
        let mut probe = || false;
        let mut pubr = ConnectionFramePublisher::new("c", 0);
        let clk = clock();

        let _ = establish(&decl, &mut proc_, &mut probe, &mut pubr, &sync, &clk).await.unwrap();

        let notices = sync
            .query_nodes("StreamChunk")
            .unwrap_or_default()
            .iter()
            .filter_map(|row| serde_json::from_str::<serde_json::Value>(&row.payload).ok())
            .filter(|n| n["payload_kind"] == "notice")
            .count();
        assert_eq!(notices, 1);
    }

    #[tokio::test]
    async fn the_accumulated_buffer_is_capped() {
        let sync = sync();
        let decl = base(serde_json::json!({
            "notices": [{ "pattern": "LATE-MARKER", "message": "m" }],
            "readyTimeoutMs": 60
        }));
        let filler = "x".repeat(MAX_CONNECTION_BUFFER);
        let (mut proc_, _tx, _stop) = holding(&[&filler, "LATE-MARKER"]);
        let mut probe = || false;
        let mut pubr = ConnectionFramePublisher::new("c", 0);
        let clk = clock();

        let _ = establish(&decl, &mut proc_, &mut probe, &mut pubr, &sync, &clk).await.unwrap();

        let notices = sync
            .query_nodes("StreamChunk")
            .unwrap_or_default()
            .iter()
            .filter_map(|row| serde_json::from_str::<serde_json::Value>(&row.payload).ok())
            .filter(|n| n["payload_kind"] == "notice")
            .count();
        assert_eq!(notices, 1, "the tail must stay matchable after a flood");
    }

    #[tokio::test]
    async fn a_terminal_frame_is_published_for_every_outcome() {
        let sync = sync();
        let decl = base(serde_json::json!({}));
        let (mut proc_, _tx, _stop) = holding(&[]);
        let mut probe = probe_after(0);
        let mut pubr = ConnectionFramePublisher::new("c", 0);
        let clk = clock();

        establish(&decl, &mut proc_, &mut probe, &mut pubr, &sync, &clk).await.unwrap();

        let finals: Vec<_> = sync
            .query_nodes("StreamChunk")
            .unwrap_or_default()
            .iter()
            .filter_map(|row| serde_json::from_str::<serde_json::Value>(&row.payload).ok())
            .filter(|n| n["is_final"] == true)
            .collect();
        assert_eq!(finals.len(), 1);
        assert_eq!(finals[0]["payload_kind"], "ready");
    }

    #[tokio::test]
    async fn the_probe_slice_is_clamped_to_the_deadline() {
        // The outer loop only re-checks the deadline AFTER the inner drain slice returns,
        // so an unclamped slice (`Instant::now() + interval`, not bounded by `deadline`)
        // lets `establish` block for up to one full `probe_interval_ms` past
        // `ready_timeout_ms`. Here the interval (200ms) is far larger than the timeout
        // (50ms): a clamped implementation settles Timeout close to 50ms; an unclamped one
        // blocks for ~200ms. The threshold below sits strictly between the two, so this
        // test fails under the unclamped code and passes under the clamped one.
        let sync = sync();
        let decl = base(serde_json::json!({ "probeIntervalMs": 200, "readyTimeoutMs": 50 }));
        let (mut proc_, _tx, _stop) = holding(&[]); // stays open, emits nothing
        let mut probe = || false; // never succeeds
        let mut pubr = ConnectionFramePublisher::new("c", 0);
        let clk = clock();

        let started = std::time::Instant::now();
        let out = establish(&decl, &mut proc_, &mut probe, &mut pubr, &sync, &clk).await.unwrap();
        let elapsed = started.elapsed();

        assert!(matches!(out, EstablishOutcome::Timeout));
        assert!(
            elapsed < std::time::Duration::from_millis(150),
            "establish overshot the ready-timeout: took {elapsed:?}; an unclamped slice \
             would take ~200ms, a clamped one ~50ms"
        );
    }

    #[tokio::test]
    async fn the_probe_gets_one_more_chance_before_an_ended_process_settles_as_exit() {
        // Discriminates the ordering at the top of the loop: the probe must be checked
        // BEFORE `ended` is allowed to conclude Exit, because a connect command may exit
        // once it hands the tunnel off to a daemon. The process channel is already closed
        // (ends immediately), and the probe fails on its very first call but succeeds on
        // every call after. If `ended` were checked before probing again, the loop would
        // settle Exit right after the process closes, without ever taking the second,
        // succeeding probe call — so a reversed ordering yields Exit here, not Ready.
        let sync = sync();
        let decl = base(serde_json::json!({}));
        let mut proc_ = ending(&[]);
        let mut probe = probe_after(1); // false on call 1, true from call 2 on
        let mut pubr = ConnectionFramePublisher::new("c", 0);
        let clk = clock();

        let out = establish(&decl, &mut proc_, &mut probe, &mut pubr, &sync, &clk).await.unwrap();
        assert!(
            matches!(out, EstablishOutcome::Ready),
            "the probe must get one more chance after the process ends, before Exit is concluded"
        );
    }

    fn catalog() -> std::collections::HashMap<String, ConnectionDeclaration> {
        parse_connections(&serde_json::json!({
            "connections": { "c": {
                "establish": ["bin"],
                "probe": { "run": ["true"] },
                "probeIntervalMs": 1,
                "readyTimeoutMs": 200
            }}
        }))
        .unwrap()
    }

    /// A spawner yielding a process that stays open — a held connection.
    fn holding_spawner() -> impl FnOnce(&ConnectionDeclaration) -> Result<FlowProcess, String> {
        |_decl| {
            let (tx, rx) = mpsc::channel(8);
            std::mem::forget(tx);
            Ok(FlowProcess { chunks: rx, stop: Arc::new(Notify::new()) })
        }
    }

    #[tokio::test]
    async fn ensure_establishes_a_down_connection_and_returns_a_claim() {
        let sync = sync();
        let decls = catalog();
        let reg = ConnectionRegistry::new();
        let mut probe = probe_after(0);
        let clk = clock();

        let claim = reg
            .ensure("c", "plugin.a", &decls, holding_spawner(), &mut probe, &sync, &clk)
            .await
            .unwrap();

        assert_eq!(claim.name, "c");
        assert!(matches!(reg.status("c"), ConnectionStatus::Up));
        assert_eq!(reg.spawn_count("c"), 1);
    }

    #[tokio::test]
    async fn a_second_ensure_shares_it_and_performs_no_second_login() {
        // THE guarantee: a second login is a second push on the operator's phone.
        let sync = sync();
        let decls = catalog();
        let reg = ConnectionRegistry::new();
        let clk = clock();

        let mut p1 = probe_after(0);
        let _a = reg.ensure("c", "plugin.a", &decls, holding_spawner(), &mut p1, &sync, &clk).await.unwrap();

        let mut p2 = || panic!("must not probe: the connection is already up");
        let b = reg
            .ensure("c", "plugin.b", &decls, |_| panic!("must not spawn a second process"), &mut p2, &sync, &clk)
            .await
            .unwrap();

        assert_eq!(b.name, "c");
        assert_eq!(reg.spawn_count("c"), 1);
        assert_eq!(reg.claim_count("c"), 2);
    }

    #[tokio::test]
    async fn releasing_one_claim_leaves_it_up_for_the_other() {
        let sync = sync();
        let decls = catalog();
        let reg = ConnectionRegistry::new();
        let clk = clock();
        let mut p1 = probe_after(0);

        let a = reg.ensure("c", "plugin.a", &decls, holding_spawner(), &mut p1, &sync, &clk).await.unwrap();
        let mut p2 = || true;
        let _b = reg.ensure("c", "plugin.b", &decls, |_| panic!("no second spawn"), &mut p2, &sync, &clk).await.unwrap();

        reg.release(&a);
        assert!(matches!(reg.status("c"), ConnectionStatus::Up));
        assert_eq!(reg.claim_count("c"), 1);
    }

    #[tokio::test]
    async fn releasing_the_last_claim_under_operator_linger_keeps_it_up() {
        let sync = sync();
        let decls = catalog();
        let reg = ConnectionRegistry::new();
        let clk = clock();
        let mut probe = probe_after(0);

        let a = reg.ensure("c", "plugin.a", &decls, holding_spawner(), &mut probe, &sync, &clk).await.unwrap();
        reg.release(&a);

        assert!(
            matches!(reg.status("c"), ConnectionStatus::Up),
            "operator linger is the default: re-establishing costs a human interruption"
        );
    }

    #[tokio::test]
    async fn unloading_a_plugin_releases_every_claim_it_held() {
        let sync = sync();
        let decls = catalog();
        let reg = ConnectionRegistry::new();
        let clk = clock();
        let mut p1 = probe_after(0);

        let _a = reg.ensure("c", "plugin.a", &decls, holding_spawner(), &mut p1, &sync, &clk).await.unwrap();
        let mut p2 = || true;
        let _a2 = reg.ensure("c", "plugin.a", &decls, |_| panic!("no second spawn"), &mut p2, &sync, &clk).await.unwrap();

        reg.release_owner("plugin.a");
        assert_eq!(reg.claim_count("c"), 0, "a plugin cannot leak interest past its own lifetime");
    }

    #[tokio::test]
    async fn ensure_of_an_undeclared_name_names_the_missing_declaration() {
        let sync = sync();
        let decls = catalog();
        let reg = ConnectionRegistry::new();
        let clk = clock();
        let mut probe = probe_after(0);

        let err = reg
            .ensure("nope", "plugin.a", &decls, holding_spawner(), &mut probe, &sync, &clk)
            .await
            .unwrap_err();
        assert!(err.contains("no connection named 'nope' is declared"), "unexpected: {err}");
    }

    #[tokio::test]
    async fn a_failed_attempt_leaves_it_failed_and_claimless() {
        let sync = sync();
        let decls = catalog();
        let reg = ConnectionRegistry::new();
        let clk = clock();
        let mut probe = || false;

        let err = reg
            .ensure("c", "plugin.a", &decls, holding_spawner(), &mut probe, &sync, &clk)
            .await
            .unwrap_err();

        assert!(err.contains("did not become ready"), "the reason must reach the caller: {err}");
        assert!(matches!(reg.status("c"), ConnectionStatus::Failed));
        assert_eq!(reg.claim_count("c"), 0);
    }

    #[tokio::test]
    async fn concurrent_ensures_on_a_down_connection_perform_exactly_one_spawn() {
        // THE regression this guards: two callers racing a Down connection must not both
        // pass the `Up` fast path and both spawn — for the Serpro VPN, a second spawn is a
        // second login, i.e. a second push on the operator's phone. `probe_after(1)` forces
        // the first attempt through one real probe-interval wait (a genuine `.await`), which
        // is exactly the window a caller without an establish gate would race through.
        let sync = sync();
        let decls = catalog();
        let reg = ConnectionRegistry::new();
        let clk = clock();
        let mut p1 = probe_after(1);
        let mut p2 = probe_after(0);

        let first = reg.ensure("c", "plugin.a", &decls, holding_spawner(), &mut p1, &sync, &clk);
        let second = reg.ensure(
            "c",
            "plugin.b",
            &decls,
            |_| panic!("must not spawn a second process — single-flight is broken"),
            &mut p2,
            &sync,
            &clk,
        );

        let (a, b) = tokio::join!(first, second);
        let a = a.unwrap();
        let b = b.unwrap();

        assert_eq!(a.name, "c");
        assert_eq!(b.name, "c");
        assert_eq!(reg.spawn_count("c"), 1, "single-flight: at most one process is ever spawned");
        assert_eq!(reg.claim_count("c"), 2);
    }

    #[tokio::test]
    async fn a_spawn_error_leaves_it_failed_and_claimless() {
        let sync = sync();
        let decls = catalog();
        let reg = ConnectionRegistry::new();
        let clk = clock();
        let mut probe = probe_after(0);

        let err = reg
            .ensure(
                "c",
                "plugin.a",
                &decls,
                |_decl| Err("boom: binary not found".to_string()),
                &mut probe,
                &sync,
                &clk,
            )
            .await
            .unwrap_err();

        assert_eq!(err, "boom: binary not found", "the spawn error must reach the caller");
        assert!(matches!(reg.status("c"), ConnectionStatus::Failed));
        assert_eq!(reg.claim_count("c"), 0);
        assert_eq!(reg.spawn_count("c"), 0, "an attempt that never produced a process is not a spawn");
    }

    #[tokio::test]
    async fn releasing_the_last_claim_under_zero_idle_linger_takes_it_down() {
        let sync = sync();
        let decls = parse_connections(&serde_json::json!({
            "connections": { "c": {
                "establish": ["bin"],
                "probe": { "run": ["true"] },
                "probeIntervalMs": 1,
                "readyTimeoutMs": 200,
                "linger": { "idleMs": 0 }
            }}
        }))
        .unwrap();
        let reg = ConnectionRegistry::new();
        let clk = clock();
        let mut probe = probe_after(0);

        let a = reg.ensure("c", "plugin.a", &decls, holding_spawner(), &mut probe, &sync, &clk).await.unwrap();
        reg.release(&a);

        assert!(
            matches!(reg.status("c"), ConnectionStatus::Down),
            "an idleMs: 0 linger drops the connection as soon as it becomes claimless"
        );
    }

    fn permissive_policy() -> HostEffectPolicy {
        HostEffectPolicy::default()
    }

    #[tokio::test]
    async fn the_probe_runner_reports_true_on_exit_zero() {
        let decl = base(serde_json::json!({ "probe": { "run": ["true"] } }));
        assert!(run_probe(&decl, &permissive_policy()).await);
    }

    #[tokio::test]
    async fn the_probe_runner_reports_false_on_a_nonzero_exit() {
        let decl = base(serde_json::json!({ "probe": { "run": ["false"] } }));
        assert!(!run_probe(&decl, &permissive_policy()).await);
    }

    #[tokio::test]
    async fn the_probe_runner_requires_expect_to_match_even_on_exit_zero() {
        // The real case: `ip link show` exits 0 for an interface that exists but is DOWN.
        let decl = base(serde_json::json!({
            "probe": { "run": ["echo", "ovpntun0 DOWN"], "expect": "\\bUP\\b" }
        }));
        assert!(!run_probe(&decl, &permissive_policy()).await);

        let decl_up = base(serde_json::json!({
            "probe": { "run": ["echo", "ovpntun0 UP"], "expect": "\\bUP\\b" }
        }));
        assert!(run_probe(&decl_up, &permissive_policy()).await);
    }

    #[tokio::test]
    async fn the_probe_runner_reports_false_for_a_missing_binary() {
        let decl = base(serde_json::json!({
            "probe": { "run": ["definitely-not-a-real-binary-xyz"] }
        }));
        assert!(!run_probe(&decl, &permissive_policy()).await, "a probe that cannot run means not up");
    }

    #[tokio::test]
    async fn the_establish_spawner_rejects_argv_outside_the_shell_allowlist() {
        let decl = base(serde_json::json!({ "establish": ["definitely-not-allowed"] }));
        let policy = HostEffectPolicy::new(
            Some(std::collections::HashSet::from(["echo".to_string()])),
            Ok(None),
            String::new(),
        );
        let err = spawn_establish_process(&decl, &policy).unwrap_err();
        assert!(
            err.contains("blocked"),
            "a declared connection is not an exemption from the allowlist: {err}"
        );
    }

    #[tokio::test]
    async fn the_establish_spawner_streams_a_real_process() {
        let decl = base(serde_json::json!({
            "establish": ["echo", "Conectando ao gateway"],
            "notices": [{ "pattern": "Conectando", "message": "aprove o push" }]
        }));
        let mut process = spawn_establish_process(&decl, &permissive_policy()).unwrap();
        let chunk = tokio::time::timeout(std::time::Duration::from_secs(5), process.chunks.recv())
            .await
            .expect("a chunk arrives")
            .expect("the stream is open");
        assert!(chunk.contains("Conectando"), "unexpected: {chunk}");
    }
}
