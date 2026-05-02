#!/usr/bin/env node
import assert from "node:assert/strict";
import test from "node:test";
import {
	collectCarryForwardResults,
	evaluateCarryForwardResults,
	resolveGateFromJobs,
} from "./carry-forward-status-lib.mjs";

test("resolveGateFromJobs ignores cancelled job conclusions", () => {
	const gate = { key: "build", type: "job", job: "build" };
	const run = { html_url: "https://example.test/run/1" };
	const jobs = [{ name: "build", conclusion: "cancelled" }];

	assert.equal(resolveGateFromJobs(gate, run, jobs), null);
});

test("resolveGateFromJobs ignores stale step conclusions", () => {
	const gate = {
		key: "task_smoke_core",
		type: "step",
		job: "quality",
		stepNames: ["Farmhand task execution smoke (CLI ↔ sidecar)"],
	};
	const run = { html_url: "https://example.test/run/2" };
	const jobs = [
		{
			name: "quality",
			steps: [
				{
					name: "Farmhand task execution smoke (CLI ↔ sidecar)",
					conclusion: "stale",
				},
			],
		},
	];

	assert.equal(resolveGateFromJobs(gate, run, jobs), null);
});

test("collectCarryForwardResults falls back to older success when newest run is cancelled", async () => {
	const gate = {
		key: "task_smoke_core",
		type: "step",
		job: "quality",
		stepNames: ["Farmhand task execution smoke (CLI ↔ sidecar)"],
	};
	const tracked = [gate];
	const candidates = [
		{ id: 200, html_url: "https://example.test/run/200" },
		{ id: 199, html_url: "https://example.test/run/199" },
	];
	const jobsByRun = new Map([
		[
			200,
			[
				{
					name: "quality",
					steps: [
						{
							name: "Farmhand task execution smoke (CLI ↔ sidecar)",
							conclusion: "cancelled",
						},
					],
				},
			],
		],
		[
			199,
			[
				{
					name: "quality",
					steps: [
						{
							name: "Farmhand task execution smoke (CLI ↔ sidecar)",
							conclusion: "success",
						},
					],
				},
			],
		],
	]);

	const results = await collectCarryForwardResults({
		tracked,
		candidates,
		getJobs: async (run) => jobsByRun.get(run.id) || [],
	});

	assert.deepEqual(results.get("task_smoke_core"), {
		status: "success",
		sourceUrl: "https://example.test/run/199",
	});
});

test("evaluateCarryForwardResults only fails on true failing statuses", () => {
	const tracked = [{ key: "build" }, { key: "e2e" }, { key: "deep" }];
	const results = new Map([
		["build", { status: "success", sourceUrl: "https://example.test/run/1" }],
		["e2e", { status: "unknown", sourceUrl: "" }],
		["deep", { status: "failure", sourceUrl: "https://example.test/run/2" }],
	]);

	const evaluated = evaluateCarryForwardResults({ tracked, results });

	assert.equal(evaluated.hasFailure, true);
	assert.equal(
		evaluated.messages.some(
			(message) => message.level === "error" && message.text.includes("deep"),
		),
		true,
	);
	assert.equal(
		evaluated.messages.some(
			(message) =>
				message.level === "warning" &&
				message.text.includes("no prior executed"),
		),
		true,
	);
});
