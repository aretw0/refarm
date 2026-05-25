import {
	PACKAGE_MANAGERS as SHARED_PACKAGE_MANAGERS,
	packageBinaryCommand as createSharedPackageBinaryCommand,
	createPackageScriptCommand as createSharedPackageScriptCommand,
	detectPackageManager as detectSharedPackageManager,
	packageManagerOverrideDiagnostic,
	type PackageManagerName,
	type PackageScriptCommandOptions,
} from "@refarm.dev/config";
import chalk from "chalk";
import type { LaunchProcessSpec } from "./launch-process.js";

export type { PackageManagerName } from "@refarm.dev/config";
export const PACKAGE_MANAGERS = SHARED_PACKAGE_MANAGERS;

export interface RefarmPackageScriptCommandOptions
	extends PackageScriptCommandOptions {
	env?: NodeJS.ProcessEnv;
}

export function detectPackageManager(options: {
	cwd?: string;
	env?: NodeJS.ProcessEnv;
} = {}): PackageManagerName {
	warnInvalidPackageManagerOverride(options.env);
	return detectSharedPackageManager(options);
}

function warnInvalidPackageManagerOverride(env: NodeJS.ProcessEnv = process.env): void {
	const diagnostic = packageManagerOverrideDiagnostic(env);
	if (!diagnostic) return;
	console.error(
		chalk.yellow(`⚠  Ignored invalid ${diagnostic.name}=${diagnostic.value}`),
	);
	console.error(chalk.dim(`   Use: ${diagnostic.valid.join(", ")}`));
}

export function createPackageScriptCommand(
	options: RefarmPackageScriptCommandOptions,
): LaunchProcessSpec {
	warnInvalidPackageManagerOverride(options.env);
	const command = createSharedPackageScriptCommand(options);
	return {
		packageManager: command.packageManager,
		command: command.command,
		args: command.args,
		display: command.display,
	};
}

export function createPackageBinaryCommand(
	binary: string,
	args: string[] = [],
	options: {
		cwd?: string;
		env?: NodeJS.ProcessEnv;
	} = {},
): LaunchProcessSpec {
	warnInvalidPackageManagerOverride(options.env);
	const command = createSharedPackageBinaryCommand(binary, args, options);
	return {
		packageManager: command.packageManager,
		command: command.command,
		args: command.args,
		display: command.display,
	};
}
