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
    ///
    /// The loop drives an ASYNC probe now (the real one spawns a process), so even the
    /// trivial injected probes return a future.
    fn probe_after(fail_times: u32) -> impl FnMut() -> std::future::Ready<bool> + Send {
        let calls = AtomicU32::new(0);
        move || std::future::ready(calls.fetch_add(1, Ordering::SeqCst) >= fail_times)
    }

    /// A probe whose verdict is flipped from outside — used to age a cached `Up` out.
    fn switchable(up: &Arc<std::sync::atomic::AtomicBool>) -> impl FnMut() -> std::future::Ready<bool> + Send {
        let up = up.clone();
        move || std::future::ready(up.load(Ordering::SeqCst))
    }

    #[tokio::test]
    async fn ready_when_the_probe_succeeds() {
        let sync = sync();
        let decl = base(serde_json::json!({}));
        let (mut proc_, _tx, _stop) = holding(&["▶ Conectando…\n"]);
        let mut probe = probe_after(0);
        let mut pubr = ConnectionFramePublisher::new(&sync, "c", 0);
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
        let mut probe = || std::future::ready(false);
        let mut pubr = ConnectionFramePublisher::new(&sync, "c", 0);
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
        let mut pubr = ConnectionFramePublisher::new(&sync, "c", 0);
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

        let mut probe = || std::future::ready(false);
        let mut pubr = ConnectionFramePublisher::new(&sync, "c", 0);
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
        let mut probe = || std::future::ready(false);
        let mut pubr = ConnectionFramePublisher::new(&sync, "c", 0);
        let clk = clock();

        let out = establish(&decl, &mut proc_, &mut probe, &mut pubr, &sync, &clk).await.unwrap();
        assert!(matches!(out, EstablishOutcome::Exit));
    }

    #[tokio::test]
    async fn a_notice_fires_once_per_attempt_not_once_per_matching_chunk() {
        // The name used to say "once per occurrence", which this asserts the opposite of:
        // two genuine occurrences arrive and exactly ONE notice is published. The contract
        // is once per ATTEMPT, and that is deliberate — matching is over the ACCUMULATED
        // buffer, so a pattern that has matched keeps matching on every later chunk;
        // re-arming the flag would announce the same occurrence again on every subsequent
        // line rather than on the next real one. A genuine per-occurrence repeat needs
        // occurrence counting that survives `push_bounded` dropping the buffer's head.
        let sync = sync();
        let decl = base(serde_json::json!({
            "notices": [{ "pattern": "Conectando", "message": "aprove o push" }],
            "readyTimeoutMs": 60
        }));
        let (mut proc_, _tx, _stop) = holding(&["Conectando…\n", "Conectando…\n"]);
        let mut probe = || std::future::ready(false);
        let mut pubr = ConnectionFramePublisher::new(&sync, "c", 0);
        let clk = clock();

        let _ = establish(&decl, &mut proc_, &mut probe, &mut pubr, &sync, &clk).await.unwrap();

        let notices = sync
            .query_nodes("StreamChunk")
            .unwrap_or_default()
            .iter()
            .filter_map(|row| serde_json::from_str::<serde_json::Value>(&row.payload).ok())
            .filter(|n| n["payload_kind"] == "notice")
            .count();
        assert_eq!(notices, 1, "a notice fires once per attempt, not per matching chunk");
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
        let mut probe = || std::future::ready(false);
        let mut pubr = ConnectionFramePublisher::new(&sync, "c", 0);
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
        let mut probe = || std::future::ready(false);
        let mut pubr = ConnectionFramePublisher::new(&sync, "c", 0);
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
        let mut pubr = ConnectionFramePublisher::new(&sync, "c", 0);
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
        let mut probe = || std::future::ready(false); // never succeeds
        let mut pubr = ConnectionFramePublisher::new(&sync, "c", 0);
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
        let mut pubr = ConnectionFramePublisher::new(&sync, "c", 0);
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

        // The second caller DOES probe — a cached `Up` is re-verified against the system
        // before a claim is issued on it (nothing supervises a tunnel that drops). What it
        // must never do is SPAWN: a second spawn is a second login, i.e. a second push on
        // the operator's phone. That is the guarantee under test.
        let mut p2 = probe_after(0);
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
        let mut p2 = || std::future::ready(true);
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
        let mut p2 = || std::future::ready(true);
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
        let mut probe = || std::future::ready(false);

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

    // ── ConnectionRegistry::stop — the explicit OPERATOR stop ─────────────────────
    //
    // NOT `release`/`release_by_id`: those drop one caller's interest and defer to
    // `linger`. `stop` is the operator overriding that policy outright — see the
    // method's own doc for why it must report the claim count rather than hide it.

    #[tokio::test]
    async fn stop_with_claims_outstanding_reports_the_count_and_takes_it_down() {
        let sync = sync();
        let decls = catalog();
        let reg = ConnectionRegistry::new();
        let clk = clock();
        let mut p1 = probe_after(0);
        let _a = reg.ensure("c", "plugin.a", &decls, holding_spawner(), &mut p1, &sync, &clk).await.unwrap();
        let mut p2 = || std::future::ready(true);
        let _b = reg
            .ensure("c", "plugin.b", &decls, |_| panic!("no second spawn"), &mut p2, &sync, &clk)
            .await
            .unwrap();
        assert_eq!(reg.claim_count("c"), 2, "sanity: two claims outstanding before stop");

        // The operator is SOVEREIGN here — stop works even with claims outstanding — but
        // D12 says it must REPORT how many were active rather than swallow the count.
        let active = reg.stop("c");
        assert_eq!(active, 2, "both outstanding claims must be reported");
        assert!(matches!(reg.status("c"), ConnectionStatus::Down));
        assert_eq!(reg.claim_count("c"), 0, "claims are CLEARED, not merely counted");
    }

    #[tokio::test]
    async fn stop_on_an_already_down_connection_is_a_clean_no_op() {
        let reg = ConnectionRegistry::new();

        // Never established at all — no live entry exists for this name.
        assert_eq!(reg.stop("never-touched"), 0);
        assert!(matches!(reg.status("never-touched"), ConnectionStatus::Down));

        // Established, then genuinely brought Down via a zero-idle linger releasing the
        // last claim — a live entry exists, already Down, already claimless.
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
        let clk = clock();
        let mut probe = probe_after(0);
        let a = reg.ensure("c", "plugin.a", &decls, holding_spawner(), &mut probe, &sync, &clk).await.unwrap();
        reg.release(&a);
        assert!(matches!(reg.status("c"), ConnectionStatus::Down), "sanity: released down via idle linger");

        assert_eq!(reg.stop("c"), 0, "stop on an already-down connection is idempotent");
        assert!(matches!(reg.status("c"), ConnectionStatus::Down));
    }

    #[tokio::test]
    async fn stop_signals_the_live_process_not_just_the_status() {
        let sync = sync();
        let decls = catalog();
        let reg = ConnectionRegistry::new();
        let clk = clock();
        let mut probe = probe_after(0);

        // A spawner that keeps an external handle to the SAME stop `Notify` the registry
        // will end up holding — `holding_spawner()` (used by every other test in this
        // file) discards its own `Notify`, so it can't be watched from outside.
        let stop_handle = Arc::new(Notify::new());
        let spawner_stop = stop_handle.clone();
        let spawn = move |_decl: &ConnectionDeclaration| {
            let (tx, rx) = mpsc::channel(8);
            std::mem::forget(tx); // the process "holds" — never ends on its own
            Ok(FlowProcess { chunks: rx, stop: spawner_stop.clone() })
        };

        let _claim = reg.ensure("c", "plugin.a", &decls, spawn, &mut probe, &sync, &clk).await.unwrap();
        assert!(matches!(reg.status("c"), ConnectionStatus::Up));

        let observed = Arc::new(std::sync::atomic::AtomicBool::new(false));
        let watcher = {
            let stop_handle = stop_handle.clone();
            let observed = observed.clone();
            tokio::spawn(async move {
                stop_handle.notified().await;
                observed.store(true, Ordering::SeqCst);
            })
        };
        tokio::task::yield_now().await;

        assert_eq!(reg.stop("c"), 1);
        assert!(matches!(reg.status("c"), ConnectionStatus::Down));

        tokio::time::sleep(std::time::Duration::from_millis(20)).await;
        assert!(
            observed.load(Ordering::SeqCst),
            "stop must SIGNAL the live process, not just flip the status — a failure to \
             signal here would leak the connection's process the same way a failed \
             establish attempt would if it forgot to (see `mark_failed`'s own doc)"
        );
        watcher.abort();
    }

    #[tokio::test]
    async fn an_operator_stop_during_an_in_flight_establish_is_never_silently_undone() {
        // IMPORTANT regression: `stop` locks only `live` — it does NOT take the
        // per-name establish gate `ensure` holds across its whole spawn/probe await
        // (deliberately: `stop` is a fast, synchronous operator override, and blocking
        // it behind an in-flight establish for up to `ready_timeout_ms` — 120s by
        // default, for a VPN waiting on a phone approval — would be its own defect).
        // Before the generation check in `ensure` existed, a `stop()` landing while an
        // `establish` was still awaiting the probe flipped `status` to `Down`, and then
        // the in-flight `ensure` finished anyway and UNCONDITIONALLY overwrote it back
        // to `Up`, handing out a claim — silently undoing the operator's sovereign
        // drop. Realistic case: a plugin reconnecting right as the operator says stop.
        let sync = sync();
        // A generous readyTimeoutMs so a slow CI host can never turn this into a
        // Timeout race instead of the Ready race under test; a small probeIntervalMs so
        // the whole test still finishes quickly.
        let decls = parse_connections(&serde_json::json!({
            "connections": { "c": {
                "establish": ["bin"],
                "probe": { "run": ["true"] },
                "probeIntervalMs": 2,
                "readyTimeoutMs": 5000
            }}
        }))
        .unwrap();
        let reg = ConnectionRegistry::new();
        let clk = clock();

        // A spawner that keeps an external handle to the SAME stop `Notify` the
        // registry will end up holding — same technique as
        // `stop_signals_the_live_process_not_just_the_status` above.
        let stop_handle = Arc::new(Notify::new());
        let spawner_stop = stop_handle.clone();
        let spawn = move |_decl: &ConnectionDeclaration| {
            let (tx, rx) = mpsc::channel(8);
            std::mem::forget(tx); // the process "holds" — never ends on its own
            Ok(FlowProcess { chunks: rx, stop: spawner_stop.clone() })
        };

        let observed_stop = Arc::new(std::sync::atomic::AtomicBool::new(false));
        let watcher = {
            let stop_handle = stop_handle.clone();
            let observed_stop = observed_stop.clone();
            tokio::spawn(async move {
                stop_handle.notified().await;
                observed_stop.store(true, Ordering::SeqCst);
            })
        };
        tokio::task::yield_now().await;

        // Fails 30 times before succeeding — ~60ms of real probeIntervalMs waits at
        // 2ms/iteration, which is the window `stop_fut` (below) races into.
        let mut probe = probe_after(30);

        let ensure_fut = reg.ensure("c", "plugin.a", &decls, spawn, &mut probe, &sync, &clk);
        let stop_fut = async {
            // Let `ensure` pass Connecting and start awaiting the probe loop — well
            // before the ~60ms it takes the probe to succeed — then stop it mid-flight.
            tokio::time::sleep(std::time::Duration::from_millis(10)).await;
            reg.stop("c")
        };

        let (result, active_claims_at_stop) = tokio::join!(ensure_fut, stop_fut);

        assert!(
            result.is_err(),
            "an ensure preempted by an operator stop must not hand out a claim"
        );
        assert_eq!(
            active_claims_at_stop, 0,
            "sanity: no claim existed yet at the moment of the stop"
        );
        assert!(
            matches!(reg.status("c"), ConnectionStatus::Down),
            "the operator's stop must win — the connection must not resurrect as Up \
             (or get overwritten to Failed) once the in-flight establish finishes"
        );
        assert_eq!(reg.claim_count("c"), 0);

        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        assert!(
            observed_stop.load(Ordering::SeqCst),
            "the process that DID come up must still be killed once nothing owns it — \
             an operator stop must never leak the process it preempted"
        );
        watcher.abort();
    }

    #[tokio::test]
    async fn stop_recovers_an_entry_wedged_at_connecting_by_a_dropped_establish_future() {
        // Newly-introduced-by-the-fix-above regression (caught in re-review): the
        // previous test proves `stop` beats an `ensure` that is still ALIVE and
        // running. It says nothing about an `ensure` whose future is simply GONE —
        // which is exactly what happens in production: `post_connection_up`
        // (`sidecar/mod.rs`) awaits `ensure` inline inside an axum handler, and axum
        // DROPS a handler's future outright when the HTTP client disconnects (e.g.
        // this CLI's own request hitting ITS OWN timeout while the host is still
        // establishing). A dropped future runs no more of its own code, ever — no
        // `mark_failed`, no commit block, nothing settles the entry.
        //
        // `tokio::time::timeout` dropping its inner future on elapse is the same
        // shape (a future that stops being polled mid-`.await`), and is the standard
        // way to exercise this without standing up axum. Before `entry.stop` was
        // populated as soon as a process exists (rather than only once `establish`
        // reaches `Ready`), this scenario left the entry stuck reporting `Connecting`
        // forever, with the spawned process reachable by NOTHING — not even `stop`.
        let sync = sync();
        let decls = catalog(); // probeIntervalMs: 1, readyTimeoutMs: 200
        let reg = ConnectionRegistry::new();
        let clk = clock();

        let stop_handle = Arc::new(Notify::new());
        let spawner_stop = stop_handle.clone();
        let spawn = move |_decl: &ConnectionDeclaration| {
            let (tx, rx) = mpsc::channel(8);
            std::mem::forget(tx); // the process "holds" — never ends on its own
            Ok(FlowProcess { chunks: rx, stop: spawner_stop.clone() })
        };

        let observed_stop = Arc::new(std::sync::atomic::AtomicBool::new(false));
        let watcher = {
            let stop_handle = stop_handle.clone();
            let observed_stop = observed_stop.clone();
            tokio::spawn(async move {
                stop_handle.notified().await;
                observed_stop.store(true, Ordering::SeqCst);
            })
        };
        tokio::task::yield_now().await;

        // Never succeeds, so `establish` is still inside its probe-loop `.await` when
        // the 10ms deadline below elapses and drops this `ensure` call outright.
        let mut probe = || std::future::ready(false);

        let ensure_result = tokio::time::timeout(
            std::time::Duration::from_millis(10),
            reg.ensure("c", "plugin.a", &decls, spawn, &mut probe, &sync, &clk),
        )
        .await;
        assert!(
            ensure_result.is_err(),
            "sanity: the ensure future must have been dropped mid-flight (Elapsed), \
             not completed — otherwise this test is not exercising the wedge at all"
        );

        // Confirm the wedge exists BEFORE calling `stop`: nothing inside `ensure` ran
        // again to settle it, so it must still read `Connecting`.
        assert!(
            matches!(reg.status("c"), ConnectionStatus::Connecting),
            "sanity: the entry must be wedged at Connecting — the dropped `ensure` \
             future never reached its own cleanup"
        );

        let active_claims = reg.stop("c");
        assert_eq!(active_claims, 0, "no claim was ever issued to this wedged attempt");
        assert!(
            matches!(reg.status("c"), ConnectionStatus::Down),
            "stop must be able to un-wedge a Connecting entry all the way to Down, \
             not just no-op over a status it doesn't recognise"
        );

        tokio::time::sleep(std::time::Duration::from_millis(20)).await;
        assert!(
            observed_stop.load(Ordering::SeqCst),
            "stop must still reach and signal the orphaned process — an entry wedged \
             by a dropped future must not leak the process it was holding"
        );
        watcher.abort();
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

    // ── Fix round 1: an unkillable orphan on the publisher-error paths ──────────────────
    //
    // `establish`'s early `?` returns (via `publisher.notice` / `publisher.terminal`) used
    // to skip the final "stop unless Ready" step entirely. With Tasks 3-4's fake
    // channel-backed processes that was invisible; with Task 5's REAL subprocess it is a
    // genuinely unkillable orphan holding a real OS resource. `NativeStorage` is `Clone`
    // (it shares one `Arc<Mutex<Connection>>`), so a cloned handle can drop the `nodes`
    // table out from under a live `NativeSync` and force a REAL `store_node` failure —
    // no need to fake or skip the failure per the brief's fallback.

    /// A `NativeSync` whose every `store_node` call fails — used to force a genuine
    /// publisher error instead of asserting only the `mark_failed` half.
    fn sync_with_broken_storage() -> NativeSync {
        let storage = NativeStorage::open(":memory:").unwrap();
        let broken = storage.clone();
        let sync = NativeSync::new(storage, ":memory:").unwrap();
        broken.execute("DROP TABLE nodes", &[]).unwrap();
        sync
    }

    #[tokio::test]
    async fn a_publisher_failure_while_publishing_a_notice_still_stops_the_process() {
        // Exercises the `publisher.notice(...)?` early return inside the drain loop.
        let sync = sync_with_broken_storage();
        let decl = base(serde_json::json!({
            "notices": [{ "pattern": "Conectando", "message": "aprove o push" }],
            "readyTimeoutMs": 200
        }));
        let (mut proc_, _tx, stop) = holding(&["Conectando…\n"]);
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

        let mut probe = || std::future::ready(false); // never succeeds — the notice must be reached first
        let mut pubr = ConnectionFramePublisher::new(&sync, "c", 0);
        let clk = clock();

        let err = tokio::time::timeout(
            std::time::Duration::from_secs(5),
            establish(&decl, &mut proc_, &mut probe, &mut pubr, &sync, &clk),
        )
        .await
        .expect("establish must not hang")
        .unwrap_err();
        assert!(err.contains("store connection chunk"), "unexpected error: {err}");

        tokio::time::sleep(std::time::Duration::from_millis(20)).await;
        assert!(
            observed.load(Ordering::SeqCst),
            "a publisher failure while publishing a notice must still stop the process — no orphan"
        );
        watcher.abort();
    }

    #[tokio::test]
    async fn a_publisher_failure_while_publishing_the_terminal_frame_still_stops_the_process() {
        // Exercises the `publisher.terminal(...)?` return AFTER the loop, on the Ready
        // path specifically: Ready normally LEAVES the process running, but a terminal-
        // publish failure still makes `establish` return `Err`, and the caller (`ensure`)
        // treats any `Err` as a failed attempt and disowns the process — so it must be
        // stopped here too, or it strands with nothing left able to signal it.
        let sync = sync_with_broken_storage();
        let decl = base(serde_json::json!({}));
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

        let mut probe = probe_after(0); // Ready on the very first probe
        let mut pubr = ConnectionFramePublisher::new(&sync, "c", 0);
        let clk = clock();

        let err = tokio::time::timeout(
            std::time::Duration::from_secs(5),
            establish(&decl, &mut proc_, &mut probe, &mut pubr, &sync, &clk),
        )
        .await
        .expect("establish must not hang")
        .unwrap_err();
        assert!(err.contains("store connection"), "unexpected error: {err}");

        tokio::time::sleep(std::time::Duration::from_millis(20)).await;
        assert!(
            observed.load(Ordering::SeqCst),
            "a publisher failure on the Ready path must still stop the process — the caller \
             treats any Err from establish as failed and disowns it regardless of outcome"
        );
        watcher.abort();
    }

    #[tokio::test]
    async fn mark_failed_stops_a_process_it_disowns() {
        // Direct coverage of the `mark_failed` half of the fix: a route that reaches
        // `mark_failed` with a live `stop` handle ALREADY stashed in the registry entry
        // (which the two current call sites in `ensure` never do — `entry.stop` is only
        // populated on `Ready`) must still notify it before clearing, so any future or
        // indirect caller can never silently drop a live process.
        let sync = sync();
        let decls = catalog();
        let reg = ConnectionRegistry::new();
        let clk = clock();
        let mut probe = probe_after(0);

        let stop = Arc::new(Notify::new());
        let stop_for_process = stop.clone();
        let spawner = move |_decl: &ConnectionDeclaration| {
            let (tx, rx) = mpsc::channel::<String>(8);
            std::mem::forget(tx); // stays open — a held connection
            Ok(FlowProcess { chunks: rx, stop: stop_for_process })
        };

        let claim = reg
            .ensure("c", "plugin.a", &decls, spawner, &mut probe, &sync, &clk)
            .await
            .unwrap();
        assert!(matches!(reg.status("c"), ConnectionStatus::Up), "must be Up with entry.stop stashed");

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

        reg.mark_failed("c");

        tokio::time::sleep(std::time::Duration::from_millis(20)).await;
        assert!(
            observed.load(Ordering::SeqCst),
            "mark_failed must stop any process it disowns, from any route"
        );
        assert!(matches!(reg.status("c"), ConnectionStatus::Failed));
        drop(claim);
        watcher.abort();
    }

    // ── Fix round 1: a multi-byte character split across two reads ──────────────────────

    #[test]
    fn split_utf8_prefix_carries_a_split_multibyte_character_across_two_reads() {
        // "📲" (U+1F4F2) is 4 bytes in UTF-8. Simulate the OS splitting the read after the
        // first 2 bytes — exactly the boundary hazard a chatty login process can hit when
        // its output is Portuguese with accents and emoji.
        let phone = "📲".as_bytes();
        assert_eq!(phone.len(), 4);

        let (text1, leftover) = split_utf8_prefix(phone[..2].to_vec());
        assert_eq!(text1, "", "an incomplete lead byte must not be corrupted into a replacement char");
        assert_eq!(leftover, phone[..2].to_vec());

        let mut second_read = leftover;
        second_read.extend_from_slice(&phone[2..]);
        second_read.extend_from_slice(" Aprove a conexão".as_bytes());
        let (text2, leftover2) = split_utf8_prefix(second_read);
        assert_eq!(text2, "📲 Aprove a conexão");
        assert!(leftover2.is_empty());
    }

    #[test]
    fn split_utf8_prefix_flushes_genuinely_invalid_bytes_instead_of_waiting_forever() {
        // A truncated tail (error_len() == None) is held back; but a genuinely invalid
        // byte (error_len() == Some(_)) would never become valid no matter how many more
        // bytes arrive, so it must be flushed immediately rather than buffered forever.
        let mut bytes = b"ok ".to_vec();
        bytes.push(0xFF); // not a valid UTF-8 lead byte anywhere
        bytes.extend_from_slice(b" more");

        let (text, leftover) = split_utf8_prefix(bytes);
        assert!(leftover.is_empty(), "genuinely invalid bytes must not be held back");
        assert!(text.starts_with("ok "));
        assert!(text.ends_with(" more"));
    }

    // ── Fix round 2: the two halves of the engine must actually compose ─────────────────
    //
    // `establish`/`ensure` used to take a SYNCHRONOUS probe while the real probe
    // (`run_probe`) is `async`. Nothing bridged them: the loop was only ever driven by
    // test closures, and `run_probe` was only ever called on its own. The design's central
    // mechanism — "readiness is decided by a probe that asks the system" — had never run
    // end to end. These two tests wire the REAL probe into the REAL registry against a
    // REAL establish process, and make the probe's verdict decide the outcome.

    /// Hermetic binaries with fixed exit codes: `/usr/bin/true` is a probe that always says
    /// "up", `/usr/bin/false` one that never does. Both are already used by this suite.
    fn real_connection(probe_binary: &str, ready_timeout_ms: u32) -> ConnectionDeclaration {
        base(serde_json::json!({
            // A process that HOLDS (a tunnel) and prints nothing at all — so readiness can
            // only have come from the probe, never from output.
            "establish": ["/usr/bin/sleep", "30"],
            "probe": { "run": [probe_binary] },
            "probeIntervalMs": 20,
            "readyTimeoutMs": ready_timeout_ms
        }))
    }

    fn catalog_of(decl: &ConnectionDeclaration) -> std::collections::HashMap<String, ConnectionDeclaration> {
        std::collections::HashMap::from([("c".to_string(), decl.clone())])
    }

    /// Give the killer task spawned inside `spawn_establish_process` a chance to run before
    /// the test's runtime is dropped. `ensure` owns and drops the `FlowProcess` internally,
    /// so a test cannot observe the child's death here the way the two dedicated
    /// process-death tests do — but leaving a real `sleep` behind would be a genuine leak,
    /// and one that looks exactly like the orphan bug this suite exists to catch.
    async fn reap_stopped_children() {
        tokio::time::sleep(std::time::Duration::from_millis(300)).await;
    }

    #[tokio::test]
    async fn the_real_probe_drives_the_real_registry_to_up() {
        let sync = sync();
        let policy = permissive_policy();
        let decl = real_connection("/usr/bin/true", 3_000);
        let decls = catalog_of(&decl);
        let reg = ConnectionRegistry::new();
        let clk = clock();

        // THE composition: the async `run_probe` — which spawns a process and awaits it —
        // driven by `ensure`'s loop. A synchronous probe signature could not express this
        // without `block_on`, which panics on a current-thread runtime.
        let probe_decl = decl.clone();
        let mut probe = || run_probe(&probe_decl, &policy);

        let claim = tokio::time::timeout(
            std::time::Duration::from_secs(20),
            reg.ensure("c", "plugin.a", &decls, |d| spawn_establish_process(d, &policy), &mut probe, &sync, &clk),
        )
        .await
        .expect("ensure must not hang")
        .expect("the probe says up, so the connection must come up");

        assert_eq!(claim.name, "c");
        assert!(matches!(reg.status("c"), ConnectionStatus::Up));
        assert_eq!(reg.spawn_count("c"), 1);

        // The session belongs to a LIVE connection, so it must not be terminal — otherwise
        // node_reap sweeps it and its resume cursor out from under the tunnel.
        let raw = sync.get_node(&connection_stream_ref("c")).unwrap().unwrap();
        let node: serde_json::Value = serde_json::from_str(&raw).unwrap();
        assert_eq!(node["status"], "active");

        // Do not leave a real `sleep 30` behind: `mark_failed` is the route that stops it,
        // but the killer task needs ONE scheduling opportunity before this test's runtime is
        // torn down — a dropped runtime drops pending tasks unpolled, and tokio's `Child`
        // does not kill on drop.
        reg.mark_failed("c");
        reap_stopped_children().await;
    }

    #[tokio::test]
    async fn the_real_probe_refusing_keeps_the_real_registry_from_coming_up() {
        // Same real process, same real code path — only the probe's verdict differs. That
        // is what makes the previous test a proof and not a coincidence.
        let sync = sync();
        let policy = permissive_policy();
        let decl = real_connection("/usr/bin/false", 400);
        let decls = catalog_of(&decl);
        let reg = ConnectionRegistry::new();
        let clk = clock();

        let probe_decl = decl.clone();
        let mut probe = || run_probe(&probe_decl, &policy);

        let err = tokio::time::timeout(
            std::time::Duration::from_secs(20),
            reg.ensure("c", "plugin.a", &decls, |d| spawn_establish_process(d, &policy), &mut probe, &sync, &clk),
        )
        .await
        .expect("ensure must not hang")
        .expect_err("the probe never says up, so the connection must never be considered up");

        assert!(err.contains("did not become ready"), "unexpected: {err}");
        assert!(matches!(reg.status("c"), ConnectionStatus::Failed));
        assert_eq!(reg.claim_count("c"), 0);
        reap_stopped_children().await;
    }

    // ── Fix round 2: a stop signalled before the killer task polls must still kill ──────

    #[tokio::test]
    async fn a_stop_signalled_with_no_intervening_await_still_kills_the_real_process() {
        // `spawn_establish_process` registers its killer inside a `tokio::spawn`, so the
        // task has not been polled when it returns. `notify_waiters` stores NO permit: on
        // the fast failure paths — where nothing yields between the spawn returning and the
        // first stop — the signal was dropped on the floor and the SIGKILL never fired,
        // leaving a live VPN process nothing could signal. `notify_one` stores a permit, so
        // the late-registering killer still wakes.
        let decl = base(serde_json::json!({ "establish": ["/usr/bin/sleep", "300"] }));
        let mut process = spawn_establish_process(&decl, &permissive_policy()).unwrap();

        signal_stop(&process.stop); // no `.await` between the spawn and this line

        // Liveness observed the way `FlowProcess` itself defines it: the chunk channel
        // closes only when both pipes reach EOF, which for `sleep` happens only when the
        // process dies. `sleep 300` would hold its stdout open for five minutes.
        let ended = tokio::time::timeout(std::time::Duration::from_secs(15), process.chunks.recv())
            .await
            .expect("the child must die, not outlive a stop signalled before the killer polled");
        assert_eq!(ended, None, "the establish process must be gone");
    }

    #[tokio::test]
    async fn a_publisher_failure_on_the_ready_path_kills_the_real_child_it_spawned() {
        // The same lost wakeup on a REAL code path, with a REAL child. `probe_after(0)`
        // returns `std::future::Ready`, which completes without ever yielding to the
        // executor, so from `spawn_establish_process` returning to `establish`'s
        // `signal_stop` on the terminal-publish failure there is no scheduling point at
        // all — the killer task has still never been polled.
        let sync = sync_with_broken_storage();
        let decl = base(serde_json::json!({ "establish": ["/usr/bin/sleep", "300"] }));
        let mut process = spawn_establish_process(&decl, &permissive_policy()).unwrap();
        let mut probe = probe_after(0);
        let mut pubr = ConnectionFramePublisher::new(&sync, "c", 0);
        let clk = clock();

        let err = establish(&decl, &mut process, &mut probe, &mut pubr, &sync, &clk)
            .await
            .unwrap_err();
        assert!(err.contains("store connection"), "unexpected: {err}");

        let ended = tokio::time::timeout(std::time::Duration::from_secs(15), process.chunks.recv())
            .await
            .expect("a publisher failure must not strand a live child");
        assert_eq!(ended, None, "the establish process must be gone");
    }

    // ── Fix round 2: a cached `Up` is a memory, not a measurement ───────────────────────

    #[tokio::test]
    async fn a_stale_up_is_re_probed_before_a_claim_is_issued_on_it() {
        // Nothing supervises a live connection yet, so `status()` reported `Up` forever
        // once it had been up once — and `ensure`'s fast path handed out claims on a dead
        // tunnel. The fast path must ASK the system again, not trust the cached boolean.
        let sync = sync();
        let decls = catalog();
        let reg = ConnectionRegistry::new();
        let clk = clock();
        let up = Arc::new(std::sync::atomic::AtomicBool::new(true));
        let mut probe = switchable(&up);

        let _a = reg
            .ensure("c", "plugin.a", &decls, holding_spawner(), &mut probe, &sync, &clk)
            .await
            .unwrap();
        assert!(matches!(reg.status("c"), ConnectionStatus::Up));
        assert_eq!(reg.claim_count("c"), 1);

        // The tunnel drops. Nothing tells the registry; only the probe can notice.
        up.store(false, Ordering::SeqCst);

        let err = reg
            .ensure("c", "plugin.b", &decls, holding_spawner(), &mut probe, &sync, &clk)
            .await
            .unwrap_err();

        assert!(
            err.contains("did not become ready"),
            "a stale `Up` must fall through to a fresh establish, not short-circuit: {err}"
        );
        assert!(
            !matches!(reg.status("c"), ConnectionStatus::Up),
            "a connection the probe says is down must not still report Up"
        );
        assert_eq!(
            reg.claim_count("c"),
            1,
            "no NEW claim may be issued on a connection the probe says is down"
        );
        assert_eq!(reg.spawn_count("c"), 2, "the stale entry must be re-established, not reused");
    }

    #[tokio::test]
    async fn a_still_healthy_up_is_shared_without_a_second_spawn() {
        // The other half: re-probing must not cost a second login. A probe that still says
        // "up" shares the existing connection exactly as before.
        let sync = sync();
        let decls = catalog();
        let reg = ConnectionRegistry::new();
        let clk = clock();
        let up = Arc::new(std::sync::atomic::AtomicBool::new(true));
        let mut probe = switchable(&up);

        let _a = reg.ensure("c", "plugin.a", &decls, holding_spawner(), &mut probe, &sync, &clk).await.unwrap();
        let b = reg
            .ensure("c", "plugin.b", &decls, |_| panic!("re-probing must not cause a second login"), &mut probe, &sync, &clk)
            .await
            .unwrap();

        assert_eq!(b.name, "c");
        assert_eq!(reg.spawn_count("c"), 1);
        assert_eq!(reg.claim_count("c"), 2);
    }
}
