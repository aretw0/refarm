#!/usr/bin/env node
import { createPackageScriptCommand } from "../../packages/config/src/package-manager.js";
import { runSubprocess } from "./subprocess-utils.mjs";

const ROOT = process.cwd();
const plan = process.argv.includes("--plan");
const scripts = process.argv.slice(2).filter((arg) => arg !== "--plan");

function usage() {
	console.error(
		"Usage: node scripts/ci/run-root-scripts.mjs [--plan] <script> [script...]",
	);
}

function commandForScript(script) {
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

if (scripts.length === 0) {
	usage();
	process.exit(1);
}

for (const script of scripts) {
	const command = commandForScript(script);
	if (plan) {
		console.log(command.display);
		continue;
	}
	console.log(`\n[root-script] ${command.display}`);
	await runSubprocess(command.command, command.args, {
		cwd: ROOT,
		env: process.env,
	});
}
