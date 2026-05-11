#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import process from "node:process";

const DEFAULT_REPOS = ["aretw0/refarm", "aretw0/agents-lab"];
const DEFAULT_SHARE = { "aretw0/refarm": 0.5, "aretw0/agents-lab": 0.5 };
const GITHUB_API_VERSION = "2026-03-10";

function parseArgs(argv) {
	const now = new Date();
	const options = {
		days: Number(process.env.GITHUB_ACTIONS_BUDGET_DAYS ?? 30),
		quota: Number(process.env.GITHUB_ACTIONS_MONTHLY_MINUTES_QUOTA ?? 2000),
		repos: [...DEFAULT_REPOS],
		billingUser: process.env.GITHUB_ACTIONS_BILLING_USER,
		year: Number(
			process.env.GITHUB_ACTIONS_BILLING_YEAR ?? now.getUTCFullYear(),
		),
		month: Number(
			process.env.GITHUB_ACTIONS_BILLING_MONTH ?? now.getUTCMonth() + 1,
		),
		json: false,
		includeJobs: false,
		official: true,
	};

	for (let i = 0; i < argv.length; i += 1) {
		const arg = argv[i];
		if (arg === "--json") {
			options.json = true;
			continue;
		}
		if (arg === "--runs-only") {
			options.includeJobs = false;
			continue;
		}
		if (arg === "--jobs") {
			options.includeJobs = true;
			continue;
		}
		if (arg === "--no-official") {
			options.official = false;
			continue;
		}
		if (arg === "--days") {
			options.days = Number(argv[++i]);
			continue;
		}
		if (arg === "--quota") {
			options.quota = Number(argv[++i]);
			continue;
		}
		if (arg === "--year") {
			options.year = Number(argv[++i]);
			continue;
		}
		if (arg === "--month") {
			options.month = Number(argv[++i]);
			continue;
		}
		if (arg === "--billing-user") {
			options.billingUser = argv[++i];
			continue;
		}
		if (arg === "--repos") {
			options.repos = argv[++i]
				.split(",")
				.map((repo) => repo.trim())
				.filter(Boolean);
			continue;
		}
		throw new Error(`Unknown option: ${arg}`);
	}

	if (!Number.isFinite(options.days) || options.days <= 0) {
		throw new Error("--days must be a positive number");
	}
	if (!Number.isFinite(options.quota) || options.quota <= 0) {
		throw new Error("--quota must be a positive number");
	}
	if (!Number.isInteger(options.year) || options.year < 2000) {
		throw new Error("--year must be a four-digit year");
	}
	if (
		!Number.isInteger(options.month) ||
		options.month < 1 ||
		options.month > 12
	) {
		throw new Error("--month must be between 1 and 12");
	}
	if (options.repos.length === 0) {
		throw new Error("--repos must include at least one owner/repo value");
	}
	options.billingUser ??= options.repos[0]?.split("/")[0];
	return options;
}

function ghApi(path) {
	const output = execFileSync(
		"gh",
		[
			"api",
			"-X",
			"GET",
			path,
			"-H",
			`X-GitHub-Api-Version: ${GITHUB_API_VERSION}`,
		],
		{
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
			maxBuffer: 16 * 1024 * 1024,
			env: { ...process.env, GH_PROMPT_DISABLED: "1" },
		},
	);
	return JSON.parse(output);
}

function ghApiOptional(path) {
	try {
		return { data: ghApi(path), error: null };
	} catch (error) {
		return {
			data: null,
			error: error instanceof Error ? error.message : String(error),
		};
	}
}

function minutesBetween(start, end) {
	if (!start || !end) return 0;
	const startedAt = new Date(start).getTime();
	const endedAt = new Date(end).getTime();
	if (!Number.isFinite(startedAt) || !Number.isFinite(endedAt)) return 0;
	return Math.max(0, endedAt - startedAt) / 60000;
}

