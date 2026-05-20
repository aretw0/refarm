use anyhow::{anyhow, Context, Result};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;
use std::time::Instant;
use tractor::{NativeStorage, NativeSync};

const BASELINE_PATH: &str = "benchmarks/baseline.json";
const CURRENT_PATH: &str = "benchmarks/current.json";
const GHA_PAYLOAD_PATH: &str = "benchmarks/gha-payload.json";
const NODE_COUNT: usize = 500;
const REGRESSION_THRESHOLD_PCT: f64 = 20.0;

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
        _ => Err(anyhow!("usage: tractor-bench <save|check>")),
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
    let path = Path::new(GHA_PAYLOAD_PATH);
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
