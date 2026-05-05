#!/usr/bin/env node
import { appendFileSync } from "node:fs";
import {
	collectCarryForwardResults,
	evaluateCarryForwardResults,
} from "./carry-forward-status-lib.mjs";

function envFlag(name) {
	return process.env[name] === "true";
}

function writeOutput(key, value) {
	if (!process.env.GITHUB_OUTPUT) return;
	appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${value}\n`);
}

function buildSkippedGateDefinitions() {
	const definitions = [
		{
			key: "quality_security",
			skip: !envFlag("CODE_CHANGES"),
			type: "step",
			job: "quality",
			stepNames: ["Security audit"],
		},
		{
			key: "quality_tsconfig",
			skip: !envFlag("CODE_CHANGES"),
			type: "step",
			job: "quality",
			stepNames: ["TSConfig preflight"],
		},
		{
			key: "quality_verify_full_turbo",
			skip: !envFlag("CODE_CHANGES"),
			type: "step",
			job: "quality",
			stepNames: ["Verify (Full Turbo)", "Verify (Full Turbo fallback)"],
		},
		{
			key: "task_smoke_core",
			skip: !envFlag("RUN_TASK_SMOKE"),
			type: "step",
			job: "quality",
			stepNames: ["Farmhand task execution smoke (CLI ↔ sidecar)"],
		},
		{
			key: "task_smoke_pi_agent",
			skip: !envFlag("RUN_TASK_SMOKE"),
			type: "step",
			job: "quality",
			stepNames: ["Farmhand pi-agent respond smoke (effort round-trip)"],
		},
		{
			key: "tractor_health_probe",
			skip: !envFlag("TRACTOR_GATES"),
			type: "step",
			job: "quality",
			stepNames: ["Tractor health probe smoke"],
		},
		{
			key: "tractor_runtime_module",
			skip: !envFlag("TRACTOR_GATES"),
			type: "step",
			job: "quality",
			stepNames: ["Browser runtime descriptor gate (Tractor TS)"],
		},
		{
			key: "tractor_release_smoke",
			skip: !envFlag("TRACTOR_GATES"),
			type: "step",
			job: "quality",
			stepNames: ["Runtime descriptor release-path smoke (Tractor TS)"],
		},
		{
			key: "tractor_revocation_report",
			skip: !envFlag("TRACTOR_GATES"),
			type: "step",
			job: "quality",
			stepNames: ["Revocation diagnostics report smoke (Tractor TS)"],
		},
		{
			key: "tractor_revocation_baseline",
			skip: !envFlag("TRACTOR_GATES"),
			type: "step",
			job: "quality",
			stepNames: ["Revocation diagnostics baseline lookup (Tractor TS)"],
		},
		{
			key: "tractor_revocation_history",
			skip: !envFlag("TRACTOR_GATES"),
			type: "step",
			job: "quality",
			stepNames: ["Revocation diagnostics history smoke (Tractor TS)"],
		},
		{
			key: "tractor_benchmark_gate",
			skip: !envFlag("TRACTOR_GATES"),
			type: "step",
			job: "quality",
			stepNames: ["Benchmark Quality Gate (Tractor)"],
		},
		{
			key: "tractor_coverage_gate",
			skip: !envFlag("TRACTOR_GATES"),
			type: "step",
			job: "quality",
			stepNames: ["Coverage Quality Gate (Tractor)"],
		},
		{
			key: "audit_moderate",
			skip: !envFlag("RUN_AUDIT"),
			type: "job",
			job: "audit-moderate",
		},
		{
			key: "build",
			skip: !envFlag("RUN_BUILD"),
			type: "job",
			job: "build",
		},
		{
			key: "e2e",
			skip: !envFlag("RUN_E2E"),
			type: "job",
			job: "e2e",
		},
		{
			key: "deep_regression",
			skip: !envFlag("RUN_DEEP"),
			type: "job",
			job: "deep-regression",
		},
	];
	return definitions.filter((gate) => gate.skip);
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
		console.log(`::${message.level}::${message.text}`);
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
