import {
	runLaunchProcess,
	type LaunchProcessRunOptions,
	type LaunchProcessRunResult,
	type LaunchProcessSpec,
} from "@refarm.dev/cli/launch-process";
import { Command } from "commander";
import { quoteCommandArg, refarmCommand } from "./command-handoff.js";
import {
	buildJsonErrorEnvelope,
	buildJsonSuccessEnvelope,
	printJson,
} from "./json-output.js";
import {
	createPackageScriptCommand,
	PACKAGE_MANAGERS,
} from "./package-manager.js";

export interface TidyImportsOptions {
	check?: boolean;
	dryRun?: boolean;
	json?: boolean;
}

export type TidyRunOptions = LaunchProcessRunOptions;
export type TidyRunResult = LaunchProcessRunResult;

export interface TidyDeps {
	cwd(): string;
	run(spec: LaunchProcessSpec, options: TidyRunOptions): Promise<TidyRunResult>;
}

export interface TidyImportsPlan {
	action: "imports";
	check: boolean;
	files: string[];
	packageManager: string | null;
	processCommand: string;
	processArgs: string[];
	display: string;
	dryRun: boolean;
}

export interface TidyImportsResult extends TidyImportsPlan {
	exitCode: number;
	stdout?: string;
	stderr?: string;
}

export function resolveTidyImportsSpec(options: {
	cwd: string;
	check?: boolean;
	files?: string[];
}): LaunchProcessSpec {
	return createPackageScriptCommand({
		cwd: options.cwd,
		script: "imports:organize",
		args: [
			...(options.check ? ["--check"] : []),
			...(options.files ?? []),
		],
	});
}

function buildTidyImportsPlan(
	spec: LaunchProcessSpec,
	options: TidyImportsOptions,
	files: string[],
): TidyImportsPlan {
	return {
		action: "imports",
		check: options.check === true,
		files,
		packageManager: spec.packageManager ?? null,
		processCommand: spec.command,
		processArgs: spec.args,
		display: spec.display,
		dryRun: options.dryRun === true,
	};
}

function refarmTidyImportsCommand(files: string[], options: { check?: boolean } = {}): string {
	return refarmCommand([
		"tidy",
		"imports",
		...(options.check ? ["--check"] : []),
		...files.map((file) => quoteCommandArg(file)),
	]);
}

export function runTidyProcess(
	spec: LaunchProcessSpec,
	options: TidyRunOptions,
): Promise<TidyRunResult> {
	return runLaunchProcess(spec, options);
}

export function createTidyCommand(deps?: Partial<TidyDeps>): Command {
	const resolvedDeps: TidyDeps = {
		cwd: () => process.cwd(),
		run: runTidyProcess,
		...deps,
	};

	const command = new Command("tidy")
		.description("Run safe source cleanup helpers for the current workspace")
		.addHelpText(
			"after",
			[
				"",
				"Examples:",
				"  $ refarm tidy imports",
				"  $ refarm tidy imports --check",
				"  $ refarm tidy imports --dry-run --json",
				"  $ refarm tidy imports apps/refarm/src/commands/model.ts",
				"",
				"Notes:",
				"  imports defaults to changed source files, matching the imports:organize package script.",
				"  It skips generated artifacts such as dist/, build/, .turbo/, node_modules/, and .d.ts.",
				`  Override package-manager detection with REFARM_PACKAGE_MANAGER=${PACKAGE_MANAGERS.join("|")}.`,
			].join("\n"),
		);

	command
		.command("imports")
		.description("Organize imports for changed source files or explicit paths")
		.argument("[files...]", "Source files to organize instead of changed-file mode")
		.option("--check", "Check import organization without writing files")
		.option("--dry-run", "Print the import organization plan without running it")
		.option("--json", "Output machine-readable command plan or result")
		.action(async (files: string[], options: TidyImportsOptions) => {
			const selectedFiles = files ?? [];
			const spec = resolveTidyImportsSpec({
				cwd: resolvedDeps.cwd(),
				check: options.check,
				files: selectedFiles,
			});
			const plan = buildTidyImportsPlan(spec, options, selectedFiles);

			if (options.dryRun) {
				const nextCommand = refarmTidyImportsCommand(selectedFiles, {
					check: options.check,
				});
				if (options.json) {
					printJson(
						buildJsonSuccessEnvelope({
							command: "tidy",
							operation: "imports",
							nextCommand,
							nextCommands: [nextCommand],
							extra: plan,
						}),
					);
				} else {
					console.log(`Command: ${plan.display}`);
				}
				return;
			}

			const result = await resolvedDeps.run(spec, { capture: options.json === true });
			if (options.json) {
				if (result.exitCode === 0) {
					printJson(
						buildJsonSuccessEnvelope({
							command: "tidy",
							operation: "imports",
							extra: {
								...plan,
								exitCode: result.exitCode,
								stdout: result.stdout,
								stderr: result.stderr,
							},
						}),
					);
				} else {
					const fixCommand = options.check
						? refarmTidyImportsCommand(selectedFiles)
						: refarmTidyImportsCommand(selectedFiles, { check: true });
					printJson(
						buildJsonErrorEnvelope({
							command: "tidy",
							operation: "imports",
							error: "tidy-imports-failed",
							message: `Import organization exited with code ${result.exitCode}.`,
							nextAction: fixCommand,
							nextActions: [
								fixCommand,
								refarmTidyImportsCommand(selectedFiles, { check: true }),
							],
							nextCommand: fixCommand,
							nextCommands: [
								fixCommand,
								refarmTidyImportsCommand(selectedFiles, { check: true }),
							],
							extra: {
								...plan,
								exitCode: result.exitCode,
								stdout: result.stdout,
								stderr: result.stderr,
							},
						}),
					);
				}
			}
			if (result.exitCode !== 0) {
				process.exitCode = result.exitCode;
			}
		});

	return command;
}

export const tidyCommand = createTidyCommand();
