#!/usr/bin/env node
import path from "node:path";
import {
	createPackageScriptCommand,
	packageScriptCommand,
} from "../../packages/config/src/package-manager.js";
import { runSubprocess } from "./subprocess-utils.mjs";

const ROOT = process.cwd();
const plan = process.argv.includes("--plan");

function rootScript(script) {
	const command = packageScriptCommand(script, { cwd: ROOT });
	return {
		command: command.packageManager,
		args: ["run", script],
		cwd: ROOT,
		display: command.display,
	};
}

function workspaceScript(workspaceDir, script) {
	const command = createPackageScriptCommand({
		cwd: path.resolve(ROOT, workspaceDir),
		repoRoot: ROOT,
		script,
	});
	return { ...command, cwd: ROOT };
}

function cargo(args) {
	return {
		command: "cargo",
		args,
		cwd: path.join(ROOT, "packages", "tractor"),
		display: `cargo ${args.join(" ")}`,
	};
}

const STEPS = [
	rootScript("gate:smoke:runtime-host-contracts"),
	cargo(["check", "--quiet"]),
	cargo(["test", "--lib", "agent_tools_bridge", "--quiet"]),
	cargo(["test", "--lib", "plugin_host", "--quiet"]),
	cargo(["test", "--lib", "wasi_bridge", "--quiet"]),
	rootScript("test:smoke:ws"),
	workspaceScript("packages/tractor-ts", "build"),
	workspaceScript("packages/tractor-ts", "type-check"),
	workspaceScript("packages/tractor-ts", "runtime-module:ci"),
];

for (const step of STEPS) {
	if (plan) {
		console.log(step.display);
		continue;
	}
	console.log(`\n[gate:smoke:runtime] ${step.display}`);
	await runSubprocess(step.command, step.args, {
		cwd: step.cwd,
		env: process.env,
	});
}
