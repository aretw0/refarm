#!/usr/bin/env node
import path from "node:path";
import { createPackageScriptCommand } from "../../packages/config/src/package-manager.js";
import { runSubprocess } from "./subprocess-utils.mjs";

const ROOT = process.cwd();

function usage() {
	console.error(
		"Usage: node scripts/ci/run-workspace-script.mjs [--plan] <workspace-dir> <script> [-- <args...>]",
	);
}

const separatorIndex = process.argv.indexOf("--");
const mainArgs =
	separatorIndex >= 0 ? process.argv.slice(2, separatorIndex) : process.argv.slice(2);
const forwardedArgs =
	separatorIndex >= 0 ? process.argv.slice(separatorIndex + 1) : [];
const plan = mainArgs.includes("--plan");
if (plan) {
	mainArgs.splice(mainArgs.indexOf("--plan"), 1);
}
const [workspaceDir, script] = mainArgs;

if (!workspaceDir || !script || mainArgs.length > 2) {
	usage();
	process.exit(1);
}

const command = createPackageScriptCommand({
	cwd: path.resolve(ROOT, workspaceDir),
	repoRoot: ROOT,
	script,
});
const args = forwardedArgs.length > 0
	? [...command.args, "--", ...forwardedArgs]
	: command.args;
const display = forwardedArgs.length > 0
	? `${command.display} -- ${forwardedArgs.join(" ")}`
	: command.display;

if (plan) {
	console.log(display);
	process.exit(0);
}

console.log(`[workspace-script] ${display}`);
await runSubprocess(command.command, args, {
	cwd: ROOT,
	env: process.env,
});
