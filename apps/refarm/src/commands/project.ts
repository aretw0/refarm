import { buildJsonErrorEnvelope, buildJsonSuccessEnvelope, printJson } from "@refarm.dev/cli/json-output";
import {
	addProjectAutomationRecord,
	normalizeProjectAutomationsDocument,
	PROJECT_AUTOMATIONS_RELATIVE_PATH,
	requireProjectAutomationId,
	updateProjectAutomationStatus,
	validateProjectAutomationsDocument,
	type ProjectAutomationRecord,
	type ProjectAutomationsDocument,
	type ProjectAutomationStatus,
	type ProjectAutomationsValidationResult,
	type ProjectAutomationTrigger,
} from "@refarm.dev/cli/project-automations";
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

interface AutomationsValidateOptions {
	json?: boolean;
}

interface AutomationsAddOptions extends AutomationsValidateOptions {
	id?: string;
	name?: string;
	description?: string;
	status?: string;
	trigger?: string;
	at?: string;
	schedule?: string;
	timezone?: string;
	eventType?: string;
	dryRun?: boolean;
}

interface AutomationsListOptions extends AutomationsValidateOptions {
	status?: string;
}

interface AutomationsStatusOptions extends AutomationsValidateOptions {
	id?: string;
	status?: string;
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

function automationsPath(cwd: string): string {
	return path.join(cwd, PROJECT_AUTOMATIONS_RELATIVE_PATH);
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

function readExistingJson(filePath: string): unknown {
	try {
		return JSON.parse(fs.readFileSync(filePath, "utf-8"));
	} catch {
		return undefined;
	}
}

function writeHandoff(filePath: string, document: ProjectHandoffDocument): void {
	fs.mkdirSync(path.dirname(filePath), { recursive: true });
	fs.writeFileSync(filePath, `${JSON.stringify(document, null, 2)}\n`, "utf-8");
}

function writeAutomations(
	filePath: string,
	document: ProjectAutomationsDocument,
): void {
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

function formatAutomationsValidationPlain(
	result: ProjectAutomationsValidationResult,
): string {
	const lines = [
		`Project automations: ${result.ok ? "valid" : "invalid"} ${result.path}`,
		`  count: ${result.count}`,
	];
	for (const issue of result.issues) {
		const marker = issue.severity === "error" ? "error" : "warning";
		lines.push(`  ${marker}: ${issue.path} ${issue.code} - ${issue.message}`);
	}
	return lines.join("\n");
}

function automationsNextCommands(
	result: ProjectAutomationsValidationResult,
): string[] {
	return result.ok
		? [
				"refarm project automations validate --json",
				"refarm resume --json",
				"refarm check --next-action --json",
			]
		: [];
}

function printAutomationsValidation(
	result: ProjectAutomationsValidationResult,
	options: { json?: boolean; operation: string },
): void {
	if (options.json) {
		printJson(
			buildJsonSuccessEnvelope({
				command: "project",
				operation: options.operation,
				nextCommands: automationsNextCommands(result),
				extra: result,
			}),
		);
		return;
	}
	const output = formatAutomationsValidationPlain(result);
	console.log(result.ok ? output : chalk.red(output));
}

function parseProjectAutomationStatus(value: string | undefined): ProjectAutomationStatus {
	if (
		value === "draft" ||
		value === "ready" ||
		value === "active" ||
		value === "archived"
	) {
		return value;
	}
	throw new Error("Automation status must be draft, ready, active, or archived.");
}

function filterAutomationsByStatus(
	automations: ProjectAutomationRecord[],
	status: string | undefined,
): ProjectAutomationRecord[] {
	if (status === undefined) return automations;
	const parsedStatus = parseProjectAutomationStatus(status);
	return automations.filter((automation) => automation.status === parsedStatus);
}

function formatAutomationsListPlain(
	automations: ProjectAutomationRecord[],
	options: { status?: string } = {},
): string {
	const suffix = options.status ? ` status=${options.status}` : "";
	const lines = [`Project automations:${suffix} count=${automations.length}`];
	for (const automation of automations) {
		lines.push(`  ${automation.id} ${automation.status} ${automation.name}`);
	}
	return lines.join("\n");
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

function createAutomationsCommand(deps: ProjectDeps): Command {
	const command = new Command("automations")
		.description("Validate or write governed project automations");

	command
		.command("validate")
		.description("Validate .project/automations.json without modifying it")
		.option("--json", "Output machine-readable validation result")
		.action((options: AutomationsValidateOptions) => {
			const filePath = automationsPath(deps.cwd());
			const document = readExistingJson(filePath);
			const result = validateProjectAutomationsDocument(document);
			printAutomationsValidation(result, {
				json: options.json,
				operation: "automations.validate",
			});
			if (!result.ok) process.exitCode = 1;
		});

	command
		.command("list")
		.description("List governed project automations")
		.option("--status <status>", "Filter by status: draft, ready, active, or archived")
		.option("--json", "Output machine-readable automation list")
		.action((options: AutomationsListOptions) => {
			const filePath = automationsPath(deps.cwd());
			try {
				const existing = readExistingJson(filePath);
				const validation = validateProjectAutomationsDocument(existing);
				if (!validation.ok) {
					printAutomationsValidation(validation, {
						json: options.json,
						operation: "automations.list",
					});
					process.exitCode = 1;
					return;
				}
				const document = normalizeProjectAutomationsDocument(existing);
				const automations = filterAutomationsByStatus(
					document.automations,
					options.status,
				);
				const nextCommands = automationsNextCommands(validation);
				if (options.json) {
					printJson(
						buildJsonSuccessEnvelope({
							command: "project",
							operation: "automations.list",
							nextCommands,
							extra: {
								path: PROJECT_AUTOMATIONS_RELATIVE_PATH,
								status: options.status ?? null,
								count: automations.length,
								automations,
								validation,
							},
						}),
					);
					return;
				}
				console.log(formatAutomationsListPlain(automations, {
					status: options.status,
				}));
				for (const next of nextCommands) {
					console.log(chalk.dim(`  next: ${next}`));
				}
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				if (options.json) {
					printJson(
						buildJsonErrorEnvelope({
							command: "project",
							operation: "automations.list",
							error: "project_automation_list_failed",
							message,
							nextAction: "Run `refarm project automations list --help` and retry with a valid filter.",
						}),
					);
				} else {
					console.error(chalk.red(`Project automation list failed: ${message}`));
				}
				process.exitCode = 1;
			}
		});

	command
		.command("add")
		.description("Append one governed project automation")
		.requiredOption("--id <id>", "Stable automation id")
		.requiredOption("--name <name>", "Automation display name")
		.option("--description <text>", "Automation description")
		.option(
			"--status <status>",
			"Automation status: draft, ready, active, or archived; defaults to draft",
		)
		.option(
			"--trigger <type>",
			"Trigger type: manual, once, cron, or event; defaults to manual",
			"manual",
		)
		.option("--at <iso>", "ISO timestamp for --trigger once")
		.option("--schedule <expr>", "Cron expression for --trigger cron")
		.option("--timezone <tz>", "Timezone for --trigger cron")
		.option("--event-type <type>", "Event type for --trigger event")
		.option("--dry-run", "Print the would-be automations document without writing")
		.option("--json", "Output machine-readable write result")
		.action((options: AutomationsAddOptions) => {
			const filePath = automationsPath(deps.cwd());
			try {
				const trigger = projectAutomationTriggerFromOptions(options);
				const document = addProjectAutomationRecord(readExistingJson(filePath), {
					id: options.id ?? "",
					name: options.name ?? "",
					description: options.description,
					status: options.status as ProjectAutomationStatus | undefined,
					trigger,
				});
				const result = validateProjectAutomationsDocument(document);
				if (!result.ok) {
					printAutomationsValidation(result, {
						json: options.json,
						operation: "automations.add",
					});
					process.exitCode = 1;
					return;
				}
				if (!options.dryRun) writeAutomations(filePath, document);

				const automation = document.automations.at(-1);
				const nextCommands = automationsNextCommands(result);
				if (options.json) {
					printJson(
						buildJsonSuccessEnvelope({
							command: "project",
							operation: options.dryRun
								? "automations.add.dry-run"
								: "automations.add",
							nextCommands,
							extra: {
								path: PROJECT_AUTOMATIONS_RELATIVE_PATH,
								dryRun: Boolean(options.dryRun),
								automation,
								document,
								validation: result,
							},
						}),
					);
					return;
				}
				console.log(
					`Project automation ${options.dryRun ? "would be written" : "written"}: ${automation?.id}`,
				);
				for (const next of nextCommands) {
					console.log(chalk.dim(`  next: ${next}`));
				}
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				if (options.json) {
					printJson(
						buildJsonErrorEnvelope({
							command: "project",
							operation: "automations.add",
							error: "project_automation_write_failed",
							message,
							nextAction: "Run `refarm project automations add --help` and retry with a valid automation.",
						}),
					);
				} else {
					console.error(chalk.red(`Project automation write failed: ${message}`));
				}
				process.exitCode = 1;
			}
		});

	command
		.command("set-status")
		.description("Set the lifecycle status for one governed project automation")
		.requiredOption("--id <id>", "Stable automation id")
		.requiredOption(
			"--status <status>",
			"Automation status: draft, ready, active, or archived",
		)
		.option("--dry-run", "Print the would-be automations document without writing")
		.option("--json", "Output machine-readable status update result")
		.action((options: AutomationsStatusOptions) => {
			const filePath = automationsPath(deps.cwd());
			try {
				const status = parseProjectAutomationStatus(options.status);
				const document = updateProjectAutomationStatus(readExistingJson(filePath), {
					id: options.id ?? "",
					status,
				});
				const result = validateProjectAutomationsDocument(document);
				if (!result.ok) {
					printAutomationsValidation(result, {
						json: options.json,
						operation: "automations.set-status",
					});
					process.exitCode = 1;
					return;
				}
				if (!options.dryRun) writeAutomations(filePath, document);

				const automation = requireProjectAutomationId(document, options.id ?? "");
				const nextCommands = automationsNextCommands(result);
				if (options.json) {
					printJson(
						buildJsonSuccessEnvelope({
							command: "project",
							operation: options.dryRun
								? "automations.set-status.dry-run"
								: "automations.set-status",
							nextCommands,
							extra: {
								path: PROJECT_AUTOMATIONS_RELATIVE_PATH,
								dryRun: Boolean(options.dryRun),
								automation,
								document,
								validation: result,
							},
						}),
					);
					return;
				}
				console.log(
					`Project automation ${options.dryRun ? "would be updated" : "updated"}: ${automation.id} ${automation.status}`,
				);
				for (const next of nextCommands) {
					console.log(chalk.dim(`  next: ${next}`));
				}
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				if (options.json) {
					printJson(
						buildJsonErrorEnvelope({
							command: "project",
							operation: "automations.set-status",
							error: "project_automation_status_failed",
							message,
							nextAction: "Run `refarm project automations set-status --help` and retry with a valid automation id and status.",
						}),
					);
				} else {
					console.error(chalk.red(`Project automation status update failed: ${message}`));
				}
				process.exitCode = 1;
			}
		});

	return command;
}

function projectAutomationTriggerFromOptions(
	options: AutomationsAddOptions,
): ProjectAutomationTrigger {
	const type = options.trigger ?? "manual";
	if (type === "manual") return { type: "manual" };
	if (type === "once") {
		if (!options.at) throw new Error("--trigger once requires --at <iso>.");
		return { type: "once", at: options.at };
	}
	if (type === "cron") {
		if (!options.schedule) {
			throw new Error("--trigger cron requires --schedule <expr>.");
		}
		return {
			type: "cron",
			schedule: options.schedule,
			...(options.timezone ? { timezone: options.timezone } : {}),
		};
	}
	if (type === "event") {
		if (!options.eventType) {
			throw new Error("--trigger event requires --event-type <type>.");
		}
		return { type: "event", eventType: options.eventType };
	}
	throw new Error("Automation trigger must be manual, once, cron, or event.");
}

export function createProjectCommand(deps: Partial<ProjectDeps> = {}): Command {
	const resolvedDeps = { ...defaultDeps(), ...deps };
	return new Command("project")
		.description("Inspect and update Refarm project state")
		.addCommand(createHandoffCommand(resolvedDeps))
		.addCommand(createAutomationsCommand(resolvedDeps));
}

export const projectCommand = createProjectCommand();
