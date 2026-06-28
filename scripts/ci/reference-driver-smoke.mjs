#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createPackageScriptCommand } from "../../packages/config/src/package-manager.js";
import { runSubprocess } from "./subprocess-utils.mjs";

const ROOT = process.cwd();

const STEPS = [
	{
		id: "worker-profile",
		packageScript: {
			cwd: "packages/cli",
			script: "test:worker-profile",
		},
	},
	{
		id: "structured-io",
		display:
			"cargo test --manifest-path packages/agent-tools/Cargo.toml --lib structured_io --quiet",
		command: "cargo",
		args: [
			"test",
			"--manifest-path",
			"packages/agent-tools/Cargo.toml",
			"--lib",
			"structured_io",
			"--quiet",
		],
	},
	{
		id: "session-tree",
		packageScript: {
			cwd: "apps/refarm",
			script: "test:tree-reference-driver",
		},
	},
	{
		id: "code-ops-wit",
		packageScript: {
			cwd: "packages/pi-agent",
			script: "check:wit",
		},
	},
	{
		id: "code-ops",
		display:
			"cargo test --manifest-path packages/tractor/Cargo.toml --lib code_ops --quiet -- --test-threads=1",
		command: "cargo",
		args: [
			"test",
			"--manifest-path",
			"packages/tractor/Cargo.toml",
			"--lib",
			"code_ops",
			"--quiet",
			"--",
			"--test-threads=1",
		],
	},
];

function commandForStep(step, root = ROOT) {
	if (step.packageScript) {
		const command = createPackageScriptCommand({
			cwd: step.packageScript.cwd,
			repoRoot: root,
			script: step.packageScript.script,
		});
		return {
			command: command.command,
			args: command.args,
			display: command.display,
		};
	}
	return step;
}

export function buildReferenceDriverSmokePlan(root = ROOT) {
	return STEPS.map((step) => ({
		...step,
		...commandForStep(step, root),
	}));
}

function isMain() {
	return process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
}

if (isMain()) {
	const plan = process.argv.includes("--plan");

	for (const step of buildReferenceDriverSmokePlan()) {
		if (plan) {
			console.log(`${step.id}: ${step.display}`);
			continue;
		}
		console.log(`\n[reference-driver:smoke] ${step.id}: ${step.display}`);
		await runSubprocess(step.command, step.args, {
			cwd: ROOT,
			env: process.env,
		});
	}
}
