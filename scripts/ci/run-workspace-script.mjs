#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
	createPackageScriptCommand,
	detectPackageManager,
} from "../../packages/config/src/package-manager.js";
import { runSubprocess } from "./subprocess-utils.mjs";

const ROOT = process.cwd();

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
});
const args = forwardedArgs.length > 0
	? [...command.args, ...forwardedArgs]
	: command.args;
const display = forwardedArgs.length > 0
	? `${command.display} ${forwardedArgs.join(" ")}`
	: command.display;

async function dependencyBuildCommand() {
	const packageManager = detectPackageManager({ cwd: ROOT, env: process.env });
	if (packageManager !== "pnpm") {
		throw new Error(
			`--with-dependency-builds requires pnpm workspace filtering; detected ${packageManager}`,
		);
	}
	const manifest = JSON.parse(
		await readFile(path.join(ROOT, workspaceDir, "package.json"), "utf8"),
	);
	if (!manifest?.name) {
		throw new Error(`${workspaceDir}/package.json is missing a package name`);
	}
	return {
		command: "pnpm",
		args: ["--filter", `${manifest.name}...`, "run", "build"],
		display: `pnpm --filter ${manifest.name}... run build`,
	};
}

if (plan) {
	if (withDependencyBuilds) {
		console.log((await dependencyBuildCommand()).display);
	}
	console.log(display);
	process.exit(0);
}

if (withDependencyBuilds) {
	const build = await dependencyBuildCommand();
	console.log(`[workspace-script] ${build.display}`);
	await runSubprocess(build.command, build.args, {
		cwd: ROOT,
		env: process.env,
	});
}

console.log(`[workspace-script] ${display}`);
await runSubprocess(command.command, args, {
	cwd: ROOT,
	env: process.env,
});
