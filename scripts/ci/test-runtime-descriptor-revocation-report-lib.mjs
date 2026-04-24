#!/usr/bin/env node
import assert from "node:assert/strict";
import test from "node:test";
import {
	buildRuntimeDescriptorRevocationReport,
	hasAlertAtOrAbove,
	renderRevocationReportMarkdown,
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
