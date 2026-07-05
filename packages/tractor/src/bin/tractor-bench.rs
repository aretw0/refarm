use anyhow::{anyhow, Context, Result};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;
use std::sync::{Arc, RwLock};
use std::time::Instant;
use tractor::{
    deliver_via_router, host::PluginHost, trust::TrustManager, PluginChannels, EventEnvelope,
    EventRouter, NativeStorage, NativeSync, TelemetryBus,
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
/// Worker count for the pooled-drain variant. Models the opt-in per-plugin pool
/// (N stores, one per worker thread) that parallelizes the drain. Kept at 4 to
/// match the repo's §7 build.jobs=4 / 8GB posture — the pool size a bounded
/// wasmtime pooling allocator would use on this host.
const DISPATCH_POOL_WORKERS: usize = 4;

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
        "instantiation" => {
            let report = run_instantiation_benchmark()?;
            let total = total_ns(&report)?;
            let per = metric_value(&report, "per_instance")?;
            println!(
                "[tractor-bench] instantiation: {} instances loaded in {}ns total, {}ns/instance",
                INSTANTIATION_COUNT, total, per
            );
            Ok(())
        }
        _ => Err(anyhow!(
            "usage: tractor-bench <save|check|save-dispatch|check-dispatch|instantiation>"
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
/// registered in plugin_channels + subscribed in the router, drained SERIALLY by
/// one task that pays PER_EVENT_WORK_US per message — exactly like the real
/// !Send wasmtime runner thread. Then it fires DISPATCH_COUNT deliveries and
/// measures enqueue vs drain vs peak queue depth.
fn run_dispatch_benchmark() -> Result<BenchReport> {
    // worker_count = 1 is the serial baseline (one !Send runner thread — the real
    // pain). worker_count = N models the opt-in pool: N workers drain the same
    // queue concurrently, so drain time collapses toward SUM/N and the blindness
    // ratio drops. Both run so the report can prove the win in one shot.
    let serial = run_dispatch_drain(1)?;
    let pooled = run_dispatch_drain(DISPATCH_POOL_WORKERS)?;

    // Speedup = serial drain / pooled drain. With N workers over CPU-bound-ish
    // sleeps it should approach N (bounded by the runtime's worker threads).
    let speedup_x100 = if pooled.drain_ns > 0 {
        (serial.drain_ns * 100 / pooled.drain_ns) as u128
    } else {
        0
    };

    Ok(BenchReport {
        version: 1,
        suite: "tractor-dispatch-stress".to_string(),
        node_count: DISPATCH_COUNT,
        threshold_pct: REGRESSION_THRESHOLD_PCT,
        metrics: vec![
            // `total` stays the SERIAL drain so the existing baseline/guard tracks
            // the same number as before this parallel variant landed.
            metric("total", serial.drain_ns, "ns"),
            metric("enqueue_all", serial.enqueue_ns, "ns"),
            metric("drain_all", serial.drain_ns, "ns"),
            metric("peak_queue_depth", serial.peak as u128, "count"),
            metric(
                "blindness_ratio_drain_over_enqueue",
                serial.blindness_ratio,
                "count",
            ),
            metric("dispatched", DISPATCH_COUNT as u128, "count"),
            // The parallel-drain proof: pooled drain time, its blindness ratio,
            // and the speedup over serial. The pooled numbers should be far lower.
            metric("pooled_workers", DISPATCH_POOL_WORKERS as u128, "count"),
            metric("pooled_drain_all", pooled.drain_ns, "ns"),
            metric(
                "pooled_blindness_ratio",
                pooled.blindness_ratio,
                "count",
            ),
            metric("pooled_speedup_x100", speedup_x100, "count"),
        ],
    })
}

/// The outcome of one drain run at a given worker count.
struct DrainRun {
    enqueue_ns: u128,
    drain_ns: u128,
    peak: usize,
    blindness_ratio: u128,
}

/// Fire DISPATCH_COUNT deliveries through the real router path, drained by
/// `worker_count` concurrent workers over a shared queue, each paying
/// PER_EVENT_WORK_US per message. worker_count=1 reproduces the serial !Send
/// runner; worker_count=N models the opt-in pool.
fn run_dispatch_drain(worker_count: usize) -> Result<DrainRun> {
    let rt = tokio::runtime::Builder::new_multi_thread()
        .worker_threads(worker_count.max(1) + 1)
        .enable_all()
        .build()
        .context("build bench tokio runtime")?;

    rt.block_on(async move {
        let router = EventRouter::default();
        let channels: PluginChannels = Arc::new(RwLock::new(std::collections::HashMap::new()));
        let telemetry = TelemetryBus::new(DISPATCH_COUNT + 16);

        let (tx, rx) = tokio::sync::mpsc::unbounded_channel::<EventEnvelope>();
        channels
            .write()
            .expect("channels")
            .insert("bench-plugin".to_string(), tx);
        router.subscribe("bench:dispatch", "bench-plugin");

        let processed = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let peak_depth = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let drain_started = Arc::new(RwLock::new(None::<Instant>));

        // N workers share the one receiver via a Mutex: each takes a message and
        // runs its per-event work concurrently with the others (models N stores,
        // one per worker thread, draining the same plugin queue).
        let shared_rx = Arc::new(tokio::sync::Mutex::new(rx));
        let mut workers = Vec::with_capacity(worker_count);
        for _ in 0..worker_count.max(1) {
            let shared_rx = shared_rx.clone();
            let processed_c = processed.clone();
            let peak_c = peak_depth.clone();
            let drain_started_c = drain_started.clone();
            workers.push(tokio::spawn(async move {
                loop {
                    let msg = {
                        let mut rx = shared_rx.lock().await;
                        // Peak depth = messages buffered behind the one we take.
                        let depth = rx.len();
                        let prev = peak_c.load(std::sync::atomic::Ordering::Relaxed);
                        if depth > prev {
                            peak_c.store(depth, std::sync::atomic::Ordering::Relaxed);
                        }
                        rx.recv().await
                    };
                    let Some(_msg) = msg else { break };
                    {
                        let mut start = drain_started_c.write().expect("drain start");
                        if start.is_none() {
                            *start = Some(Instant::now());
                        }
                    }
                    tokio::time::sleep(std::time::Duration::from_micros(PER_EVENT_WORK_US)).await;
                    processed_c.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
                }
            }));
        }
        let drainer = async move {
            for w in workers {
                let _ = w.await;
            }
        };
        let drainer = tokio::spawn(drainer);

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

        drop(channels); // closes the sender so the worker tasks exit
        let _ = drainer.await;

        let peak = peak_depth.load(std::sync::atomic::Ordering::Relaxed);
        // The blindness gap: how many times longer the real drain is than the
        // enqueue the telemetry sees. A big number IS the head-of-line pain.
        let blindness_ratio = if enqueue_ns > 0 {
            (drain_ns / enqueue_ns.max(1)) as u128
        } else {
            0
        };

        Ok(DrainRun {
            enqueue_ns,
            drain_ns,
            peak,
            blindness_ratio,
        })
    })
}

/// How many instances to load when measuring the store-pool instantiation cost.
/// Matches the pool-size cap so the number reflects a realistic per-plugin pool.
const INSTANTIATION_COUNT: usize = 8;

/// Measure the cost of instantiating N stores of the same plugin — the price the
/// pooled runner pays ONCE at boot to stand up its N-store pool. This is the
/// suite that lets us feel the real pain before deciding whether the wasmtime
/// pooling allocator (which trades a fresh mmap per load for a cheap madvise
/// reset) is worth its bound-the-memory risk on the 8GB host. If per-instance
/// load is already cheap, the on-demand allocator is fine and the pool's win
/// (proven separately in dispatch-stress) needs no allocator change.
fn run_instantiation_benchmark() -> Result<BenchReport> {
    let rt = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .context("build bench tokio runtime")?;

    rt.block_on(async {
        let fixture = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/null-plugin.wasm");
        if !fixture.exists() {
            return Err(anyhow!(
                "instantiation bench needs tests/fixtures/null-plugin.wasm at {}",
                fixture.display()
            ));
        }
        let sync = make_sync(":memory:")?;
        let host = PluginHost::new(TrustManager::new(), TelemetryBus::new(64), 2_000)
            .context("PluginHost::new")?;

        // Warm one load so page-cache / JIT-compile costs don't skew the first.
        let _warm = host.load(&fixture, &sync).await.context("warm load")?;

        let start = Instant::now();
        let mut handles = Vec::with_capacity(INSTANTIATION_COUNT);
        for _ in 0..INSTANTIATION_COUNT {
            handles.push(host.load(&fixture, &sync).await.context("pool load")?);
        }
        let total_ns = start.elapsed().as_nanos();
        let per_instance_ns = total_ns / INSTANTIATION_COUNT as u128;
        drop(handles);

        Ok(BenchReport {
            version: 1,
            suite: "tractor-instantiation".to_string(),
            node_count: INSTANTIATION_COUNT,
            threshold_pct: REGRESSION_THRESHOLD_PCT,
            metrics: vec![
                metric("total", total_ns, "ns"),
                metric("instances", INSTANTIATION_COUNT as u128, "count"),
                metric("per_instance", per_instance_ns, "ns"),
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
