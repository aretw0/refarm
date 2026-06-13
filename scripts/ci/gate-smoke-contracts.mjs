#!/usr/bin/env node
import path from "node:path";
import { createPackageScriptCommand } from "../../packages/config/src/package-manager.js";
import { runSubprocess } from "./subprocess-utils.mjs";

const ROOT = process.cwd();
const plan = process.argv.includes("--plan");

const STEPS = [
	["packages/effort-contract-v1", "build"],
	["packages/effort-contract-v1", "test:unit"],
	["packages/artifact-contract-v1", "build"],
	["packages/artifact-contract-v1", "test:unit"],
	["packages/automation-contract-v1", "build"],
	["packages/automation-contract-v1", "test:unit"],
	["packages/storage-contract-v1", "build"],
	["packages/storage-contract-v1", "test:unit"],
	["packages/sync-contract-v1", "build"],
	["packages/sync-contract-v1", "test:unit"],
	["packages/identity-contract-v1", "build"],
	["packages/identity-contract-v1", "test:unit"],
	["packages/task-contract-v1", "build"],
	["packages/task-contract-v1", "test:unit"],
	["packages/session-contract-v1", "build"],
	["packages/session-contract-v1", "test:unit"],
	["packages/storage-sqlite", "build"],
	["packages/storage-sqlite", "test:conformance"],
	["packages/sync-loro", "build"],
	["packages/sync-loro", "test:conformance"],
];

function commandForStep([workspaceDir, script]) {
	return createPackageScriptCommand({
		cwd: path.resolve(ROOT, workspaceDir),
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
	console.log(`\n[gate:smoke:contracts] ${command.display}`);
	await runSubprocess(command.command, command.args, {
		cwd: ROOT,
		env: process.env,
	});
}
