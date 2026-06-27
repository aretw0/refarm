import { buildJsonErrorEnvelope, buildJsonSuccessEnvelope, printJson } from "@refarm.dev/cli/json-output";
import {
	buildProjectHandoffDocument,
	parseProjectHandoffSummary,
	PROJECT_HANDOFF_RELATIVE_PATH,
	validateProjectHandoffDocument,
	type ProjectHandoffDocument,
	type ProjectHandoffUpdate,
	type ProjectHandoffValidationResult,
} from "@refarm.dev/cli/project-handoff";
import chalk from "chalk";
import { Command } from "commander";
import fs from "node:fs";
import path from "node:path";

interface ProjectDeps {
	cwd(): string;
	now(): Date;
}

interface HandoffValidateOptions {
	json?: boolean;
	maxAgeDays?: string;
}

interface HandoffWriteOptions extends HandoffValidateOptions {
	context?: string;
	timestamp?: string;
	phase?: string;
	currentTask?: string[];
	blocker?: string[];
	nextAction?: string[];
	openQuestion?: string[];
	fileInFlux?: string[];
	dryRun?: boolean;
}

function defaultDeps(): ProjectDeps {
	return {
		cwd: () => process.cwd(),
		now: () => new Date(),
	};
}

function collectOption(value: string, previous: string[] = []): string[] {
	return [...previous, value];
}

function handoffPath(cwd: string): string {
	return path.join(cwd, PROJECT_HANDOFF_RELATIVE_PATH);
}

function parseMaxAgeMs(value: string | undefined): number | undefined {
	if (value === undefined) return undefined;
	const days = Number(value);
	if (!Number.isFinite(days) || days < 0) {
		throw new Error("--max-age-days must be a non-negative number.");
	}
	return days * 24 * 60 * 60 * 1000;
}

function readHandoff(filePath: string): unknown {
	return JSON.parse(fs.readFileSync(filePath, "utf-8"));
}

function readExistingHandoff(filePath: string): unknown {
	try {
		return readHandoff(filePath);
	} catch {
		return undefined;
	}
}

function writeHandoff(filePath: string, document: ProjectHandoffDocument): void {
	fs.mkdirSync(path.dirname(filePath), { recursive: true });
	fs.writeFileSync(filePath, `${JSON.stringify(document, null, 2)}\n`, "utf-8");
}

function formatValidationPlain(result: ProjectHandoffValidationResult): string {
	const lines = [
		`Project handoff: ${result.ok ? "valid" : "invalid"} ${result.path}`,
	];
	if (result.summary?.timestamp) {
		lines.push(`  timestamp: ${result.summary.timestamp}`);
	}
	if (result.summary?.currentPhase !== undefined) {
		lines.push(`  phase: ${result.summary.currentPhase}`);
	}
	if (result.stale) {
		lines.push("  freshness: stale");
	}
	for (const issue of result.issues) {
		const marker = issue.severity === "error" ? "error" : "warning";
		lines.push(`  ${marker}: ${issue.path} ${issue.code} - ${issue.message}`);
	}
	return lines.join("\n");
}

function validationNextCommands(result: ProjectHandoffValidationResult): string[] {
	return result.ok ? ["refarm resume --json"] : [];
}

function printValidation(
	result: ProjectHandoffValidationResult,
	options: { json?: boolean; command?: string; operation: string },
): void {
	if (options.json) {
		printJson(
			buildJsonSuccessEnvelope({
				command: options.command ?? "project",
				operation: options.operation,
				nextCommands: validationNextCommands(result),
				extra: result,
			}),
		);
		return;
	}
	const output = formatValidationPlain(result);
	console.log(result.ok ? output : chalk.red(output));
}

function updateFromOptions(options: HandoffWriteOptions): ProjectHandoffUpdate {
	return {
		context: options.context,
		timestamp: options.timestamp,
		currentPhase: options.phase,
		currentTasks: options.currentTask,
		blockers: options.blocker,
		nextActions: options.nextAction,
		openQuestions: options.openQuestion,
		filesInFlux: options.fileInFlux,
	};
}

