#!/usr/bin/env node
import path from "node:path";
import { createPackageScriptCommand } from "../../packages/config/src/package-manager.js";
import {
	ensureWorkspaceTypeDependencyBuilds,
	runSubprocess,
	workspaceTypeDependencyBuildDirs,
} from "./subprocess-utils.mjs";

const ROOT = process.cwd();
const RUN_ENV = {
	...process.env,
	CI: process.env.CI ?? "true",
};

function usage() {
	console.error(
		"Usage: node scripts/ci/run-workspace-script.mjs [--plan] [--with-dependency-builds] <workspace-dir> <script> [-- <args...>]",
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
const withDependencyBuilds = mainArgs.includes("--with-dependency-builds");
if (withDependencyBuilds) {
	mainArgs.splice(mainArgs.indexOf("--with-dependency-builds"), 1);
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
	env: RUN_ENV,
});
const args = forwardedArgs.length > 0
	? [...command.args, ...forwardedArgs]
	: command.args;
const display = forwardedArgs.length > 0
	? `${command.display} ${forwardedArgs.join(" ")}`
	: command.display;

async function dependencyBuildPlan() {
	const workspaceDirs = await workspaceTypeDependencyBuildDirs(workspaceDir);
	return workspaceDirs.map((dependencyDir) => {
		const packageCommand = createPackageScriptCommand({
			cwd: path.resolve(ROOT, dependencyDir),
			repoRoot: ROOT,
			script: "build",
			env: RUN_ENV,
		});
		return packageCommand.display;
	});
}

if (plan) {
	if (withDependencyBuilds) {
		for (const displayBuild of await dependencyBuildPlan()) {
			console.log(displayBuild);
		}
	}
	console.log(display);
	process.exit(0);
}

if (withDependencyBuilds) {
	await ensureWorkspaceTypeDependencyBuilds(workspaceDir, RUN_ENV);
}

console.log(`[workspace-script] ${display}`);
await runSubprocess(command.command, args, {
	cwd: ROOT,
	env: RUN_ENV,
});
