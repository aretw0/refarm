import type { LaunchProcessSpec } from "@refarm.dev/cli/launch-process";
import {
	PACKAGE_MANAGER_OVERRIDE_ENV_VAR,
	PACKAGE_MANAGERS as SHARED_PACKAGE_MANAGERS,
	packageBinaryCommand as createSharedPackageBinaryCommand,
	createPackageScriptCommand as createSharedPackageScriptCommand,
	detectPackageManager as detectSharedPackageManager,
	packageManagerOverrideDiagnostic,
	type PackageManagerName,
	type PackageScriptCommandOptions,
} from "@refarm.dev/config";
import chalk from "chalk";
import { Command } from "commander";
import {
	refarmCommand,
	refarmProcess,
	type ApplicationProcessSpec,
} from "./command-handoff.js";
import { buildJsonSuccessEnvelope, printJson } from "./json-output.js";
import {
	buildWorkspaceExecutionStatus,
	type WorkspaceExecutionStatus,
} from "./workspace-execution.js";

export type { PackageManagerName } from "@refarm.dev/config";
export const PACKAGE_MANAGERS = SHARED_PACKAGE_MANAGERS;
export const PACKAGE_MANAGER_OVERRIDE = PACKAGE_MANAGER_OVERRIDE_ENV_VAR;

export interface RefarmPackageScriptCommandOptions
	extends PackageScriptCommandOptions {
	env?: NodeJS.ProcessEnv;
}

export type { WorkspaceExecutionStatus } from "./workspace-execution.js";

export interface PackageManagerStatus {
	packageManager: PackageManagerName;
	cwd: string;
	override: string | null;
	overrideValid: boolean;
	validPackageManagers: readonly PackageManagerName[];
	execution: WorkspaceExecutionStatus;
	handoffs: {
		tidyImportsDryRun: string;
	};
	commands: {
		tidyImportsCheck: LaunchProcessSpec;
		tidyImportsApply: LaunchProcessSpec;
	};
	templates: Array<{
		id: string;
		command: string;
		process?: ApplicationProcessSpec;
		parameters: string[];
		useWhen: string;
	}>;
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

export function buildPackageManagerStatus(options: {
	cwd?: string;
	env?: NodeJS.ProcessEnv;
} = {}): PackageManagerStatus {
	const env = options.env ?? process.env;
	const cwd = options.cwd ?? process.cwd();
	const diagnostic = packageManagerOverrideDiagnostic(env);
	const packageManager = detectSharedPackageManager({ cwd, env });
	const tidyImportsCheck = createSharedPackageScriptCommand({
		cwd,
		script: "imports:organize",
		args: ["--check"],
		env,
	});
	const tidyImportsApply = createSharedPackageScriptCommand({
		cwd,
		script: "imports:organize",
		env,
	});
	return {
		packageManager,
		cwd,
		override: env[PACKAGE_MANAGER_OVERRIDE]?.trim() || null,
		overrideValid: Boolean(env[PACKAGE_MANAGER_OVERRIDE]) && !diagnostic,
		validPackageManagers: PACKAGE_MANAGERS,
		execution: buildWorkspaceExecutionStatus({ cwd, env, packageManager }),
		handoffs: {
			tidyImportsDryRun: refarmCommand([
				"tidy",
				"imports",
				"--dry-run",
				"--json",
			]),
		},
		commands: {
			tidyImportsCheck,
			tidyImportsApply,
		},
		templates: [
			{
				id: "plugin-bundle-dry-run",
				command: refarmCommand([
					"plugin",
					"bundle",
					"<plugin.wasm>",
					"--dry-run",
					"--json",
				]),
				process: refarmProcess([
					"plugin",
					"bundle",
					"<plugin.wasm>",
					"--dry-run",
					"--json",
				]),
				parameters: ["plugin.wasm"],
				useWhen: "After choosing a concrete WASM component path to inspect the jco bundle command.",
			},
		],
	};
}

function printPackageManagerStatus(status: PackageManagerStatus): void {
	console.log(chalk.bold("Package manager"));
	console.log(`  current:  ${status.packageManager}`);
	if (status.override) {
		console.log(
			`  override: ${PACKAGE_MANAGER_OVERRIDE}=${status.override} ${
				status.overrideValid ? "(active)" : "(ignored)"
			}`,
		);
	} else {
		console.log(`  override: unset`);
	}
	console.log(`  valid:    ${status.validPackageManagers.join(", ")}`);
	console.log(chalk.dim(`  cwd:      ${status.cwd}`));
	console.log(chalk.bold("Workspace execution"));
	console.log(`  executor: ${status.execution.executor.selected}`);
	console.log(chalk.dim(`  reason:   ${status.execution.executor.reason}`));
	if (status.execution.adapters.turbo.configured) {
		console.log(
			`  turbo:    ${
				status.execution.adapters.turbo.available ? "available" : "not provisioned"
			}`,
		);
		if (status.execution.adapters.turbo.installCommand) {
			console.log(chalk.dim(`  install:  ${status.execution.adapters.turbo.installCommand}`));
		}
	}
	console.log(
		`  cache:    local ${
			status.execution.cache.local.available ? "available" : "not found"
		}, remote ${status.execution.cache.remote.configured ? "configured" : "not configured"}`,
	);
	console.log(chalk.dim(`  inspect:  ${status.handoffs.tidyImportsDryRun}`));
	console.log(chalk.dim(`  check:    ${status.commands.tidyImportsCheck.display}`));
	console.log(chalk.dim(`  apply:    ${status.commands.tidyImportsApply.display}`));
}

export function createPackageManagerCommand(deps?: {
	cwd?: () => string;
	env?: NodeJS.ProcessEnv;
}): Command {
	return new Command("package-manager")
		.description("Inspect package-manager detection for Refarm-launched project commands")
		.option("--json", "Output machine-readable package-manager status")
		.addHelpText(
			"after",
			[
				"",
				"Examples:",
				"  $ refarm package-manager",
				"  $ refarm package-manager --json",
				`  $ ${PACKAGE_MANAGER_OVERRIDE}=npm refarm package-manager --json`,
				"",
				"Notes:",
				"  Refarm detects packageManager from package.json, then lockfiles, then npm.",
				`  Override detection with ${PACKAGE_MANAGER_OVERRIDE}=${PACKAGE_MANAGERS.join("|")}.`,
				"  Commands such as tidy imports, web launchers, and plugin bundle use this resolver.",
			].join("\n"),
		)
		.action((options: { json?: boolean }) => {
			const status = buildPackageManagerStatus({
				cwd: deps?.cwd?.() ?? process.cwd(),
				env: deps?.env ?? process.env,
			});
			if (options.json) {
				printJson(
					buildJsonSuccessEnvelope({
						command: "package-manager",
						operation: "current",
						extra: status,
						nextCommands: [status.handoffs.tidyImportsDryRun],
					}),
				);
				return;
			}
			if (!status.overrideValid) {
				warnInvalidPackageManagerOverride(deps?.env ?? process.env);
			}
			printPackageManagerStatus(status);
		});
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

export const packageManagerCommand = createPackageManagerCommand();
