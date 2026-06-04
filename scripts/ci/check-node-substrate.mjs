#!/usr/bin/env node
import { access, readFile } from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();

function usage() {
	console.error("Usage: node scripts/ci/check-node-substrate.mjs [--json]");
}

const json = process.argv.includes("--json");
const unknownArgs = process.argv.slice(2).filter((arg) => arg !== "--json");
if (unknownArgs.length > 0) {
	usage();
	process.exit(1);
}

async function exists(filePath) {
	try {
		await access(filePath);
		return true;
	} catch {
		return false;
	}
}

async function readPackageManager() {
	try {
		const pkg = JSON.parse(await readFile(path.join(ROOT, "package.json"), "utf8"));
		return pkg.packageManager ?? null;
	} catch {
		return null;
	}
}

function binName(name) {
	return process.platform === "win32" ? `${name}.cmd` : name;
}

function foreignBinNames(name) {
	return process.platform === "win32" ? [name] : [`${name}.cmd`];
}

const requiredBins = ["vitest", "tsc", "eslint"];
const checks = [];
const foreignPlatformShims = [];

checks.push({
	id: "node_modules",
	ok: await exists(path.join(ROOT, "node_modules")),
	path: "node_modules",
});

checks.push({
	id: "node_modules_bin",
	ok: await exists(path.join(ROOT, "node_modules", ".bin")),
	path: "node_modules/.bin",
});

for (const binary of requiredBins) {
	const expectedPath = path.join(ROOT, "node_modules", ".bin", binName(binary));
	const ok = await exists(expectedPath);
	checks.push({
		id: `bin_${binary}`,
		ok,
		path: `node_modules/.bin/${binName(binary)}`,
	});

	if (!ok) {
		for (const foreignName of foreignBinNames(binary)) {
			const foreignPath = path.join(ROOT, "node_modules", ".bin", foreignName);
			if (await exists(foreignPath)) {
				foreignPlatformShims.push({
					binary,
					expected: `node_modules/.bin/${binName(binary)}`,
					found: `node_modules/.bin/${foreignName}`,
				});
			}
		}
	}
}

const missing = checks.filter((check) => !check.ok);
const packageManager = await readPackageManager();
const installCommand = packageManager?.startsWith("pnpm")
	? "pnpm install --frozen-lockfile --config.confirm-modules-purge=false"
	: "npm install";
const environmentCommand = "Run validation inside the environment that owns this node_modules tree, or rebuild/reopen the devcontainer so node_modules is isolated per platform.";
const primaryNextCommand = foreignPlatformShims.length > 0 ? environmentCommand : installCommand;
const recommendations = missing.length > 0
	? foreignPlatformShims.length > 0
		? [
			environmentCommand,
			"Do not run package-manager install from this platform against the current shared node_modules tree.",
		]
		: [
			installCommand,
			"Rebuild/reopen the devcontainer if Linux and Windows are sharing the same node_modules tree.",
		]
	: [];
const result = {
	ok: missing.length === 0,
	platform: process.platform,
	packageManager,
	checks,
	missing,
	foreignPlatformShims,
	recommendations,
	command: "node-substrate",
	operation: "check",
	nextAction: missing.length > 0 ? primaryNextCommand : null,
	nextActions: recommendations,
	nextCommand: missing.length > 0 ? primaryNextCommand : null,
	nextCommands: recommendations,
};

if (json) {
	console.log(JSON.stringify(result, null, 2));
} else if (result.ok) {
	console.log("node-substrate: OK");
} else {
	console.error("node-substrate: missing package-manager execution substrate");
	for (const check of missing) {
		console.error(`  missing: ${check.path}`);
	}
	for (const shim of foreignPlatformShims) {
		console.error(`  platform mismatch: expected ${shim.expected}, found ${shim.found}`);
	}
	console.error(`  next: ${primaryNextCommand}`);
	if (foreignPlatformShims.length === 0) {
		console.error(`  if this is a devcontainer on Windows, ${recommendations.at(1)}`);
	}
}

process.exit(result.ok ? 0 : 1);
