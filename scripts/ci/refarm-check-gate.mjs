#!/usr/bin/env node
import path from "node:path";
import { createPackageScriptCommand } from "../../packages/config/src/package-manager.js";
import { runSubprocess } from "./subprocess-utils.mjs";

const ROOT = process.cwd();
const REFARM_CLI = path.join("apps", "refarm", "dist", "index.js");

function usage() {
	console.error(
		"Usage: node scripts/ci/refarm-check-gate.mjs [--plan] <check|health|verify>",
	);
}

const plan = process.argv.includes("--plan");
const mode = process.argv.slice(2).find((arg) => !arg.startsWith("--"));

function workspaceCommand(workspaceDir, script, args = []) {
	const command = createPackageScriptCommand({
		cwd: path.resolve(ROOT, workspaceDir),
		repoRoot: ROOT,
		script,
	});
	const fullArgs = args.length > 0 ? [...command.args, "--", ...args] : command.args;
	const display = args.length > 0
		? `${command.display} -- ${args.join(" ")}`
		: command.display;
	return { ...command, args: fullArgs, display };
}

function nodeCommand(args) {
	return {
		command: process.execPath,
		args,
		display: `node ${args.join(" ")}`,
	};
}

function stepsForMode(selectedMode) {
	const buildSteps = [
		workspaceCommand("packages/health", "build"),
		workspaceCommand("apps/refarm", "build"),
	];

	switch (selectedMode) {
		case "check":
			return [
				...buildSteps,
				nodeCommand([REFARM_CLI, "check", "--json"]),
			];
		case "health":
			return [
				...buildSteps,
				nodeCommand([REFARM_CLI, "health", "--json", "--fail-on-issues"]),
			];
		case "verify":
			return [
				workspaceCommand("packages/health", "test"),
				workspaceCommand("apps/refarm", "test", [
					"test/commands/check.test.ts",
					"test/commands/health.test.ts",
					"test/commands/doctor.test.ts",
					"--pool=threads",
				]),
				workspaceCommand("apps/refarm", "type-check"),
				...stepsForMode("check"),
			];
		default:
			throw new Error(`Unknown refarm check gate mode: ${selectedMode}`);
	}
}

if (!mode) {
	usage();
	process.exit(1);
}

let steps;
try {
	steps = stepsForMode(mode);
} catch (error) {
	console.error(error instanceof Error ? error.message : String(error));
	usage();
	process.exit(1);
}

for (const step of steps) {
	if (plan) {
		console.log(step.display);
		continue;
	}
	console.log(`\n[refarm-check-gate] ${step.display}`);
	await runSubprocess(step.command, step.args, {
		cwd: ROOT,
		env: process.env,
	});
}
