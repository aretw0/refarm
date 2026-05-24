import { Command } from "commander";
import { spawn } from "node:child_process";
import { buildJsonErrorEnvelope, printJson } from "./json-output.js";
import type { LaunchProcessSpec } from "./launch-process.js";
import {
	createPackageScriptCommand,
	PACKAGE_MANAGERS,
} from "./package-manager.js";

export interface TidyImportsOptions {
	check?: boolean;
	dryRun?: boolean;
	json?: boolean;
}

export interface TidyRunOptions {
	capture: boolean;
}

export interface TidyRunResult {
	exitCode: number;
	stdout?: string;
	stderr?: string;
}

export interface TidyDeps {
	cwd(): string;
	run(spec: LaunchProcessSpec, options: TidyRunOptions): Promise<TidyRunResult>;
}

export interface TidyImportsPlan {
	action: "imports";
	check: boolean;
	files: string[];
	command: string;
	args: string[];
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
		command: spec.command,
		args: spec.args,
		display: spec.display,
		dryRun: options.dryRun === true,
	};
}

function refarmTidyImportsCommand(files: string[], options: { check?: boolean } = {}): string {
	return [
		"refarm tidy imports",
		...(options.check ? ["--check"] : []),
		...files,
	].join(" ");
}

export function runTidyProcess(
	spec: LaunchProcessSpec,
	options: TidyRunOptions,
): Promise<TidyRunResult> {
	return new Promise((resolve, reject) => {
		const child = spawn(spec.command, spec.args, {
			cwd: process.cwd(),
			env: process.env,
			stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit",
		});
		let stdout = "";
		let stderr = "";

		if (options.capture) {
			child.stdout?.setEncoding("utf-8");
			child.stderr?.setEncoding("utf-8");
			child.stdout?.on("data", (chunk: string) => {
				stdout += chunk;
			});
			child.stderr?.on("data", (chunk: string) => {
				stderr += chunk;
			});
		}

		child.once("error", reject);
		child.once("close", (code) => {
			resolve({
				exitCode: code ?? 0,
				...(options.capture ? { stdout, stderr } : {}),
			});
		});
	});
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
		.option("--dry-run", "Print the resolved package-manager command without running it")
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
				if (options.json) {
					printJson(plan);
				} else {
					console.log(`Command: ${plan.display}`);
				}
				return;
			}

			const result = await resolvedDeps.run(spec, { capture: options.json === true });
			if (options.json) {
				if (result.exitCode === 0) {
					printJson({
						...plan,
						ok: true,
						exitCode: result.exitCode,
						stdout: result.stdout,
						stderr: result.stderr,
						nextAction: null,
						nextActions: [],
					});
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
