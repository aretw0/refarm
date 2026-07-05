use anyhow::{anyhow, Context, Result};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;
use std::sync::{Arc, RwLock};
use std::time::Instant;
use tractor::{
    deliver_via_router, AgentChannels, AgentMessage, EventRouter, NativeStorage, NativeSync,
    TelemetryBus,
};

const BASELINE_PATH: &str = "benchmarks/baseline.json";
const CURRENT_PATH: &str = "benchmarks/current.json";
const GHA_PAYLOAD_PATH: &str = "benchmarks/gha-payload.json";
const NODE_COUNT: usize = 500;
const REGRESSION_THRESHOLD_PCT: f64 = 20.0;

// ── dispatch-stress suite ─────────────────────────────────────────────────────
//
// Forces the async-dispatch pain NOW so we feel it and guard against regression:
// N dispatches to ONE plugin serialize on its single runner thread. This suite
// makes the two costs visible SIDE BY SIDE — the enqueue time the router:deliver
// telemetry measures today (near-zero, the "blind sensor") and the DRAIN time,
// the real head-of-line cost that grows as the SUM of per-event work. If the gap
// between them collapses (parallel drain) or the queue stops growing, that is a
// real improvement; if drain latency regresses, the guard catches it.
const DISPATCH_BASELINE_PATH: &str = "benchmarks/baseline-dispatch.json";
const DISPATCH_CURRENT_PATH: &str = "benchmarks/current-dispatch.json";
const DISPATCH_GHA_PAYLOAD_PATH: &str = "benchmarks/gha-payload-dispatch.json";
/// Dispatches fired at one plugin in the burst. Kept modest so the suite runs in
/// the tractor test budget while still exposing serial drain vs instant enqueue.
const DISPATCH_COUNT: usize = 1000;
/// Simulated per-event plugin work (microseconds). The single runner thread pays
/// this SERIALLY per message — the head-of-line cost the suite proves.
const PER_EVENT_WORK_US: u64 = 50;

