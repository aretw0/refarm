#!/usr/bin/env node

import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

function parseArgs(argv) {
	const options = {
		input: "/tmp/ci-jobs.json",
		output: "ci-run-metrics.json",
		summary: process.env.GITHUB_STEP_SUMMARY || "",
	};

	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		const next = argv[index + 1];
		if (arg === "--input" && next) {
			options.input = next;
			index += 1;
		} else if (arg === "--output" && next) {
			options.output = next;
			index += 1;
		} else if (arg === "--summary" && next) {
			options.summary = next;
			index += 1;
		} else {
			throw new Error(`Unknown or incomplete argument: ${arg}`);
		}
	}

	return options;
}

function durationSec(startedAt, completedAt) {
	const started = startedAt ? new Date(startedAt).getTime() : null;
	const ended = completedAt ? new Date(completedAt).getTime() : null;
	if (!Number.isFinite(started) || !Number.isFinite(ended)) return 0;
	return Math.max(0, Math.round((ended - started) / 1000));
}

function escapeMarkdownCell(value) {
	return String(value).replaceAll("|", "\\|").replaceAll("\n", " ");
}

export function buildRunMetrics(payload, env = process.env) {
	const jobs = (payload.jobs || []).map((job) => ({
		name: job.name,
		status: job.status,
		conclusion: job.conclusion || "-",
		durationSec: durationSec(job.started_at, job.completed_at),
		url: job.html_url || job.url || null,
	}));

	const totalDurationSec = jobs.reduce((acc, job) => acc + job.durationSec, 0);
	const byConclusion = jobs.reduce((acc, job) => {
		acc[job.conclusion] = (acc[job.conclusion] || 0) + 1;
		return acc;
	}, {});
	const slowestJobs = [...jobs]
		.sort((a, b) => b.durationSec - a.durationSec)
		.slice(0, 10);

	return {
		runId: env.GITHUB_RUN_ID || null,
		runAttempt: env.GITHUB_RUN_ATTEMPT || null,
		workflow: env.GITHUB_WORKFLOW || null,
		repository: env.GITHUB_REPOSITORY || null,
		ref: env.GITHUB_REF || null,
		sha: env.GITHUB_SHA || null,
		runUrl:
			env.GITHUB_SERVER_URL && env.GITHUB_REPOSITORY && env.GITHUB_RUN_ID
				? `${env.GITHUB_SERVER_URL}/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}`
				: null,
		jobCount: jobs.length,
		totalDurationSec,
		byConclusion,
		slowestJobs,
		jobs,
	};
}

export function renderSummary(report) {
	const lines = [];
	lines.push("## CI timing snapshot");
	lines.push("");
	if (report.runUrl) {
		lines.push(`[Run ${report.runId}](${report.runUrl})`);
		lines.push("");
	}
	lines.push(`**Jobs:** ${report.jobCount}`);
	lines.push(`**Total job-seconds:** ${report.totalDurationSec}`);
	lines.push(
		`**Conclusions:** ${Object.entries(report.byConclusion)
			.sort(([a], [b]) => a.localeCompare(b))
			.map(([name, count]) => `${name}: ${count}`)
			.join(", ") || "none"}`,
	);
	lines.push("");
	lines.push("### Slowest jobs");
	lines.push("");
	lines.push("| Job | Status | Conclusion | Duration (s) |");
	lines.push("|---|---|---|---:|");
	for (const job of report.slowestJobs) {
		lines.push(
			`| ${escapeMarkdownCell(job.name)} | ${escapeMarkdownCell(job.status)} | ${escapeMarkdownCell(
				job.conclusion,
			)} | ${job.durationSec} |`,
		);
	}
	lines.push("");
	lines.push(`<details><summary>All jobs</summary>`);
	lines.push("");
	lines.push("| Job | Status | Conclusion | Duration (s) |");
	lines.push("|---|---|---|---:|");
	for (const job of report.jobs) {
		lines.push(
			`| ${escapeMarkdownCell(job.name)} | ${escapeMarkdownCell(job.status)} | ${escapeMarkdownCell(
				job.conclusion,
			)} | ${job.durationSec} |`,
		);
	}
	lines.push("");
	lines.push("</details>");
	lines.push("");
	return `${lines.join("\n")}\n`;
}

function main() {
	const options = parseArgs(process.argv.slice(2));
	const payload = JSON.parse(readFileSync(options.input, "utf8"));
	const report = buildRunMetrics(payload);
	writeFileSync(options.output, `${JSON.stringify(report, null, 2)}\n`);
	if (options.summary) appendFileSync(options.summary, renderSummary(report));
	console.log(`Exported CI run metrics to ${basename(options.output)}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
	main();
}
