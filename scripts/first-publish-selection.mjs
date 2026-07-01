#!/usr/bin/env node
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { detectPackageManager, packageManagerSpawnCommand } from "../packages/config/src/package-manager.js";
import { buildReleaseCheckPlan } from "./release-check.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_SELECTION = "vault-seed-ready";
const FIRST_PUBLISH_VERSION = "0.1.0";

export function parseFirstPublishArgs(argv = []) {
	const options = {
		selectionId: DEFAULT_SELECTION,
		packageNames: [],
		publish: false,
		confirm: "",
		json: false,
		planOnly: false,
	};

	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		if (arg === "--") {
			continue;
		}
		if (arg === "--selection") {
			options.selectionId = requireValue(argv, index, arg);
			index += 1;
			continue;
		}
		if (arg === "--package") {
			options.packageNames.push(requireValue(argv, index, arg));
			index += 1;
			continue;
		}
		if (arg === "--publish") {
			options.publish = true;
			continue;
		}
		if (arg === "--confirm") {
			options.confirm = requireValue(argv, index, arg);
			index += 1;
			continue;
		}
		if (arg === "--json") {
			options.json = true;
			continue;
		}
		if (arg === "--plan") {
			options.planOnly = true;
			continue;
		}
		throw new Error(`Unknown first-publish argument: ${arg}`);
	}

	return options;
}

function requireValue(argv, index, flag) {
	const value = argv[index + 1];
	if (!value || value.startsWith("--")) {
		throw new Error(`${flag} requires a value`);
	}
	return value;
}

export function firstPublishConfirmValue(selectionId = DEFAULT_SELECTION) {
	return `publish-${selectionId}-${FIRST_PUBLISH_VERSION}`;
}

export function buildFirstPublishPlan({
	cwd = ROOT,
	env = process.env,
	selectionId = DEFAULT_SELECTION,
	packageNames = [],
	publish = false,
	confirm = "",
} = {}) {
	const releaseCheck = buildReleaseCheckPlan({
		cwd,
		env,
		selectionId,
		packageNames,
	});
	if (!releaseCheck.ok) {
		throw new Error(`release plan is not accepted for selection "${selectionId}"`);
	}

	const versionMismatches = releaseCheck.plan.orderedPackages
		.filter((pkg) => pkg.currentVersion !== FIRST_PUBLISH_VERSION)
		.map((pkg) => `${pkg.name}@${pkg.currentVersion ?? "(unknown)"}`);
	if (versionMismatches.length > 0) {
		throw new Error(
			`first-publish lane requires all selected packages to be ${FIRST_PUBLISH_VERSION}: ${versionMismatches.join(", ")}`,
		);
	}

	const requiredConfirmation = firstPublishConfirmValue(selectionId);
	if (publish && confirm !== requiredConfirmation) {
		throw new Error(`publishing requires --confirm ${requiredConfirmation}`);
	}

	const packageManager = detectPackageManager({ cwd, env });
	const commands = releaseCheck.plan.orderedPackages.map((pkg) => {
		const packageDir = path.join("packages", pkg.packageDir);
		const packageCwd = path.join(cwd, packageDir);
		const command = publish
			? firstPublishCommand(packageManager)
			: firstPublishDryRunCommand(packageManager);
		return {
			packageName: pkg.name,
			version: pkg.currentVersion,
			packageDir,
			cwd: packageCwd,
			packageManager,
			...command,
		};
	});

	return {
		ok: true,
		selectionId,
		mode: publish ? "publish" : "dry-run",
		requiredConfirmation,
		packageCount: commands.length,
		packages: commands.map((command) => ({
			name: command.packageName,
			version: command.version,
			packageDir: command.packageDir,
		})),
		commands,
	};
}

function firstPublishDryRunCommand(packageManager) {
	switch (packageManager) {
		case "pnpm":
			return commandFor(packageManager, ["publish", "--dry-run", "--no-git-checks"]);
		default:
			throw new Error(`first-publish lane currently supports pnpm only, got ${packageManager}`);
	}
}

function firstPublishCommand(packageManager) {
	switch (packageManager) {
		case "pnpm":
			return commandFor(packageManager, ["publish", "--access", "public", "--provenance", "--no-git-checks"]);
		default:
			throw new Error(`first-publish lane currently supports pnpm only, got ${packageManager}`);
	}
}

function commandFor(packageManager, args) {
	const spawn = packageManagerSpawnCommand(packageManager, args);
	return {
		command: spawn.command,
		args: spawn.args,
		display: `${packageManager} ${args.join(" ")}`,
	};
}

function runCommand(command) {
	console.log(`[first-publish] ${command.packageName}@${command.version}: ${command.display} (${command.packageDir})`);
	const result = spawnSync(command.command, command.args, {
		cwd: command.cwd,
		stdio: "inherit",
	});
	if (result.status !== 0) {
		throw new Error(`${command.packageName} ${command.display} failed with status ${result.status ?? -1}`);
	}
}

function serializePlan(plan) {
	return {
		ok: plan.ok,
		selectionId: plan.selectionId,
		mode: plan.mode,
		requiredConfirmation: plan.requiredConfirmation,
		packageCount: plan.packageCount,
		packages: plan.packages,
		commands: plan.commands.map((command) => ({
			packageName: command.packageName,
			version: command.version,
			packageDir: command.packageDir,
			command: command.display,
		})),
	};
}

function isMain() {
	return process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
}

if (isMain()) {
	try {
		const options = parseFirstPublishArgs(process.argv.slice(2));
		const plan = buildFirstPublishPlan(options);
		if (options.json || options.planOnly) {
			console.log(JSON.stringify(serializePlan(plan), null, 2));
		} else {
			console.log(`[first-publish] ${plan.mode} ${plan.selectionId}: ${plan.packageCount} package(s)`);
			console.log(`[first-publish] publish confirmation: ${plan.requiredConfirmation}`);
		}

		if (!options.planOnly) {
			for (const command of plan.commands) {
				runCommand(command);
			}
		}
	} catch (error) {
		console.error(`[first-publish] ${error instanceof Error ? error.message : String(error)}`);
		process.exit(1);
	}
}
