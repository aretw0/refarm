import type { LaunchProcessSpec } from "./launch-process.js";
import {
	createPackageScriptCommand as createSharedPackageScriptCommand,
	detectPackageManager as detectSharedPackageManager,
	type PackageManagerName,
	type PackageScriptCommandOptions,
} from "@refarm.dev/config";

export type { PackageManagerName } from "@refarm.dev/config";

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
