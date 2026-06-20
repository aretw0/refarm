#!/usr/bin/env node
import { createPackageScriptCommand } from "../../packages/config/src/package-manager.js";
import { runSubprocess } from "./subprocess-utils.mjs";

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

const args = process.argv.slice(2);
const planOnly = args.includes("--plan");
const json = args.includes("--json");
const unknownArgs = args.filter((arg) => arg !== "--plan" && arg !== "--json");

if (unknownArgs.length > 0) {
	console.error(`Unknown argument: ${unknownArgs[0]}`);
	usage();
	process.exit(1);
}

const plan = buildPlan();

if (json) {
	console.log(
		JSON.stringify(
			{
				ok: true,
				command: "release-readiness",
				mode: planOnly ? "plan" : "run",
				steps: plan.map(({ id, script, reason, display }) => ({
					id,
					script,
					reason,
					command: display,
				})),
			},
			null,
			2,
		),
	);
	if (planOnly) process.exit(0);
}

if (planOnly) {
	for (const step of plan) {
		console.log(`${step.id}: ${step.display}`);
	}
	process.exit(0);
}

for (const step of plan) {
	console.log(`\n[release-readiness] ${step.id}: ${step.display}`);
	console.log(`[release-readiness] ${step.reason}`);
	await runSubprocess(step.command, step.args, {
		cwd: ROOT,
		env: process.env,
	});
}
