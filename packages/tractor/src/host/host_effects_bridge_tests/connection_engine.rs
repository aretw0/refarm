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
}
