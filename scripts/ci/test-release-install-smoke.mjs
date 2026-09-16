import assert from "node:assert/strict";
import test from "node:test";
import {
	assertInternalDependencyClosure,
	parseArgs,
	serializeReport,
} from "./release-install-smoke.mjs";

test("install smoke rejects an internal dependency outside the selected packet", () => {
	assert.throws(
		() =>
			assertInternalDependencyClosure([
				{
					pkg: {
						name: "@refarm.dev/consumer",
						dependencies: { "@refarm.dev/missing": "workspace:*" },
					},
				},
			]),
		/consumer -> @refarm\.dev\/missing \(dependencies: workspace:\*\)/,
	);
});

test("install smoke accepts a closed internal dependency packet", () => {
	assert.doesNotThrow(() =>
		assertInternalDependencyClosure([
			{ pkg: { name: "@refarm.dev/provider" } },
			{
				pkg: {
					name: "@refarm.dev/consumer",
					dependencies: { "@refarm.dev/provider": "workspace:*" },
				},
			},
		]),
	);
});

test("arguments expose durable diagnostics without changing the default cache policy", () => {
	const options = parseArgs([
		"--selection",
		"ecosystem-ready",
		"--json",
		"--keep",
		"--command-timeout-ms",
		"1234",
	]);
	assert.equal(options.selectionId, "ecosystem-ready");
	assert.equal(options.json, true);
	assert.equal(options.keep, true);
	assert.equal(options.commandTimeoutMs, 1234);
	assert.equal(options.storeDir, null);
	assert.throws(() => parseArgs(["--command-timeout-ms", "0"]), /positive integer/);
});

test("structured receipt retains timings and hides a deleted stage", () => {
	const report = serializeReport({
		options: { selectionId: "ecosystem-ready", keep: false, storeDir: null },
		packageResults: [{ name: "@refarm.dev/example", buildMs: 1, packMs: 2, totalMs: 3 }],
		phaseTimings: { buildAndPackMs: 3, installMs: 4, importMs: 5, totalMs: 12 },
		results: [{ name: "@refarm.dev/example", ok: true, exports: 1 }],
		stage: "/tmp/ephemeral-stage",
	});
	assert.equal(report.ok, true);
	assert.equal(report.stage, null);
	assert.equal(report.storeDir, "pnpm-configured-store");
	assert.equal(report.phasesMs.totalMs, 12);
});
