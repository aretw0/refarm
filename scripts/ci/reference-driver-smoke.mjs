#!/usr/bin/env node
import { createPackageScriptCommand } from "../../packages/config/src/package-manager.js";
import { runSubprocess } from "./subprocess-utils.mjs";

const ROOT = process.cwd();
const plan = process.argv.includes("--plan");

const STEPS = [
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

function commandForStep(step) {
	if (step.packageScript) {
		const command = createPackageScriptCommand({
			cwd: step.packageScript.cwd,
			repoRoot: ROOT,
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

for (const step of STEPS) {
	const command = commandForStep(step);
	if (plan) {
		console.log(`${step.id}: ${command.display}`);
		continue;
	}
	console.log(`\n[reference-driver:smoke] ${step.id}: ${command.display}`);
	await runSubprocess(command.command, command.args, {
		cwd: ROOT,
		env: process.env,
	});
}
