#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname } from "node:path";

const BASELINE_PATH = "benchmarks/coverage-baseline.json";
const CURRENT_PATH = "coverage/current.json";
const LCOV_PATH = "coverage/lcov.info";
const GHA_PAYLOAD_PATH = "coverage/gha-payload.json";
const REGRESSION_THRESHOLD_PCT = 0.1;

const mode = process.argv[2] ?? "check";

if (!["save", "check"].includes(mode)) {
  console.error("usage: coverage.mjs <save|check>");
  process.exit(1);
}

ensureCargoLlvmCov();

const current = runCoverage();
writeJson(mode === "save" ? BASELINE_PATH : CURRENT_PATH, current);

if (mode === "save") {
  writePayload(payloadForMissingComparison(current));
  console.log(
    `[tractor-coverage] baseline saved: ${BASELINE_PATH} lines=${current.lines.percent}%`
  );
  process.exit(0);
}

const baseline = readJson(BASELINE_PATH);
const payload = compareReports(baseline, current);
writePayload(payload);

if (payload.regressed) {
  console.error(
    `[tractor-coverage] coverage regressed by ${Math.abs(
      payload.diff_points
    ).toFixed(2)}pp ` +
      `(threshold ${payload.threshold}pp). baseline=${payload.previous}% current=${payload.current}%`
  );
  process.exit(1);
}

console.log(
  `[tractor-coverage] OK diff=${payload.diff_points.toFixed(2)}pp threshold=${
    payload.threshold
  }pp ` + `baseline=${payload.previous}% current=${payload.current}%`
);

function ensureCargoLlvmCov() {
  const check = spawnSync("cargo", ["llvm-cov", "--version"], {
    encoding: "utf8",
    stdio: "pipe",
  });
  if (check.status === 0) {
    return;
  }

  console.error(
    "cargo-llvm-cov is required for Tractor coverage. " +
      "Install it with: cargo install cargo-llvm-cov --locked --version 0.8.7"
  );
  process.exit(check.status ?? 1);
}

function runCoverage() {
  mkdirSync("coverage", { recursive: true });
  run("cargo", ["llvm-cov", "--lib", "--lcov", "--output-path", LCOV_PATH]);

  const lcov = readFileSync(LCOV_PATH, "utf8");
  const lines = summarizeLcovLines(lcov);

  return {
    version: 1,
    suite: "tractor-rust-lib",
    tool: "cargo-llvm-cov",
    threshold_pct_points: REGRESSION_THRESHOLD_PCT,
    lines,
  };
}

function summarizeLcovLines(lcov) {
  let found = 0;
  let hit = 0;

  for (const line of lcov.split("\n")) {
    if (line.startsWith("LF:")) {
      found += parseInt(line.slice(3), 10);
    } else if (line.startsWith("LH:")) {
      hit += parseInt(line.slice(3), 10);
    }
  }

  if (!Number.isFinite(found) || found <= 0) {
    throw new Error(`lcov report did not contain line totals: ${LCOV_PATH}`);
  }

  return {
    found,
    hit,
    percent: roundPct((hit / found) * 100),
  };
}

function compareReports(baseline, current) {
  if (baseline.version !== current.version) {
    throw new Error(
      `coverage report version mismatch: baseline=${baseline.version} current=${current.version}`
    );
  }
  if (baseline.suite !== current.suite) {
    throw new Error(
      `coverage suite mismatch: baseline=${baseline.suite} current=${current.suite}`
    );
  }

  const previous = baseline.lines.percent;
  const next = current.lines.percent;
  const diff = roundPct(next - previous);
  const threshold = baseline.threshold_pct_points ?? REGRESSION_THRESHOLD_PCT;

  return {
    improved: diff > threshold,
    regressed: diff < -threshold,
    previous,
    current: next,
    diff: `${diff.toFixed(2)}%`,
    diff_points: diff,
    threshold,
  };
}

function payloadForMissingComparison(report) {
  return {
    improved: false,
    regressed: false,
    previous: report.lines.percent,
    current: report.lines.percent,
    diff: "0.00%",
    diff_points: 0,
    threshold: report.threshold_pct_points,
  };
}

function run(command, args) {
  const xdgDataHome = mkdtempSync(`${tmpdir()}/refarm-tractor-coverage-xdg-`);
  const result = spawnSync(command, args, {
    encoding: "utf8",
    env: {
      ...process.env,
      XDG_DATA_HOME: xdgDataHome,
    },
    stdio: "inherit",
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function writePayload(payload) {
  writeJson(GHA_PAYLOAD_PATH, payload);
}

function roundPct(value) {
  return Math.round(value * 100) / 100;
}
