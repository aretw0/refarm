#!/usr/bin/env node
import { access, readFile } from "node:fs/promises";
import { readdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { packageFrozenInstallCommand } from "@refarm.dev/config";

const ROOT = process.cwd();

function usage() {
	console.error("Usage: node scripts/ci/check-node-substrate.mjs [--json]");
}

const platform = process.env.REFARM_NODE_SUBSTRATE_PLATFORM ?? process.platform;
const allowLocalRebuild = process.env.REFARM_NODE_SUBSTRATE_ALLOW_REBUILD === "1";

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

function nodeSubstrateInstallCommand() {
	const command = packageFrozenInstallCommand({ cwd: ROOT, env: process.env });
	if (command.packageManager !== "pnpm") return command.display;
	return `${command.display} --config.confirm-modules-purge=false`;
}

async function readJson(filePath) {
	try {
		return JSON.parse(await readFile(filePath, "utf8"));
	} catch {
		return null;
	}
}

async function readDevcontainerNodeModulesTarget() {
	try {
		const raw = await readFile(path.join(ROOT, ".devcontainer", "devcontainer.json"), "utf8");
		const config = JSON.parse(raw);
		const mounts = Array.isArray(config.mounts) ? config.mounts : [];
		for (const mount of mounts) {
			if (typeof mount !== "string") continue;
			const fields = Object.fromEntries(
				mount.split(",").map((field) => {
					const index = field.indexOf("=");
					if (index === -1) return [field.trim(), ""];
					return [field.slice(0, index).trim(), field.slice(index + 1).trim()];
				}),
			);
			if (fields.source !== "refarm-node-modules") continue;
			if (!fields.target) continue;
			const target = path.resolve(fields.target);
			if (target === path.resolve(ROOT, "node_modules")) return target;
		}
	} catch {
		return null;
	}
	return null;
}

function decodeMountInfoPath(value) {
	return value.replace(/\\([0-7]{3})/g, (_, octal) =>
		String.fromCharCode(Number.parseInt(octal, 8)),
	);
}

async function readMountPoints() {
	if (platform !== "linux") return [];
	const override = process.env.REFARM_NODE_SUBSTRATE_MOUNTINFO;
	const content = override ?? await readFile("/proc/self/mountinfo", "utf8");
	return content
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean)
		.map((line) => line.split(" - ")[0]?.split(" ")[4])
		.filter(Boolean)
		.map(decodeMountInfoPath)
		.map((mountPoint) => path.resolve(mountPoint));
}

async function devcontainerNodeModulesMountCheck() {
	const target = await readDevcontainerNodeModulesTarget();
	if (!target) return null;
	const mountPoints = await readMountPoints();
	return {
		id: "devcontainer_node_modules_mount",
		ok: mountPoints.includes(target),
		path: "node_modules",
		target,
	};
}

function binName(name) {
	return platform === "win32" ? `${name}.cmd` : name;
}

function foreignBinNames(name) {
	return platform === "win32" ? [name] : [`${name}.cmd`];
}

function compactList(items, limit = 20) {
	return items.slice(0, limit);
}

function printCompactIssues(items, formatItem, moreLabel, limit = 20, totalCount = items.length) {
	for (const item of items.slice(0, limit)) {
		console.error(formatItem(item));
	}
	const remaining = totalCount - limit;
	if (remaining > 0) {
		console.error(`  ... ${remaining} more ${moreLabel}`);
	}
}

function workspacePackageDirs() {
	const dirs = [];
	for (const workspaceDir of ["apps", "packages"]) {
		const absolute = path.join(ROOT, workspaceDir);
		try {
			for (const entry of readdirSync(absolute, { withFileTypes: true })) {
				if (!entry.isDirectory()) continue;
				dirs.push(path.join(absolute, entry.name));
			}
		} catch {
			// Optional workspace groups are allowed to be absent.
		}
	}
	return dirs;
}