function createHandoffCommand(deps: ProjectDeps): Command {
	const command = new Command("handoff")
		.description("Validate or write the governed project handoff");

	command
		.command("validate")
		.description("Validate .project/handoff.json without modifying it")
		.option("--json", "Output machine-readable validation result")
		.option(
			"--max-age-days <days>",
			"Warn when the handoff timestamp is older than this window",
		)
		.action((options: HandoffValidateOptions) => {
			const filePath = handoffPath(deps.cwd());
			try {
				const result = validateProjectHandoffDocument(readHandoff(filePath), {
					now: deps.now(),
					maxAgeMs: parseMaxAgeMs(options.maxAgeDays),
				});
				printValidation(result, {
					json: options.json,
					operation: "handoff.validate",
				});
				if (!result.ok) process.exitCode = 1;
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				if (options.json) {
					printJson(
						buildJsonErrorEnvelope({
							command: "project",
							operation: "handoff.validate",
							error: "project_handoff_invalid",
							message,
							nextAction: "",
						}),
					);
				} else {
					console.error(chalk.red(`Project handoff invalid: ${message}`));
				}
				process.exitCode = 1;
			}
		});

	command
		.command("write")
		.description("Write .project/handoff.json through an explicit checkpoint update")
		.option("--context <text>", "Checkpoint context")
		.option("--timestamp <iso>", "Checkpoint timestamp; defaults to now")
		.option("--phase <phase>", "Current project phase")
		.option("--current-task <text>", "Current task entry", collectOption, [])
		.option("--blocker <text>", "Blocking issue entry", collectOption, [])
		.option("--next-action <text>", "Next action entry", collectOption, [])
		.option("--open-question <text>", "Open question entry", collectOption, [])
		.option("--file-in-flux <path>", "File currently in flux", collectOption, [])
		.option("--dry-run", "Print the would-be handoff without writing")
		.option("--json", "Output machine-readable write result")
		.option(
			"--max-age-days <days>",
			"Warn when the resulting handoff timestamp is older than this window",
		)
		.action((options: HandoffWriteOptions) => {
			const filePath = handoffPath(deps.cwd());
			try {
				const existing = readExistingHandoff(filePath);
				const document = buildProjectHandoffDocument(
					existing,
					updateFromOptions(options),
					{ now: deps.now() },
				);
				const result = validateProjectHandoffDocument(document, {
					now: deps.now(),
					maxAgeMs: parseMaxAgeMs(options.maxAgeDays),
				});
				if (!result.ok) {
					printValidation(result, {
						json: options.json,
						operation: "handoff.write",
					});
					process.exitCode = 1;
					return;
				}
				if (!options.dryRun) writeHandoff(filePath, document);
				const summary = parseProjectHandoffSummary(document);
				if (options.json) {
					printJson(
						buildJsonSuccessEnvelope({
							command: "project",
							operation: options.dryRun ? "handoff.write.dry-run" : "handoff.write",
							nextCommands: [
								"refarm resume --json",
								"refarm check --next-action --json",
							],
							extra: {
								path: PROJECT_HANDOFF_RELATIVE_PATH,
								dryRun: Boolean(options.dryRun),
								document,
								summary,
								validation: result,
							},
						}),
					);
					return;
				}
				console.log(
					`Project handoff ${options.dryRun ? "would be written" : "written"}: ${PROJECT_HANDOFF_RELATIVE_PATH}`,
				);
				if (summary?.context) {
					console.log(chalk.dim(`  context: ${summary.context}`));
				}
				console.log(chalk.dim("  next: refarm resume --json"));
				console.log(chalk.dim("  next: refarm check --next-action --json"));
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				if (options.json) {
					printJson(
						buildJsonErrorEnvelope({
							command: "project",
							operation: "handoff.write",
							error: "project_handoff_write_failed",
							message,
							nextAction: "",
						}),
					);
				} else {
					console.error(chalk.red(`Project handoff write failed: ${message}`));
				}
				process.exitCode = 1;
			}
		});

	return command;
}

export function createProjectCommand(deps: Partial<ProjectDeps> = {}): Command {
	const resolvedDeps = { ...defaultDeps(), ...deps };
	return new Command("project")
		.description("Inspect and update Refarm project state")
		.addCommand(createHandoffCommand(resolvedDeps));
}

export const projectCommand = createProjectCommand();