function usageWindow(days) {
	return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

function fetchRuns(repo, cutoff) {
	const runs = [];
	for (let page = 1; page <= 10; page += 1) {
		const data = ghApi(`repos/${repo}/actions/runs?per_page=100&page=${page}`);
		const pageRuns = data.workflow_runs ?? [];
		if (pageRuns.length === 0) break;

		let allOlder = true;
		for (const run of pageRuns) {
			const createdAt = new Date(run.created_at);
			if (createdAt >= cutoff) {
				runs.push(run);
				allOlder = false;
			}
		}
		if (allOlder) break;
	}
	return runs;
}

function fetchRunJobs(repo, runId) {
	const jobs = [];
	for (let page = 1; page <= 10; page += 1) {
		const data = ghApi(
			`repos/${repo}/actions/runs/${runId}/jobs?per_page=100&page=${page}`,
		);
		const pageJobs = data.jobs ?? [];
		jobs.push(...pageJobs);
		if (pageJobs.length < 100) break;
	}
	return jobs;
}

function estimateRunMinutes(repo, run, includeJobs) {
	if (!includeJobs) {
		return minutesBetween(run.run_started_at ?? run.created_at, run.updated_at);
	}

	try {
		const jobs = fetchRunJobs(repo, run.id);
		const jobMinutes = jobs.reduce(
			(total, job) => total + minutesBetween(job.started_at, job.completed_at),
			0,
		);
		if (jobMinutes > 0 || jobs.length > 0) return jobMinutes;
	} catch {
		return minutesBetween(run.run_started_at ?? run.created_at, run.updated_at);
	}

	return minutesBetween(run.run_started_at ?? run.created_at, run.updated_at);
}

function summarizeRunnerTime(repo, cutoff, includeJobs) {
	const runs = fetchRuns(repo, cutoff);
	const workflowMinutes = new Map();
	const eventMinutes = new Map();
	let totalMinutes = 0;
	let completedRuns = 0;
	let inProgressRuns = 0;

	for (const run of runs) {
		const minutes = estimateRunMinutes(repo, run, includeJobs);
		totalMinutes += minutes;
		workflowMinutes.set(
			run.name,
			(workflowMinutes.get(run.name) ?? 0) + minutes,
		);
		eventMinutes.set(run.event, (eventMinutes.get(run.event) ?? 0) + minutes);
		if (run.status === "completed") completedRuns += 1;
		else inProgressRuns += 1;
	}

	return {
		repo,
		runs: runs.length,
		completedRuns,
		inProgressRuns,
		totalMinutes,
		workflows: [...workflowMinutes.entries()]
			.map(([name, minutes]) => ({ name, minutes }))
			.sort((a, b) => b.minutes - a.minutes),
		events: [...eventMinutes.entries()]
			.map(([event, minutes]) => ({ event, minutes }))
			.sort((a, b) => b.minutes - a.minutes),
	};
}

function officialPath(options, repo) {
	const params = new URLSearchParams({
		year: String(options.year),
		month: String(options.month),
		product: "Actions",
		sku: "actions_linux",
	});
	if (repo) params.set("repository", repo);
	return `users/${options.billingUser}/settings/billing/usage/summary?${params}`;
}

function summarizeOfficialUsage(data) {
	const items = data?.usageItems ?? [];
	const minutes = items.filter(
		(item) =>
			String(item.product).toLowerCase() === "actions" &&
			String(item.unitType).toLowerCase() === "minutes",
	);
	return minutes.reduce(
		(total, item) => ({
			grossQuantity: total.grossQuantity + numberOrZero(item.grossQuantity),
			discountQuantity:
				total.discountQuantity + numberOrZero(item.discountQuantity),
			netQuantity: total.netQuantity + numberOrZero(item.netQuantity),
			grossAmount: total.grossAmount + numberOrZero(item.grossAmount),
			discountAmount: total.discountAmount + numberOrZero(item.discountAmount),
			netAmount: total.netAmount + numberOrZero(item.netAmount),
		}),
		{
			grossQuantity: 0,
			discountQuantity: 0,
			netQuantity: 0,
			grossAmount: 0,
			discountAmount: 0,
			netAmount: 0,
		},
	);
}

function fetchOfficial(options, repo) {
	if (!options.official) return { available: false, error: "disabled" };
	const result = ghApiOptional(officialPath(options, repo));
	if (result.error) return { available: false, error: result.error };
	return {
		available: true,
		period: result.data.timePeriod,
		usage: summarizeOfficialUsage(result.data),
	};
}

function fetchActionsQuota(options) {
	if (!options.official) return { available: false, error: "disabled" };
	const result = ghApiOptional(
		`users/${options.billingUser}/settings/billing/actions`,
	);
	if (result.error) return { available: false, error: result.error };
	const data = result.data;
	return {
		available: true,
		totalMinutesUsed: numberOrZero(data.total_minutes_used),
		totalPaidMinutesUsed: numberOrZero(data.total_paid_minutes_used),
		includedMinutes: numberOrZero(data.included_minutes),
		breakdown: data.minutes_used_breakdown ?? {},
	};
}

function numberOrZero(value) {
	return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function round(value) {
	return Math.round(value * 10) / 10;
}

function billableQuantity(usage) {
	return Math.max(0, numberOrZero(usage?.netQuantity));
}

function formatPercent(value) {
	return `${round(value * 100)}%`;
}

function repoStatus(burn) {
	if (burn > 1) return "OVER ALLOCATION";
	if (burn > 0.8) return "WARN";
	return "OK";
}

function renderHuman(report) {
	const lines = [];
	lines.push("GitHub Actions budget report");
	lines.push(
		`Official billing period: ${report.billing.year}-${String(report.billing.month).padStart(2, "0")}`,
	);
	lines.push(`Runner-time window: ${report.days} day(s)`);
	lines.push(`Quota baseline: ${report.quotaBaseline} min`);
	lines.push(
		`Runner-time estimator: ${report.includeJobs ? "job duration sum" : "workflow wall-clock"}`,
	);
	lines.push("");

	if (report.quota.available) {
		const q = report.quota;
		const burn = q.includedMinutes > 0 ? q.totalMinutesUsed / q.includedMinutes : 0;
		lines.push("Quota (GitHub billing/actions)");
		lines.push(`  included: ${round(q.includedMinutes)} min`);
		lines.push(`  used: ${round(q.totalMinutesUsed)} min`);
		lines.push(`  remaining: ${round(q.includedMinutes - q.totalMinutesUsed)} min`);
		lines.push(`  burn: ${round(burn * 100)}%`);
		if (q.totalPaidMinutesUsed > 0) {
			lines.push(`  paid overage: ${round(q.totalPaidMinutesUsed)} min`);
		}
		const bk = q.breakdown;
		if (Object.keys(bk).length > 0) {
			lines.push(
				`  breakdown: ${Object.entries(bk)
					.map(([os, min]) => `${os}=${round(numberOrZero(min))}`)
					.join(" ")}`,
			);
		}
	} else {
		lines.push(`Quota unavailable: ${report.quota.error}`);
	}
	lines.push("");

	if (report.official.available) {
		lines.push("Cost tracking (usage/summary — all repos, all skus)");
		lines.push(
			`  gross: ${round(report.official.usage.grossQuantity)} min`,
		);
		lines.push(
			`  discounted: ${round(report.official.usage.discountQuantity)} min`,
		);
		lines.push(
			`  net billable: ${round(billableQuantity(report.official.usage))} min  ($${round(report.official.usage.netAmount)})`,
		);
	} else {
		lines.push(`Cost tracking unavailable: ${report.official.error}`);
	}
	lines.push("");

	for (const repo of report.repos) {
		lines.push(`${repo.repo}`);
		lines.push(
			`  runner-time (${report.days}d window): ${round(repo.runner.totalMinutes)} min — ${repo.runner.runs} runs (${repo.runner.completedRuns} done, ${repo.runner.inProgressRuns} active)`,
		);
		if (report.quota.available && report.quota.totalMinutesUsed > 0) {
			lines.push(
				`  runner-time share of account quota: ${formatPercent(repo.runner.totalMinutes / report.quota.totalMinutesUsed)}`,
			);
		}
		if (repo.official.available) {
			lines.push(
				`  billing gross (all skus): ${round(repo.official.usage.grossQuantity)} min`,
			);
		}
		lines.push("  top workflows by runner-time:");
		for (const workflow of repo.runner.workflows.slice(0, 5)) {
			lines.push(`    - ${workflow.name}: ${round(workflow.minutes)} min`);
		}
		lines.push("");
	}

	const quotaLabel = report.quota.available
		? `${round(report.quota.includedMinutes)} min included`
		: `${report.quotaBaseline} min baseline`;
	lines.push(
		`Observed runner-time total: ${round(report.runnerTotalMinutes)} min (${formatPercent(report.runnerQuotaBurn)} of ${quotaLabel})`,
	);
	return lines.join("\n");
}

function main() {
	const options = parseArgs(process.argv.slice(2));
	const cutoff = usageWindow(options.days);
	const officialAccount = fetchOfficial(options);
	const actionsQuota = fetchActionsQuota(options);
	const runnerSummaries = options.repos.map((repo) =>
		summarizeRunnerTime(repo, cutoff, options.includeJobs),
	);
	const runnerTotalMinutes = runnerSummaries.reduce(
		(total, repo) => total + repo.totalMinutes,
		0,
	);
	const officialAccountBillable = officialAccount.available
		? billableQuantity(officialAccount.usage)
		: 0;

	const effectiveQuota = actionsQuota.available
		? actionsQuota.includedMinutes
		: options.quota;

	const report = {
		generatedAt: new Date().toISOString(),
		days: options.days,
		quotaBaseline: options.quota,
		includeJobs: options.includeJobs,
		billing: {
			user: options.billingUser,
			year: options.year,
			month: options.month,
		},
		quota: actionsQuota,
		official: officialAccount,
		runnerTotalMinutes,
		runnerQuotaBurn: effectiveQuota > 0 ? runnerTotalMinutes / effectiveQuota : 0,
		repos: options.repos.map((repo) => {
			const runner = runnerSummaries.find((summary) => summary.repo === repo);
			const official = fetchOfficial(options, repo);
			return {
				repo,
				runner: {
					...runner,
					totalMinutes: round(runner.totalMinutes),
				},
				official,
			};
		}),
	};

	if (options.json) {
		console.log(JSON.stringify(report, null, 2));
		return;
	}
	console.log(renderHuman(report));
}

try {
	main();
} catch (error) {
	console.error(error instanceof Error ? error.message : String(error));
	process.exitCode = 1;
}
