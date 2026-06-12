#!/usr/bin/env node
import path from "node:path";
import { createPackageScriptCommand } from "../../packages/config/src/package-manager.js";
import { runSubprocess } from "./subprocess-utils.mjs";

const ROOT = process.cwd();
const plan = process.argv.includes("--plan");

const STEPS = [
	["packages/effort-contract-v1", "test:unit"],
	["packages/artifact-contract-v1", "test:unit"],
	["packages/automation-contract-v1", "test:unit"],
	["packages/storage-contract-v1", "test:unit"],
	["packages/sync-contract-v1", "test:unit"],
	["packages/identity-contract-v1", "test:unit"],
	["packages/task-contract-v1", "test:unit"],
	["packages/session-contract-v1", "test:unit"],
	["packages/plugin-manifest", "test:conformance"],
	["packages/storage-sqlite", "test:conformance"],
	["packages/storage-memory", "test:conformance"],
	["packages/storage-rest", "test:conformance"],
	["packages/sync-loro", "test:conformance"],
	["packages/sync-crdt", "test:conformance"],
	["packages/identity-nostr", "test:conformance"],
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
	console.log(`\n[test:capabilities] ${command.display}`);
	await runSubprocess(command.command, command.args, {
		cwd: ROOT,
		env: process.env,
	});
}
