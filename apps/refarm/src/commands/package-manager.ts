import type { LaunchProcessSpec } from "./launch-process.js";
import {
	PACKAGE_MANAGERS as SHARED_PACKAGE_MANAGERS,
	packageBinaryCommand as createSharedPackageBinaryCommand,
	createPackageScriptCommand as createSharedPackageScriptCommand,
	detectPackageManager as detectSharedPackageManager,
	type PackageManagerName,
	type PackageScriptCommandOptions,
} from "@refarm.dev/config";

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
	return detectSharedPackageManager(options);
}

export function createPackageScriptCommand(
	options: RefarmPackageScriptCommandOptions,
): LaunchProcessSpec {
	const command = createSharedPackageScriptCommand(options);
	return {
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
	const command = createSharedPackageBinaryCommand(binary, args, options);
	return {
		command: command.command,
		args: command.args,
		display: command.display,
	};
}
