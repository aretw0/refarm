#!/usr/bin/env node
import { appendFileSync } from "node:fs";
import {
	buildSkippedGateDefinitions,
	collectCarryForwardResults,
	evaluateCarryForwardResults,
} from "./carry-forward-status-lib.mjs";

function writeOutput(key, value) {
	if (!process.env.GITHUB_OUTPUT) return;
	appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${value}\n`);
}

function createGitHubApiClient() {
	const token = process.env.GITHUB_TOKEN;
	const headers = {
		Authorization: `Bearer ${token}`,
		Accept: "application/vnd.github+json",
		"X-GitHub-Api-Version": "2022-11-28",
	};

	async function gh(path) {
		const res = await fetch(`https://api.github.com${path}`, { headers });
		if (!res.ok) {
			const body = await res.text();
			throw new Error(`GitHub API ${res.status} on ${path}: ${body}`);
		}
		return res.json();
	}

	return { gh };
}

async function run() {
	const tracked = buildSkippedGateDefinitions();
	if (tracked.length === 0) {
		await writeOutput("has_failure", "false");
		return;
	}

	const token = process.env.GITHUB_TOKEN;
	const repo = process.env.GITHUB_REPOSITORY || "";
	const runId = Number(process.env.GITHUB_RUN_ID || "0");
	if (!token || !repo || !runId) {
		throw new Error(
			"Missing carry-forward context (GITHUB_TOKEN/REPOSITORY/RUN_ID).",
		);
	}
	const [owner, repository] = repo.split("/");

	const { gh } = createGitHubApiClient();

	const currentRun = await gh(
		`/repos/${owner}/${repository}/actions/runs/${runId}`,
	);
	const workflowId = currentRun.workflow_id;
	const headBranch = currentRun.head_branch;

	// Carry-forward should use the branch's freshest completed evidence, not
	// only the current event type. A develop push after a PR merge/squash may
	// skip gates that were last freshly proven by the PR run; filtering to
	// event=push can resurrect stale failures from much older push runs.
	const runs = await gh(
		`/repos/${owner}/${repository}/actions/workflows/${workflowId}/runs?branch=${encodeURIComponent(headBranch)}&status=completed&per_page=40`,
	);

	const candidates = (runs.workflow_runs || [])
		.filter((run) => run.id !== runId)
		.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

	const jobsCache = new Map();
	async function getJobs(run) {
		const cacheKey = String(run.id);
		if (jobsCache.has(cacheKey)) return jobsCache.get(cacheKey);
		const payload = await gh(
			`/repos/${owner}/${repository}/actions/runs/${run.id}/jobs?per_page=100`,
		);
		const jobs = payload.jobs || [];
		jobsCache.set(cacheKey, jobs);
		return jobs;
	}

	const results = await collectCarryForwardResults({
		tracked,
		candidates,
		getJobs,
	});
	const evaluated = evaluateCarryForwardResults({ tracked, results });

	for (const message of evaluated.messages) {
		if (message.level === "log") {
			console.log(message.text);
		} else {
			console.log(`::${message.level}::${message.text}`);
		}
	}

	await writeOutput("has_failure", evaluated.hasFailure ? "true" : "false");
}

run().catch(async (error) => {
	const message = error instanceof Error ? error.message : String(error);
	console.error(message);
	console.log(
		"::error::Carry-forward status lookup failed; failing closed to avoid masking skipped gate regressions.",
	);
	await writeOutput("has_failure", "true");
	process.exit(0);
});
