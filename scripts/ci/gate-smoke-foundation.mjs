#!/usr/bin/env node
import path from "node:path";
import { createPackageScriptCommand } from "../../packages/config/src/package-manager.js";
import { runSubprocess } from "./subprocess-utils.mjs";

const ROOT = process.cwd();

const STEPS = [
	{ workspace: "packages/cli", script: "type-check" },
	{ workspace: "packages/config", script: "test" },
	{ workspace: "packages/toolbox", script: "test" },
	{ workspace: "packages/vtconfig", script: "test" },
];

function hasArg(flag) {
	return process.argv.includes(flag);
}

function commandForStep(step) {
	return createPackageScriptCommand({
		cwd: path.resolve(ROOT, step.workspace),
		repoRoot: ROOT,
		script: step.script,
	});
}

if (hasArg("--plan")) {
	for (const step of STEPS) {
		console.log(commandForStep(step).display);
	}
	process.exit(0);
}

for (const step of STEPS) {
	const command = commandForStep(step);
	console.log(`\n[gate:smoke:foundation] ${command.display}`);
	await runSubprocess(command.command, command.args, {
		cwd: ROOT,
		env: process.env,
	});
}
