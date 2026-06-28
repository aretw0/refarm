#!/usr/bin/env node
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { packagePublishDryRunCommand } from "../packages/config/src/package-manager.js";
import {
	buildReleasePlan,
	formatPlan,
	releasePlanAcceptance,
} from "../packages/release-engine/src/index.mjs";

export function parseReleaseCheckArgs(argv = []) {
	const options = {
		policyPath: "release-policy.json",
		selectionId: "default",
		packageNames: [],
		planOnly: false,
		json: false,
	};

	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		if (arg === "--") {
			continue;
		}
		if (arg === "--policy") {
			options.policyPath = requireValue(argv, index, arg);
			index += 1;
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
		if (arg === "--plan") {
			options.planOnly = true;
			continue;
		}
		if (arg === "--json") {
			options.json = true;
			continue;
		}
		throw new Error(`Unknown release:check argument: ${arg}`);
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

export function buildReleaseCheckPlan({
	cwd = process.cwd(),
	env = process.env,
	policyPath = "release-policy.json",
	selectionId = "default",
	packageNames = [],
} = {}) {
	const plan = buildReleasePlan({
		cwd,
		policyPath,
		selectionId,
		packageNames,
		dryRun: true,
	});

	if (!plan.ok) {
		return {
			ok: false,
			plan,
			commands: [],
		};
	}

	const commands = plan.orderedPackages.map((pkg) => {
		const packageDir = path.join("packages", pkg.packageDir);
		const packageCwd = path.join(cwd, packageDir);
		const command = packagePublishDryRunCommand({ cwd: packageCwd, env });
		return {
			packageName: pkg.name,
			packageDir,
			cwd: packageCwd,
			packageManager: command.packageManager,
			command: command.command,
			args: command.args || [],
			display: command.display,
		};
	});

	return {
		ok: true,
		plan,
		commands,
	};
}

function runPublishDryRun(command) {
	const result = command.args.length > 0
		? spawnSync(command.command, command.args, {
			cwd: command.cwd,
			stdio: "inherit",
		})
		: spawnSync(command.command, {
			cwd: command.cwd,
			stdio: "inherit",
			shell: true,
		});

	return {
		ok: result.status === 0,
		status: result.status ?? -1,
		signal: result.signal,
	};
}

function serializeCheck(check) {
	return {
		ok: check.ok,
		status: check.plan.status,
		selection: check.plan.selection,
		packages: check.plan.orderedNames,
		acceptance: releasePlanAcceptance(check.plan),
		commands: check.commands.map((command) => ({
			packageName: command.packageName,
			packageDir: command.packageDir,
			command: command.display,
		})),
	};
}

function printPlan(check, { json = false } = {}) {
	if (json) {
		console.log(JSON.stringify(serializeCheck(check), null, 2));
		return;
	}

	console.log(formatPlan(check.plan));
	for (const command of check.commands) {
		console.log(`${command.packageName}: ${command.display} (${command.packageDir})`);
	}
}

function isMain() {
	return process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
}

if (isMain()) {
	try {
		const options = parseReleaseCheckArgs(process.argv.slice(2));
		const check = buildReleaseCheckPlan(options);

		if (!check.ok) {
			printPlan(check, options);
			process.exit(1);
		}

		if (options.planOnly) {
			printPlan(check, options);
			process.exit(0);
		}

		console.log(`[release:check] ${check.plan.releaseNotes}`);
		for (const command of check.commands) {
			console.log(`[release:check] ${command.packageName}: ${command.display} (${command.packageDir})`);
			const result = runPublishDryRun(command);
			if (!result.ok) {
				throw new Error(`${command.packageName} publish dry-run failed with status ${result.status}`);
			}
		}
		console.log(`[release:check] publish dry-run passed for ${check.commands.length} package(s).`);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		console.error(`[release:check] ${message}`);
		process.exit(1);
	}
}
