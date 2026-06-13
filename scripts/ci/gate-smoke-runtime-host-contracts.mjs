#!/usr/bin/env node
import path from "node:path";
import { createPackageScriptCommand } from "../../packages/config/src/package-manager.js";
import { runSubprocess } from "./subprocess-utils.mjs";
import { readWorkspacePackages } from "./workspace-packages.mjs";

const ROOT = process.cwd();
const plan = process.argv.includes("--plan");

const STEPS = [
	["@refarm.dev/runtime", "build"],
	["@refarm.dev/homestead", "build"],
	["@refarm.dev/sower", "build"],
	["@refarm.dev/scarecrow", "build"],
	["@refarm.dev/plugin-courier", "build"],
	["@refarm.dev/scarecrow", "test"],
	["@refarm.dev/plugin-courier", "test"],
	["@refarm.dev/app", "type-check"],
	["@refarm.me/app", "type-check"],
];

const workspaceByName = new Map(
	readWorkspacePackages(ROOT).map((workspace) => [workspace.name, workspace]),
);

function commandForStep([workspaceName, script]) {
	const workspace = workspaceByName.get(workspaceName);
	if (!workspace?.path) {
		throw new Error(`Workspace package not found: ${workspaceName}`);
	}
	return createPackageScriptCommand({
		cwd: path.resolve(workspace.path),
		repoRoot: ROOT,
		script,
	});
}

for (const step of STEPS) {
	const command = commandForStep(step);
	if (plan) {
		console.log(command.display);
		continue;
	}
	console.log(`\n[gate:smoke:runtime-host-contracts] ${command.display}`);
	await runSubprocess(command.command, command.args, {
		cwd: ROOT,
		env: process.env,
	});
}
