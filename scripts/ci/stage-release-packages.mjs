#!/usr/bin/env node
/**
 * Stages exactly the public packages whose version changed in a main push.
 *
 * Changesets creates the version PR; this is deliberately independent from
 * `changeset publish`, which cannot use npm's stage-only OIDC permission.
 */
import { spawnSync } from "node:child_process";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "../..");
const NPM_VERSION = "11.15.0";

export function parseStageReleaseArgs(argv = []) {
	const options = { base: null, head: "HEAD", plan: false, json: false };
	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		if (arg === "--base" || arg === "--head") {
			const value = argv[index + 1];
			if (!value || value.startsWith("--")) throw new Error(`${arg} requires a revision`);
			options[arg.slice(2)] = value;
			index += 1;
		} else if (arg === "--plan") options.plan = true;
		else if (arg === "--json") options.json = true;
		else throw new Error(`Unknown stage-release option: ${arg}`);
	}
	if (!options.base) throw new Error("--base is required");
	return options;
}

function git(args, { cwd = ROOT, spawn = spawnSync } = {}) {
	const result = spawn("git", args, { cwd, encoding: "utf8" });
	if (result.status !== 0) {
		throw new Error((result.stderr || result.stdout || `git ${args.join(" ")} failed`).trim());
	}
	return result.stdout;
}

function manifestAt(revision, relativePath, { cwd = ROOT, spawn = spawnSync } = {}) {
	const result = spawn("git", ["show", `${revision}:${relativePath}`], { cwd, encoding: "utf8" });
	if (result.status === 0) return JSON.parse(result.stdout);
	const detail = result.stderr || result.stdout || "";
	if (/does not exist|exists on disk, but not in/i.test(detail)) return null;
	throw new Error(detail.trim() || `git show ${revision}:${relativePath} failed`);
}

function changedManifestPaths(base, head, options) {
	return git(["diff", "--name-only", base, head, "--", "packages"], options)
		.split("\n")
		.filter((file) => /^packages\/[^/]+\/package\.json$/.test(file));
}

export function buildStageReleasePlan({ base, head = "HEAD", cwd = ROOT, spawn = spawnSync } = {}) {
	if (!base) throw new Error("base is required");
	const options = { cwd, spawn };
	const packages = [];
	for (const manifestPath of changedManifestPaths(base, head, options)) {
		const before = manifestAt(base, manifestPath, options);
		const after = manifestAt(head, manifestPath, options);
		if (!after || before?.version === after.version || after.private === true || after.publishConfig?.access !== "public") continue;
		const packageDir = path.dirname(manifestPath);
		const absolutePackageDir = path.resolve(cwd, packageDir);
		if (!absolutePackageDir.startsWith(`${path.resolve(cwd, "packages")}${path.sep}`)) {
			throw new Error(`Refusing package path outside packages/: ${packageDir}`);
		}
		packages.push({ name: after.name, version: after.version, packageDir });
	}
	return { base, head, npmVersion: `>=${NPM_VERSION}`, packages };
}

export function stageReleasePackages(plan, { cwd = ROOT, spawn = spawnSync } = {}) {
	for (const pkg of plan.packages) {
		const result = spawn("npx", ["--yes", `npm@^${NPM_VERSION}`, "stage", "publish", "--access", "public"], {
			cwd: path.resolve(cwd, pkg.packageDir),
			stdio: "inherit",
		});
		if (result.status !== 0) throw new Error(`${pkg.name}@${pkg.version} stage publish failed`);
	}
}

function printPlan(plan, json) {
	if (json) return console.log(JSON.stringify(plan, null, 2));
	if (plan.packages.length === 0) return console.log("[stage-release] no public package version changed");
	for (const pkg of plan.packages) console.log(`[stage-release] ${pkg.name}@${pkg.version} (${pkg.packageDir})`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
	try {
		const options = parseStageReleaseArgs(process.argv.slice(2));
		const plan = buildStageReleasePlan(options);
		printPlan(plan, options.json || options.plan);
		if (!options.plan) stageReleasePackages(plan);
	} catch (error) {
		console.error(`[stage-release] ${error instanceof Error ? error.message : String(error)}`);
		process.exitCode = 1;
	}
}
