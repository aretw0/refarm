#!/usr/bin/env node
import { createPackageScriptCommand } from "../../packages/config/src/package-manager.js";
import { parseJsonOutput, runSubprocess } from "./subprocess-utils.mjs";

const ROOT = process.cwd();

const RELEASE_READINESS_STEPS = [
	{
		id: "operator-readiness",
		script: "refarm:check:gate",
		reason: "Composite Refarm health/runtime readiness must pass before release work.",
	},
	{
		id: "release-policy",
		script: "release:policy:check",
		reason: "Release policy selection and required gates must resolve cleanly.",
	},
	{
		id: "node-substrate",
		script: "node-substrate:check",
		reason: "Node/package-manager substrate must match the workspace contract.",
	},
	{
		id: "rust-substrate",
		script: "rust-substrate:check",
		reason: "Rust/crates substrate must be available before crate release work.",
	},
	{
		id: "environment-substrate",
		script: "environment-substrate:check",
		reason: "Container/host environment assumptions must be explicit.",
	},
	{
		id: "derived-artifacts",
		script: "workspace:artifacts:ownership",
		reason: "Generated artifacts must stay derived from source, not manually edited.",
	},
	{
		id: "github-actions-pins",
		script: "actions:pins",
		reason: "Release workflows must keep third-party actions pinned immutably.",
	},
	{
		id: "github-actions-contracts",
		script: "actions:contracts",
		reason: "Reusable workflow and publish contracts must remain valid.",
	},
	{
		id: "publish-dry-run",
		script: "release:check",
		reason: "Workspace package manifests must survive a publish dry-run.",
	},
];

function usage() {
	console.error(
		"Usage: node scripts/ci/release-readiness.mjs [--plan] [--json]",
	);
}

function packageScriptCommand(script) {
	const command = createPackageScriptCommand({
		cwd: ROOT,
		repoRoot: ROOT,
		script,
	});
	return {
		command: command.command,
		args: command.args,
		display: command.display,
	};
}

function buildPlan() {
	return RELEASE_READINESS_STEPS.map((step) => ({
		...step,
		...packageScriptCommand(step.script),
	}));
}

function serializeStep({ id, script, reason, display }) {
	return {
		id,
		script,
		reason,
		command: display,
	};
}

function serializePlan(plan) {
	return plan.map((step) => serializeStep(step));
}

function collectWarningCount(value) {
	if (!value || typeof value !== "object") return 0;
	let count = 0;
	if (
		typeof value.warningCount === "number" &&
		Number.isFinite(value.warningCount)
	) {
		count += value.warningCount;
	}
	if (Array.isArray(value)) {
		for (const entry of value) count += collectWarningCount(entry);
		return count;
	}
	for (const entry of Object.values(value)) {
		count += collectWarningCount(entry);
	}
	return count;
}

function collectRecommendations(value, path = []) {
	if (!value || typeof value !== "object") return [];
	const found = [];
	if (Array.isArray(value)) {
		for (const [index, entry] of value.entries()) {
			found.push(...collectRecommendations(entry, [...path, String(index)]));
		}
		return found;
	}
	if (Array.isArray(value.recommendations)) {
		for (const recommendation of value.recommendations) {
			if (!recommendation || typeof recommendation !== "object") continue;
			found.push({
				path: [...path, "recommendations"].join("."),
				...recommendation,
			});
		}
	}
	for (const [key, entry] of Object.entries(value)) {
		if (key === "recommendations") continue;
		found.push(...collectRecommendations(entry, [...path, key]));
	}
	return found;
}

function summarizeCapturedJson(stdout) {
	if (!stdout) return {};
	try {
		const payload = parseJsonOutput(stdout);
		const warningCount = collectWarningCount(payload);
		const recommendations = collectRecommendations(payload);
		return {
			...(warningCount > 0 ? { warningCount } : {}),
			...(recommendations.length > 0 ? { recommendations } : {}),
		};
	} catch {
		return {};
	}
}

async function runPlan(plan, { json }) {
	const results = [];

	for (const step of plan) {
		if (!json) {
			console.log(`\n[release-readiness] ${step.id}: ${step.display}`);
			console.log(`[release-readiness] ${step.reason}`);
		}

		try {
			const result = await runSubprocess(step.command, step.args, {
				cwd: ROOT,
				env: process.env,
				captureOutput: json,
			});
			const summary = json ? summarizeCapturedJson(result.stdout) : {};
			results.push({
				...serializeStep(step),
				ok: true,
				stdout: result.stdout,
				stderr: result.stderr,
				...summary,
			});
		} catch (error) {
			results.push({
				...serializeStep(step),
				ok: false,
				error: error instanceof Error ? error.message : String(error),
			});
			return { ok: false, failedStepId: step.id, results };
		}
	}

	return { ok: true, failedStepId: null, results };
}

function aggregateResults(results) {
	const warningCount = results.reduce(
		(total, result) => total + (result.warningCount ?? 0),
		0,
	);
	const recommendationKeys = new Set();
	const recommendations = [];
	for (const result of results) {
		for (const recommendation of result.recommendations ?? []) {
			const target = recommendation.target ?? recommendation.workspaceId ?? null;
			const text = recommendation.summary ?? recommendation.message ?? null;
			const key = text
				? JSON.stringify([result.id, target, text])
				: JSON.stringify([
						result.id,
						recommendation.diagnostic,
						recommendation.code,
						target,
						recommendation.action,
						recommendation.command,
						recommendation.nextCommand,
					]);
			if (recommendationKeys.has(key)) continue;
			recommendationKeys.add(key);
			recommendations.push({
				stepId: result.id,
				...recommendation,
			});
		}
	}
	return {
		...(warningCount > 0 ? { warningCount } : {}),
		...(recommendations.length > 0 ? { recommendations } : {}),
	};
}

const args = process.argv.slice(2).filter((arg) => arg !== "--");
const planOnly = args.includes("--plan");
const json = args.includes("--json");
const unknownArgs = args.filter((arg) => arg !== "--plan" && arg !== "--json");

if (unknownArgs.length > 0) {
	console.error(`Unknown argument: ${unknownArgs[0]}`);
	usage();
	process.exit(1);
}

const plan = buildPlan();

if (planOnly) {
	if (json) {
		console.log(
			JSON.stringify(
				{
					ok: true,
					command: "release-readiness",
					mode: "plan",
					steps: serializePlan(plan),
				},
				null,
				2,
			),
		);
		process.exit(0);
	}

	for (const step of plan) {
		console.log(`${step.id}: ${step.display}`);
	}
	process.exit(0);
}

const runResult = await runPlan(plan, { json });
const aggregate = aggregateResults(runResult.results);

if (json) {
	console.log(
		JSON.stringify(
			{
				ok: runResult.ok,
				command: "release-readiness",
				mode: "run",
				failedStepId: runResult.failedStepId,
				steps: serializePlan(plan),
				results: runResult.results,
				...aggregate,
			},
			null,
			2,
		),
	);
}

if (!runResult.ok) process.exit(1);