#[derive(Debug, Clone, Serialize, Deserialize)]
struct BenchReport {
    version: u8,
    suite: String,
    node_count: usize,
    threshold_pct: f64,
    metrics: Vec<BenchMetric>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct BenchMetric {
    name: String,
    value: u128,
    unit: String,
    lower_is_better: bool,
    threshold_pct: f64,
}

#[derive(Debug, Serialize)]
struct GhaPayload {
    improved: bool,
    regressed: bool,
    diff: f64,
    threshold: f64,
    metric: String,
    baseline_total_ns: u128,
    current_total_ns: u128,
}

fn main() -> Result<()> {
    let mode = std::env::args()
        .nth(1)
        .unwrap_or_else(|| "check".to_string());
    match mode.as_str() {
        "save" => {
            let report = run_benchmark()?;
            write_report(BASELINE_PATH, &report)?;
            write_payload(&payload_for_missing_comparison(&report))?;
            println!(
                "[tractor-bench] baseline saved: {} total={}ns nodes={}",
                BASELINE_PATH,
                total_ns(&report)?,
                report.node_count
            );
            Ok(())
        }
        "check" => {
            let baseline = read_report(BASELINE_PATH)?;
            let current = run_benchmark()?;
            write_report(CURRENT_PATH, &current)?;
            let payload = compare(&baseline, &current)?;
            write_payload(&payload)?;

            if payload.regressed {
                Err(anyhow!(
                    "tractor Rust benchmark regressed by {:.2}% (threshold {:.2}%). baseline={}ns current={}ns",
                    payload.diff.abs(),
                    payload.threshold,
                    payload.baseline_total_ns,
                    payload.current_total_ns
                ))
            } else {
                println!(
                    "[tractor-bench] OK diff={:.2}% threshold={:.2}% baseline={}ns current={}ns",
                    payload.diff,
                    payload.threshold,
                    payload.baseline_total_ns,
                    payload.current_total_ns
                );
                Ok(())
            }
        }
        "save-dispatch" => {
            let report = run_dispatch_benchmark()?;
            write_report(DISPATCH_BASELINE_PATH, &report)?;
            write_payload_to(
                DISPATCH_GHA_PAYLOAD_PATH,
                &payload_for_missing_comparison(&report),
            )?;
            let peak = metric_value(&report, "peak_queue_depth")?;
            let ratio = metric_value(&report, "blindness_ratio_drain_over_enqueue")?;
            println!(
                "[tractor-bench] dispatch baseline saved: {} drain={}ns peak_queue={} blindness={}x",
                DISPATCH_BASELINE_PATH,
                total_ns(&report)?,
                peak,
                ratio
            );
            Ok(())
        }
        "check-dispatch" => {
            let baseline = read_report(DISPATCH_BASELINE_PATH)?;
            let current = run_dispatch_benchmark()?;
            write_report(DISPATCH_CURRENT_PATH, &current)?;
            let payload = compare(&baseline, &current)?;
            write_payload_to(DISPATCH_GHA_PAYLOAD_PATH, &payload)?;
            if payload.regressed {
                Err(anyhow!(
                    "tractor dispatch-stress benchmark regressed by {:.2}% (threshold {:.2}%). baseline={}ns current={}ns",
                    payload.diff.abs(),
                    payload.threshold,
                    payload.baseline_total_ns,
                    payload.current_total_ns
                ))
            } else {
                println!(
                    "[tractor-bench] dispatch OK diff={:.2}% threshold={:.2}% baseline={}ns current={}ns",
                    payload.diff, payload.threshold, payload.baseline_total_ns, payload.current_total_ns
                );
                Ok(())
            }
        }
        _ => Err(anyhow!(
            "usage: tractor-bench <save|check|save-dispatch|check-dispatch>"
        )),
    }
}

fn run_benchmark() -> Result<BenchReport> {
    let source = make_sync("tractor-bench-source")?;
    let store_start = Instant::now();
    for i in 0..NODE_COUNT {
        let id = format!("urn:bench:node:{i}");
        let payload = format!(r#"{{"idx":{i},"status":"open","body":"tractor-rust-bench"}}"#);
        source
            .store_node(&id, "BenchTask", None, &payload, Some("tractor-bench"))
            .with_context(|| format!("store_node {id}"))?;
    }
    let store_nodes_ns = store_start.elapsed().as_nanos();

    let export_start = Instant::now();
    let update = source.get_update()?;
    let export_update_ns = export_start.elapsed().as_nanos();

    let target = make_sync("tractor-bench-target")?;
    let apply_start = Instant::now();
    target.apply_update(&update)?;
    let apply_update_ns = apply_start.elapsed().as_nanos();

    let query_start = Instant::now();
    let queried_nodes = target.query_nodes("BenchTask")?.len();
    let query_nodes_ns = query_start.elapsed().as_nanos();

    if queried_nodes != NODE_COUNT {
        return Err(anyhow!(
            "benchmark convergence failed: expected {NODE_COUNT} nodes, got {queried_nodes}"
        ));
    }

    let total_ns = store_nodes_ns + export_update_ns + apply_update_ns + query_nodes_ns;
    Ok(BenchReport {
        version: 1,
        suite: "tractor-native-sync".to_string(),
        node_count: NODE_COUNT,
        threshold_pct: REGRESSION_THRESHOLD_PCT,
        metrics: vec![
            metric("store_nodes", store_nodes_ns, "ns"),
            metric("export_update", export_update_ns, "ns"),
            metric("apply_update", apply_update_ns, "ns"),
            metric("query_nodes", query_nodes_ns, "ns"),
            metric("total", total_ns, "ns"),
            metric("update_bytes", update.len() as u128, "bytes"),
            metric("queried_nodes", queried_nodes as u128, "count"),
        ],
    })
}

fn metric(name: &str, value: u128, unit: &str) -> BenchMetric {
    BenchMetric {
        name: name.to_string(),
        value,
        unit: unit.to_string(),
        lower_is_better: unit != "count",
        threshold_pct: REGRESSION_THRESHOLD_PCT,
    }
}

/// The dispatch-stress suite. Replicates the runtime's single-thread-per-plugin
/// drain (the source of head-of-line blocking) with a mock plugin: one channel
/// registered in agent_channels + subscribed in the router, drained SERIALLY by
/// one task that pays PER_EVENT_WORK_US per message — exactly like the real
/// !Send wasmtime runner thread. Then it fires DISPATCH_COUNT deliveries and
/// measures enqueue vs drain vs peak queue depth.
fn run_dispatch_benchmark() -> Result<BenchReport> {
    let rt = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
        .context("build bench tokio runtime")?;

    rt.block_on(async {
        let router = EventRouter::default();
        let channels: AgentChannels = Arc::new(RwLock::new(std::collections::HashMap::new()));
        let telemetry = TelemetryBus::new(DISPATCH_COUNT + 16);

        // Stand a mock plugin: a channel drained serially by one task, like the
        // real single !Send runner thread. `processed` counts completed work.
        let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<AgentMessage>();
        channels
            .write()
            .expect("channels")
            .insert("bench-plugin".to_string(), tx);
        router.subscribe("bench:dispatch", "bench-plugin");

        let processed = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let peak_depth = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let drain_started = Arc::new(RwLock::new(None::<Instant>));

        let processed_c = processed.clone();
        let peak_c = peak_depth.clone();
        let drain_started_c = drain_started.clone();
        let drainer = tokio::spawn(async move {
            let mut first = true;
            while let Some(_msg) = rx.recv().await {
                if first {
                    *drain_started_c.write().expect("drain start") = Some(Instant::now());
                    first = false;
                }
                // Peak queue depth = messages still buffered behind this one.
                let depth = rx.len();
                let prev = peak_c.load(std::sync::atomic::Ordering::Relaxed);
                if depth > prev {
                    peak_c.store(depth, std::sync::atomic::Ordering::Relaxed);
                }
                // Simulated serial per-event work — the head-of-line cost.
                tokio::time::sleep(std::time::Duration::from_micros(PER_EVENT_WORK_US)).await;
                processed_c.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
            }
        });

        // ENQUEUE: fire all dispatches through the real router path. This is what
        // router:deliver latency measures today — it returns the instant the
        // message is buffered, blind to the drain still to come.
        let enqueue_start = Instant::now();
        for i in 0..DISPATCH_COUNT {
            let sent = deliver_via_router(
                &router,
                &channels,
                &telemetry,
                "bench:dispatch",
                Some("bench-plugin"),
                Some(format!("{{\"i\":{i}}}")),
            );
            debug_assert_eq!(sent, 1);
        }
        let enqueue_ns = enqueue_start.elapsed().as_nanos();

        // DRAIN: wait until the serial drainer has processed every message. This
        // is the REAL cost — roughly DISPATCH_COUNT * PER_EVENT_WORK_US, proving
        // serialization (drain time is the SUM, not the max).
        let drain_wait_start = Instant::now();
        while processed.load(std::sync::atomic::Ordering::Relaxed) < DISPATCH_COUNT {
            tokio::time::sleep(std::time::Duration::from_millis(1)).await;
            if drain_wait_start.elapsed().as_secs() > 60 {
                return Err(anyhow!("dispatch bench drain timed out (a real hang?)"));
            }
        }
        // Drain wall-clock, measured from the first message pulled to the last done.
        let drain_ns = drain_started
            .read()
            .expect("drain start")
            .map(|t| t.elapsed().as_nanos())
            .unwrap_or(0);

        drop(channels); // closes the sender so the drainer task exits
        let _ = drainer.await;

        let peak = peak_depth.load(std::sync::atomic::Ordering::Relaxed);
        // The blindness gap: how many times longer the real drain is than the
        // enqueue the telemetry sees. A big number IS the head-of-line pain.
        let blindness_ratio = if enqueue_ns > 0 {
            (drain_ns / enqueue_ns.max(1)) as u128
        } else {
            0
        };

        Ok(BenchReport {
            version: 1,
            suite: "tractor-dispatch-stress".to_string(),
            node_count: DISPATCH_COUNT,
            threshold_pct: REGRESSION_THRESHOLD_PCT,
            metrics: vec![
                // `total` is the drain time (the real cost) so the guard tracks it.
                metric("total", drain_ns, "ns"),
                metric("enqueue_all", enqueue_ns, "ns"),
                metric("drain_all", drain_ns, "ns"),
                metric("peak_queue_depth", peak as u128, "count"),
                metric("blindness_ratio_drain_over_enqueue", blindness_ratio, "count"),
                metric("dispatched", DISPATCH_COUNT as u128, "count"),
            ],
        })
    })
}

fn make_sync(namespace: &str) -> Result<NativeSync> {
    let storage = NativeStorage::open(":memory:")?;
    NativeSync::new(storage, namespace)
}

fn read_report(path: impl AsRef<Path>) -> Result<BenchReport> {
    let path = path.as_ref();
    let raw = fs::read_to_string(path)
        .with_context(|| format!("read benchmark baseline {}", path.display()))?;
    serde_json::from_str(&raw).with_context(|| format!("parse benchmark report {}", path.display()))
}

fn write_report(path: impl AsRef<Path>, report: &BenchReport) -> Result<()> {
    let path = path.as_ref();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(path, serde_json::to_string_pretty(report)? + "\n")
        .with_context(|| format!("write benchmark report {}", path.display()))
}

fn write_payload(payload: &GhaPayload) -> Result<()> {
    write_payload_to(GHA_PAYLOAD_PATH, payload)
}

fn write_payload_to(path: impl AsRef<Path>, payload: &GhaPayload) -> Result<()> {
    let path = path.as_ref();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(path, serde_json::to_string_pretty(payload)? + "\n")
        .with_context(|| format!("write benchmark payload {}", path.display()))
}

fn payload_for_missing_comparison(report: &BenchReport) -> GhaPayload {
    let total = total_ns(report).unwrap_or(0);
    GhaPayload {
        improved: false,
        regressed: false,
        diff: 0.0,
        threshold: report.threshold_pct,
        metric: "total".to_string(),
        baseline_total_ns: total,
        current_total_ns: total,
    }
}

fn compare(baseline: &BenchReport, current: &BenchReport) -> Result<GhaPayload> {
    if baseline.version != current.version {
        return Err(anyhow!(
            "benchmark report version mismatch: baseline={} current={}",
            baseline.version,
            current.version
        ));
    }
    if baseline.node_count != current.node_count {
        return Err(anyhow!(
            "benchmark node count mismatch: baseline={} current={}",
            baseline.node_count,
            current.node_count
        ));
    }

    let baseline_total_ns = total_ns(baseline)?;
    let current_total_ns = total_ns(current)?;
    let baseline_total = baseline_total_ns as f64;
    let current_total = current_total_ns as f64;
    let diff = ((baseline_total - current_total) / baseline_total) * 100.0;
    let threshold = baseline.threshold_pct;

    Ok(GhaPayload {
        improved: diff > threshold,
        regressed: diff < -threshold,
        diff,
        threshold,
        metric: "total".to_string(),
        baseline_total_ns,
        current_total_ns,
    })
}

fn total_ns(report: &BenchReport) -> Result<u128> {
    metric_value(report, "total")
}

fn metric_value(report: &BenchReport, name: &str) -> Result<u128> {
    report
        .metrics
        .iter()
        .find(|metric| metric.name == name)
        .map(|metric| metric.value)
        .ok_or_else(|| anyhow!("benchmark report missing metric '{name}'"))
}