async function runtimeDependencyChecks() {
	const results = [];
	for (const packageDir of workspacePackageDirs()) {
		const manifestPath = path.join(packageDir, "package.json");
		const manifest = await readJson(manifestPath);
		if (!manifest || !manifest.bin || !manifest.dependencies) continue;
		const relativePackageDir = path.relative(ROOT, packageDir).replaceAll(path.sep, "/");
		const requireFromPackage = createRequire(manifestPath);
		for (const [dependency, version] of Object.entries(manifest.dependencies).sort()) {
			if (typeof version === "string" && version.startsWith("workspace:")) continue;
			try {
				requireFromPackage.resolve(dependency);
				results.push({
					id: `runtime_dep_${manifest.name ?? relativePackageDir}_${dependency}`,
					ok: true,
					package: manifest.name ?? relativePackageDir,
					dependency,
					path: relativePackageDir,
				});
			} catch {
				results.push({
					id: `runtime_dep_${manifest.name ?? relativePackageDir}_${dependency}`,
					ok: false,
					package: manifest.name ?? relativePackageDir,
					dependency,
					path: relativePackageDir,
				});
			}
		}
	}
	return results;
}

async function workspaceDependencyLinkChecks() {
	const results = [];
	for (const packageDir of workspacePackageDirs()) {
		const manifestPath = path.join(packageDir, "package.json");
		const manifest = await readJson(manifestPath);
		if (!manifest) continue;
		const relativePackageDir = path.relative(ROOT, packageDir).replaceAll(path.sep, "/");
		const packageName = manifest.name ?? relativePackageDir;
		const dependencyGroups = [
			manifest.dependencies ?? {},
			manifest.devDependencies ?? {},
		];
		for (const dependencies of dependencyGroups) {
			for (const [dependency, version] of Object.entries(dependencies).sort()) {
				if (typeof version !== "string" || !version.startsWith("workspace:")) continue;
				const dependencyPackageJson = path.join(packageDir, "node_modules", dependency, "package.json");
				results.push({
					id: `workspace_dep_${packageName}_${dependency}`,
					ok: await exists(dependencyPackageJson),
					package: packageName,
					dependency,
					path: relativePackageDir,
				});
			}
		}
	}
	return results;
}

