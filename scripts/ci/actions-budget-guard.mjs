#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import process from "node:process";

const DEFAULT_REPO = "aretw0/refarm";

function hasArg(flag) {
	return process.argv.includes(flag);
}

function readArgValue(flag) {
	const index = process.argv.indexOf(flag);
	if (index < 0) return undefined;
	return process.argv[index + 1];
}

function formatMinutes(value) {
	if (typeof value !== "number" || !Number.isFinite(value)) return "unknown";
	return `${Math.round(value * 10) / 10} min`;
}

function formatPercent(value) {
	if (typeof value !== "number" || !Number.isFinite(value)) return "unknown";
	return `${Math.round(value * 1000) / 10}%`;
}

function statusForBurn(burn) {
	if (burn > 1) return "OVER ALLOCATION";
	if (burn > 0.8) return "WARN";
	return "OK";
}

function loadBudgetReport(extraArgs) {
	const output = execFileSync(
		process.execPath,
		["scripts/ci/actions-budget.mjs", "--json", ...extraArgs],
		{
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
			env: process.env,
			maxBuffer: 32 * 1024 * 1024,
		},
	);
	return JSON.parse(output);
}

function main() {
	if (hasArg("--help") || hasArg("-h")) {
		console.log("GitHub Actions budget guard usage:");
		console.log(
			"  node scripts/ci/actions-budget-guard.mjs [--repo owner/repo] [--fail-on-warn] [actions-budget args...]",
		);
		console.log("  default repo: aretw0/refarm");
		return;
	}

	const repo =
		readArgValue("--repo") ??
		process.env.GITHUB_ACTIONS_BUDGET_GUARD_REPO ??
		DEFAULT_REPO;
	const failOnWarn = hasArg("--fail-on-warn");
	const passthroughArgs = [];

	for (let i = 2; i < process.argv.length; i += 1) {
		const arg = process.argv[i];
		if (arg === "--repo") {
			i += 1;
			continue;
		}
		if (arg === "--fail-on-warn") continue;
		passthroughArgs.push(arg);
	}

	const report = loadBudgetReport(passthroughArgs);
	const repoReport = report.repos?.find((candidate) => candidate.repo === repo);
	if (!repoReport) {
		throw new Error(`Budget report does not include repo ${repo}`);
	}

	if (!repoReport.official?.available) {
		throw new Error(
			`GitHub Actions budget guard failed for ${repo}: official billing unavailable (${repoReport.official?.error ?? "unknown error"})`,
		);
	}

	const status = statusForBurn(repoReport.officialAllocationBurn);
	const summary = `${repo} status=${status} allocationRemaining=${formatMinutes(repoReport.officialAllocationRemaining)} burn=${formatPercent(repoReport.officialAllocationBurn)}`;
	if (status === "OVER ALLOCATION" || (failOnWarn && status === "WARN")) {
		throw new Error(`GitHub Actions budget guard failed: ${summary}`);
	}

	console.log(`GitHub Actions budget guard passed: ${summary}`);
}

try {
	main();
} catch (error) {
	console.error(error instanceof Error ? error.message : String(error));
	process.exitCode = 1;
}
