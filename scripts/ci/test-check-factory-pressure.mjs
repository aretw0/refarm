#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

import {
	buildFactoryPressureReport,
	classifyDiskPressure,
	classifyMemoryPressure,
	decideFactoryPressure,
	DEFAULT_FACTORY_PRESSURE_THRESHOLDS,
} from "./factory-pressure-lib.mjs";

const MB = 1024 * 1024;
const GB = 1024 * MB;

test("factory pressure classifies low disk as stop-and-investigate", () => {
	assert.equal(classifyDiskPressure(2 * GB), "failure");
	assert.equal(decideFactoryPressure([{ severity: "failure" }]), "stop-and-investigate");
});

test("factory pressure classifies tight memory as safe-mode", () => {
	const severity = classifyMemoryPressure({
		freeBytes: 900 * MB,
		totalBytes: 8 * GB,
	});

	assert.equal(severity, "warning");
	assert.equal(decideFactoryPressure([{ severity }]), "safe-mode");
});

test("factory pressure report is read-only and recommends bounded cleanup", () => {
	const report = buildFactoryPressureReport({
		cwd: "/repo",
		env: { CARGO_TARGET_DIR: ".cache/cargo-target" },
		now: new Date("2026-06-28T00:00:00.000Z"),
		existsSync: (candidate) => candidate === "/repo/.git/gc.log",
		statfsSync: () => ({
			bavail: 2 * 1024,
			bsize: 1024 * 1024,
			blocks: 100 * 1024,
		}),
		os: {
			freemem: () => 4 * GB,
			totalmem: () => 8 * GB,
		},
		thresholds: DEFAULT_FACTORY_PRESSURE_THRESHOLDS,
	});

	assert.equal(report.schemaVersion, 1);
	assert.equal(report.command, "factory-pressure");
	assert.equal(report.operation, "check");
	assert.equal(report.ok, false);
	assert.equal(report.decision, "stop-and-investigate");
	assert.equal(report.nextCommand, "pnpm run clean:rust:check");
	assert.ok(report.signals.some((signal) => signal.id === "filesystem-free-space"));
	assert.ok(report.signals.some((signal) => signal.id === "git-gc-log-present"));
	assert.ok(report.signals.some((signal) => signal.id === "cargo-target-dir"));
	assert.ok(report.recommendations.some((recommendation) =>
		recommendation.action.includes("do not run prune") ||
		recommendation.action.includes("smallest cleanup tier")
	));
});

test("factory pressure command emits a stable JSON envelope", () => {
	const result = spawnSync(process.execPath, ["scripts/ci/check-factory-pressure.mjs", "--json"], {
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
		windowsHide: true,
	});

	assert.equal(result.status, 0);
	assert.equal(result.stderr, "");

	const output = JSON.parse(result.stdout);
	assert.equal(output.schemaVersion, 1);
	assert.equal(output.command, "factory-pressure");
	assert.equal(output.operation, "check");
	assert.match(output.decision, /^(continue|safe-mode|stop-and-investigate)$/);
	assert.equal(typeof output.ok, "boolean");
	assert.ok(Array.isArray(output.signals));
	assert.ok(Array.isArray(output.recommendations));
	assert.ok(Array.isArray(output.nextActions));
	assert.ok(Array.isArray(output.nextCommands));
});