export async function checkNodeSubstrate() {
	const requiredBins = ["vitest", "tsc", "eslint"];
	const checks = [];
	const foreignPlatformShims = [];
	const workspaceLinkChecks = await workspaceDependencyLinkChecks();
	const runtimeChecks = await runtimeDependencyChecks();
	const devcontainerMountCheck = await devcontainerNodeModulesMountCheck();

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
	const missingWorkspaceDependencyLinks = workspaceLinkChecks.filter((check) => !check.ok);
	const missingRuntimeDependencies = runtimeChecks.filter((check) => !check.ok);
	const mountIssues = devcontainerMountCheck?.ok === false ? [devcontainerMountCheck] : [];
	const packageManager = await readPackageManager();
	const installCommand = nodeSubstrateInstallCommand();
	const environmentCommand = "Run validation inside the environment that owns this node_modules tree, or rebuild/reopen the devcontainer so node_modules is isolated per platform.";
	const workspaceMaterializationCommand = allowLocalRebuild
		? installCommand
		: "Current checkout appears to be materialized for another environment. Use a separate checkout for this platform, or set REFARM_NODE_SUBSTRATE_ALLOW_REBUILD=1 before rebuilding node_modules here.";
	const sharedWorkspaceMaterialization = platform === "win32" && missingWorkspaceDependencyLinks.length > 20;
	const primaryNextAction = foreignPlatformShims.length > 0 || mountIssues.length > 0
		? environmentCommand
		: sharedWorkspaceMaterialization
			? workspaceMaterializationCommand
		: installCommand;
	const executableNextCommand =
		primaryNextAction === installCommand ? installCommand : null;
	const recommendations = missing.length > 0 || mountIssues.length > 0
		? foreignPlatformShims.length > 0 || mountIssues.length > 0
			? [
				environmentCommand,
				"Do not run package-manager install from this platform against the current shared node_modules tree.",
			]
			: [
				installCommand,
				"Rebuild/reopen the devcontainer if Linux and Windows are sharing the same node_modules tree.",
			]
		: [];
	if (
		(missingWorkspaceDependencyLinks.length > 0 || missingRuntimeDependencies.length > 0) &&
		!recommendations.includes(primaryNextAction)
	) {
		recommendations.push(primaryNextAction);
	}
	const executableNextCommands = executableNextCommand ? [executableNextCommand] : [];
	return {
		ok: missing.length === 0 &&
			missingWorkspaceDependencyLinks.length === 0 &&
			missingRuntimeDependencies.length === 0 &&
			mountIssues.length === 0,
		platform,
		actualPlatform: process.platform,
		packageManager,
		workspaceMaterialization: sharedWorkspaceMaterialization
			? {
				id: "shared_workspace_node_modules_materialization",
				ok: false,
				platform,
				missingWorkspaceDependencyLinkCount: missingWorkspaceDependencyLinks.length,
				localRebuildOptIn: allowLocalRebuild,
				localRebuildCommand: installCommand,
				recommendation: workspaceMaterializationCommand,
			}
			: null,
		checks,
		missing,
		workspaceLinkCount: workspaceLinkChecks.length,
		missingWorkspaceDependencyLinkCount: missingWorkspaceDependencyLinks.length,
		missingWorkspaceDependencyLinks: compactList(missingWorkspaceDependencyLinks),
		runtimeChecks,
		missingRuntimeDependencyCount: missingRuntimeDependencies.length,
		missingRuntimeDependencies: compactList(missingRuntimeDependencies),
		foreignPlatformShims,
		mountIssues,
		recommendations,
		command: "node-substrate",
		operation: "check",
		nextAction: missing.length > 0 || missingWorkspaceDependencyLinks.length > 0 || missingRuntimeDependencies.length > 0 || mountIssues.length > 0 ? primaryNextAction : null,
		nextActions: recommendations,
		nextCommand: missing.length > 0 || missingWorkspaceDependencyLinks.length > 0 || missingRuntimeDependencies.length > 0 || mountIssues.length > 0 ? executableNextCommand : null,
		nextCommands: missing.length > 0 || missingWorkspaceDependencyLinks.length > 0 || missingRuntimeDependencies.length > 0 || mountIssues.length > 0 ? executableNextCommands : [],
	};
}

async function main() {
	const json = process.argv.includes("--json");
	const unknownArgs = process.argv.slice(2).filter((arg) => arg !== "--json");
	if (unknownArgs.length > 0) {
		usage();
		process.exit(1);
	}

	const result = await checkNodeSubstrate();
	if (json) {
		console.log(JSON.stringify(result, null, 2));
	} else if (result.ok) {
		console.log("node-substrate: OK");
	} else {
		console.error("node-substrate: missing package-manager execution substrate");
		for (const check of result.missing) {
			console.error(`  missing: ${check.path}`);
		}
		for (const shim of result.foreignPlatformShims) {
			console.error(`  platform mismatch: expected ${shim.expected}, found ${shim.found}`);
		}
		printCompactIssues(
			result.missingWorkspaceDependencyLinks,
			(dependency) => `  unresolved workspace dependency link: ${dependency.package} -> ${dependency.dependency}`,
			"workspace dependency link(s)",
			20,
			result.missingWorkspaceDependencyLinkCount,
		);
		printCompactIssues(
			result.missingRuntimeDependencies,
			(dependency) => `  unresolved runtime dependency: ${dependency.package} -> ${dependency.dependency}`,
			"runtime dependency issue(s)",
			20,
			result.missingRuntimeDependencyCount,
		);
		for (const issue of result.mountIssues) {
			console.error(`  mount mismatch: expected ${issue.target} to be a dedicated mount`);
		}
		console.error(`  next: ${result.nextAction}`);
		const secondaryRecommendation = result.recommendations.find(
			(recommendation) => recommendation !== result.nextAction,
		);
		if (result.foreignPlatformShims.length === 0 && result.mountIssues.length === 0 && secondaryRecommendation) {
			console.error(`  also: ${secondaryRecommendation}`);
		}
	}

	process.exit(result.ok ? 0 : 1);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
	await main();
}
