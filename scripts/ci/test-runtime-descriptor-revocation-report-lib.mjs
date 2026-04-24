#!/usr/bin/env node
import assert from "node:assert/strict";
import { rm, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import {
	evaluateHistoryFailurePolicy,
	resolveReportPaths,
} from "./runtime-descriptor-revocation-history-lib.mjs";
import {
	buildRuntimeDescriptorRevocationHistorySnapshot,
	buildRuntimeDescriptorRevocationReport,
	buildRuntimeDescriptorRevocationReportDelta,
	hasAlertAtOrAbove,
	normalizeRuntimeDescriptorRevocationReport,
	renderRevocationReportMarkdown,
	renderRuntimeDescriptorRevocationHistoryMarkdown,
	resolveRevocationReportThresholds,
	summarizeRevocationEvents,
} from "./runtime-descriptor-revocation-report-lib.mjs";

test("summarizeRevocationEvents aggregates only revocation signals", () => {
	const summary = summarizeRevocationEvents([
		{
			event: "system:descriptor_revocation_unavailable",
			pluginId: "@acme/plugin-a",
			payload: {
				policy: "fail-open",
				policySource: "environment-profile",
				profile: "staging",
			},
		},
		{
			event: "system:descriptor_revocation_config_invalid",
			pluginId: "@acme/plugin-a",
			payload: {
				resolvedPolicy: "stale-allowed",
				policySource: "fallback",
				profile: "dev",
			},
		},
		{
			event: "storage:io",
			pluginId: "@acme/plugin-z",
			payload: { action: "store" },
		},
	]);

	assert.equal(summary.totalEvents, 2);
	assert.equal(summary.byEvent["system:descriptor_revocation_unavailable"], 1);
	assert.equal(
		summary.byEvent["system:descriptor_revocation_config_invalid"],
		1,
	);
	assert.equal(summary.byPolicy["fail-open"], 1);
	assert.equal(summary.byPolicy["stale-allowed"], 1);
	assert.equal(summary.byPolicySource.fallback, 1);
	assert.deepEqual(summary.affectedPlugins, ["@acme/plugin-a"]);
});

test("resolveRevocationReportThresholds normalizes unavailable critical threshold", () => {
	const thresholds = resolveRevocationReportThresholds({
		"unavailable-warn-at": "2",
		"unavailable-critical-at": "1",
		"config-drift-warn-at": "3",
	});

	assert.equal(thresholds.unavailableWarnAt, 2);
	assert.equal(thresholds.unavailableCriticalAt, 2);
	assert.equal(thresholds.configDriftWarnAt, 3);
	assert.equal(thresholds.staleCacheWarnAt, 1);
});

test("buildRuntimeDescriptorRevocationReport creates critical alert for fail-closed unavailable", () => {
	const report = buildRuntimeDescriptorRevocationReport({
		generatedAt: "2026-04-24T21:00:00.000Z",
		inputPath: "fixtures/sample.json",
		events: [
			{
				event: "system:descriptor_revocation_unavailable",
				pluginId: "@acme/plugin-a",
				payload: {
					policy: "fail-closed",
					policySource: "explicit-policy",
					profile: "production",
				},
			},
		],
		thresholdArgs: {
			"unavailable-warn-at": 2,
			"unavailable-critical-at": 10,
		},
	});

	assert.equal(report.generatedAt, "2026-04-24T21:00:00.000Z");
	assert.equal(report.summary.totalEvents, 1);
	assert.equal(report.alerts[0]?.id, "revocation-unavailable");
	assert.equal(report.alerts[0]?.severity, "critical");
	assert.equal(hasAlertAtOrAbove(report.alerts, "warn"), true);
	assert.equal(hasAlertAtOrAbove(report.alerts, "critical"), true);
	assert.equal(hasAlertAtOrAbove(report.alerts, "info"), true);

	const markdown = renderRevocationReportMarkdown(report);
	assert.ok(markdown.includes("# Runtime Descriptor Revocation Report"));
	assert.ok(markdown.includes("revocation-unavailable"));
	assert.ok(markdown.includes("fail-closed"));
});

test("buildRuntimeDescriptorRevocationReportDelta computes deterministic counter deltas", () => {
	const previous = normalizeRuntimeDescriptorRevocationReport({
		generatedAt: "2026-04-24T08:00:00.000Z",
		summary: {
			totalEvents: 1,
			byEvent: {
				"system:descriptor_revocation_config_invalid": 0,
				"system:descriptor_revocation_config_conflict": 0,
				"system:descriptor_revocation_stale_cache_used": 0,
				"system:descriptor_revocation_unavailable": 1,
			},
			byPolicy: { "fail-open": 1 },
			byPolicySource: { fallback: 1 },
			byProfile: { staging: 1 },
			affectedPlugins: ["@acme/plugin-a"],
		},
		alerts: [
			{
				id: "revocation-unavailable",
				severity: "warn",
				count: 1,
			},
		],
	});

	const current = normalizeRuntimeDescriptorRevocationReport({
		generatedAt: "2026-04-24T12:00:00.000Z",
		summary: {
			totalEvents: 3,
			byEvent: {
				"system:descriptor_revocation_config_invalid": 1,
				"system:descriptor_revocation_config_conflict": 0,
				"system:descriptor_revocation_stale_cache_used": 1,
				"system:descriptor_revocation_unavailable": 1,
			},
			byPolicy: { "fail-open": 1, "stale-allowed": 2 },
			byPolicySource: { fallback: 1, "environment-profile": 2 },
			byProfile: { staging: 2, dev: 1 },
			affectedPlugins: ["@acme/plugin-a", "@acme/plugin-b"],
		},
		alerts: [
			{
				id: "revocation-unavailable",
				severity: "warn",
				count: 1,
			},
			{
				id: "revocation-stale-cache",
				severity: "warn",
				count: 1,
			},
		],
	});

	const delta = buildRuntimeDescriptorRevocationReportDelta(current, previous);
	assert.equal(delta.totalEventsDelta, 2);
	assert.equal(
		delta.byEventDelta["system:descriptor_revocation_config_invalid"],
		1,
	);
	assert.deepEqual(delta.affectedPluginsAdded, ["@acme/plugin-b"]);
	assert.equal(delta.alertSeverityDelta.warn, 1);
});

test("buildRuntimeDescriptorRevocationHistorySnapshot orders reports and renders timeline markdown", () => {
	const snapshot = buildRuntimeDescriptorRevocationHistorySnapshot(
		[
			{
				generatedAt: "2026-04-24T12:00:00.000Z",
				summary: {
					totalEvents: 2,
					byEvent: {
						"system:descriptor_revocation_config_invalid": 1,
						"system:descriptor_revocation_config_conflict": 0,
						"system:descriptor_revocation_stale_cache_used": 0,
						"system:descriptor_revocation_unavailable": 1,
					},
					byPolicy: { "fail-open": 2 },
					byPolicySource: { fallback: 2 },
					byProfile: { staging: 2 },
					affectedPlugins: ["@acme/plugin-a"],
				},
				alerts: [],
			},
			{
				generatedAt: "2026-04-24T08:00:00.000Z",
				summary: {
					totalEvents: 1,
					byEvent: {
						"system:descriptor_revocation_config_invalid": 0,
						"system:descriptor_revocation_config_conflict": 0,
						"system:descriptor_revocation_stale_cache_used": 0,
						"system:descriptor_revocation_unavailable": 1,
					},
					byPolicy: { "fail-open": 1 },
					byPolicySource: { fallback: 1 },
					byProfile: { staging: 1 },
					affectedPlugins: ["@acme/plugin-a"],
				},
				alerts: [
					{
						id: "revocation-unavailable",
						severity: "warn",
						count: 1,
					},
				],
			},
		],
		{ maxPoints: 2, generatedAt: "2026-04-24T13:00:00.000Z" },
	);

	assert.equal(snapshot.generatedAt, "2026-04-24T13:00:00.000Z");
	assert.equal(snapshot.reportsAnalyzed, 2);
	assert.equal(snapshot.timeline[0].generatedAt, "2026-04-24T08:00:00.000Z");
	assert.equal(snapshot.delta.totalEventsDelta, 1);

	const markdown = renderRuntimeDescriptorRevocationHistoryMarkdown(snapshot);
	assert.ok(markdown.includes("# Runtime Descriptor Revocation History"));
	assert.ok(markdown.includes("Latest delta"));
});

test("resolveReportPaths supports explicit reports and reports-file", async () => {
	const cwd = process.cwd();
	const reportsFile = path.resolve(
		cwd,
		".tmp-runtime-descriptor-report-paths.txt",
	);
	await writeFile(
		reportsFile,
		"scripts/ci/fixtures/runtime-descriptor-revocation-report.previous.json\n",
	);

	try {
		const reportPaths = await resolveReportPaths({
			root: cwd,
			reports:
				"scripts/ci/fixtures/runtime-descriptor-revocation-report.current.json",
			reportsFile,
		});

		assert.equal(reportPaths.length, 2);
		assert.equal(
			reportPaths.some((entry) =>
				entry.endsWith("runtime-descriptor-revocation-report.current.json"),
			),
			true,
		);
	} finally {
		await rm(reportsFile, { force: true });
	}
});

test("evaluateHistoryFailurePolicy throws on configured unavailable delta", () => {
	const snapshot = {
		delta: {
			totalEventsDelta: 0,
			byEventDelta: {
				"system:descriptor_revocation_unavailable": 2,
			},
			alertSeverityDelta: {
				critical: 0,
			},
		},
		latest: { alerts: [] },
	};

	assert.throws(
		() =>
			evaluateHistoryFailurePolicy(snapshot, {
				"fail-on-unavailable-increase": 2,
			}),
		/failure policy triggered/,
	);
});
