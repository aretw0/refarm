import assert from "node:assert/strict";
import test from "node:test";

import { buildRunMetrics, renderSummary } from "./export-ci-run-metrics.mjs";

test("buildRunMetrics summarizes conclusions and slowest jobs", () => {
	const report = buildRunMetrics(
		{
			jobs: [
				{
					name: "fast",
					status: "completed",
					conclusion: "success",
					started_at: "2026-06-11T17:00:00Z",
					completed_at: "2026-06-11T17:00:03Z",
				},
				{
					name: "slow|gate",
					status: "completed",
					conclusion: "success",
					started_at: "2026-06-11T17:00:00Z",
					completed_at: "2026-06-11T17:01:00Z",
				},
				{
					name: "pending",
					status: "queued",
					conclusion: null,
				},
			],
		},
		{
			GITHUB_RUN_ID: "123",
			GITHUB_RUN_ATTEMPT: "2",
			GITHUB_WORKFLOW: "Test",
			GITHUB_REPOSITORY: "aretw0/refarm",
			GITHUB_SERVER_URL: "https://github.com",
		},
	);

	assert.equal(report.jobCount, 3);
	assert.equal(report.totalDurationSec, 63);
	assert.deepEqual(report.byConclusion, { success: 2, "-": 1 });
	assert.equal(report.slowestJobs[0].name, "slow|gate");
	assert.equal(report.runUrl, "https://github.com/aretw0/refarm/actions/runs/123");
});

test("renderSummary includes slowest jobs and escapes markdown table cells", () => {
	const report = buildRunMetrics({
		jobs: [
			{
				name: "slow|gate",
				status: "completed",
				conclusion: "success",
				started_at: "2026-06-11T17:00:00Z",
				completed_at: "2026-06-11T17:01:00Z",
			},
		],
	});

	const summary = renderSummary(report);
	assert.match(summary, /## CI timing snapshot/);
	assert.match(summary, /### Slowest jobs/);
	assert.match(summary, /slow\\\|gate/);
	assert.match(summary, /<details><summary>All jobs<\/summary>/);
});
