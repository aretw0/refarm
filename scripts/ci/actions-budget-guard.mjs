#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import process from "node:process";

const DEFAULT_REPO = "aretw0/refarm";

const GUARD_MODES = [
	{
		mode: "account",
		kind: "hard",
		description: "Account-month net billable posture against the quota baseline.",
		npmScript: "actions:budget:guard:account",
		jsonNpmScript: "actions:budget:guard:account:json",
	},
	{
		mode: "allocation",
		kind: "advisory",
		description: "Per-repo gross usage against the local 50/50 fairness split.",
		npmScript: "actions:budget:guard:allocation",
		jsonNpmScript: "actions:budget:guard:allocation:json",
	},
];

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

function numberOrZero(value) {
	return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function listGuardModes() {
	return GUARD_MODES.map((mode) => ({ ...mode }));
}

function formatGuardModeList() {
	return listGuardModes()
		.map((mode) => mode.mode)
		.join(", ");
}

function createGuardModeListEnvelope() {
	return {
		schemaVersion: 1,
		defaultMode: "account",
		modes: listGuardModes(),
	};
}

function isGuardMode(mode) {
	return GUARD_MODES.some((candidate) => candidate.mode === mode);
}

function readGuardMode() {
	const mode =
		readArgValue("--mode") ??
		process.env.GITHUB_ACTIONS_BUDGET_GUARD_MODE ??
		"account";
	if (!isGuardMode(mode)) {
		throw new Error(
			`Unknown guard mode: ${mode}. Expected one of: ${formatGuardModeList()}.`,
		);
	}
	return mode;
}

function createAccountGuardDecision(report, { failOnWarn = false } = {}) {
	if (!report.official?.available) {
		throw new Error(
			`GitHub Actions budget guard failed: official account billing unavailable (${report.official?.error ?? "unknown error"})`,
		);
	}
	const usage = report.official.usage ?? {};
	const billableMinutes = Math.max(0, numberOrZero(usage.netQuantity));
	const burn = report.quota > 0 ? billableMinutes / report.quota : 0;
	const quotaRemaining = report.quota - billableMinutes;
	const status = statusForBurn(burn);
	const summary = `account status=${status} billable=${formatMinutes(billableMinutes)} quotaRemaining=${formatMinutes(quotaRemaining)} burn=${formatPercent(burn)} gross=${formatMinutes(numberOrZero(usage.grossQuantity))} discounted=${formatMinutes(numberOrZero(usage.discountQuantity))}`;
	return {
		schemaVersion: 1,
		mode: "account",
		status,
		shouldFail:
			status === "OVER ALLOCATION" || (failOnWarn && status === "WARN"),
		failOnWarn,
		quota: report.quota,
		billableMinutes,
		quotaRemaining,
		burn,
		grossMinutes: numberOrZero(usage.grossQuantity),
		discountedMinutes: numberOrZero(usage.discountQuantity),
		summary,
	};
}

function createAllocationGuardDecision(
	report,
	repo,
	{ failOnWarn = false } = {},
) {
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
	return {
		schemaVersion: 1,
		mode: "allocation",
		repo,
		status,
		shouldFail:
			status === "OVER ALLOCATION" || (failOnWarn && status === "WARN"),
		failOnWarn,
		allocatedMinutes: repoReport.allocatedMinutes,
		allocationRemaining: repoReport.officialAllocationRemaining,
		burn: repoReport.officialAllocationBurn,
		officialGrossMinutes: numberOrZero(
			repoReport.official.usage?.grossQuantity,
		),
		officialNetBillableMinutes: Math.max(
			0,
			numberOrZero(repoReport.official.usage?.netQuantity),
		),
		summary,
	};
}

function loadBudgetReport(extraArgs, inputPath) {
	if (inputPath) {
		return JSON.parse(readFileSync(inputPath, "utf8"));
	}

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
	if (hasArg("--list-modes")) {
		if (hasArg("--json")) {
			console.log(JSON.stringify(createGuardModeListEnvelope(), null, 2));
		} else {
			console.log(formatGuardModeList());
		}
		return;
	}

	if (hasArg("--help") || hasArg("-h")) {
		console.log("GitHub Actions budget guard usage:");
		console.log(
			"  node scripts/ci/actions-budget-guard.mjs [--mode account|allocation] [--repo owner/repo] [--input report.json] [--fail-on-warn] [--json] [--list-modes] [actions-budget args...]",
		);
		console.log(
			"  default mode: account (month-to-date account net billable posture)",
		);
		console.log(
			"  allocation mode preserves the advisory 50/50 per-repo guard",
		);
		console.log(
			"  --json prints the guard decision envelope and preserves fail exit codes",
		);
		console.log("  --list-modes prints available guard modes; combine with --json for metadata");
		console.log(`  modes: ${formatGuardModeList()}`);
		console.log("  default repo for allocation mode: aretw0/refarm");
		return;
	}

	const mode = readGuardMode();
	const repo =
		readArgValue("--repo") ??
		process.env.GITHUB_ACTIONS_BUDGET_GUARD_REPO ??
		DEFAULT_REPO;
	const inputPath = readArgValue("--input");
	const failOnWarn = hasArg("--fail-on-warn");
	const json = hasArg("--json");
	const passthroughArgs = [];

	for (let i = 2; i < process.argv.length; i += 1) {
		const arg = process.argv[i];
		if (arg === "--repo") {
			i += 1;
			continue;
		}
		if (arg === "--mode") {
			i += 1;
			continue;
		}
		if (arg === "--input") {
			i += 1;
			continue;
		}
		if (arg === "--fail-on-warn") continue;
		if (arg === "--json") continue;
		if (arg === "--list-modes") continue;
		passthroughArgs.push(arg);
	}

	const report = loadBudgetReport(passthroughArgs, inputPath);
	const decision =
		mode === "account"
			? createAccountGuardDecision(report, { failOnWarn })
			: createAllocationGuardDecision(report, repo, { failOnWarn });

	if (json) {
		console.log(JSON.stringify(decision, null, 2));
	} else if (decision.shouldFail) {
		throw new Error(`GitHub Actions budget guard failed: ${decision.summary}`);
	} else {
		console.log(`GitHub Actions budget guard passed: ${decision.summary}`);
	}

	if (decision.shouldFail) {
		process.exitCode = 1;
	}
}

try {
	main();
} catch (error) {
	console.error(error instanceof Error ? error.message : String(error));
	process.exitCode = 1;
}
