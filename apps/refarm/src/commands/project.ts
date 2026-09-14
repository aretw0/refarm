import {
	buildJsonErrorEnvelope,
	buildJsonSuccessEnvelope,
	printJson,
} from "@refarm.dev/capabilities/envelope";
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
import {
	automationBodyFromWork,
	automationWorkTasks,
	type AutomationWorkInput,
} from "@refarm.dev/cli/automation-work";
import { runDueScheduledWork } from "@refarm.dev/cli/scheduled-work-runner";
import {
	formatScheduledWorkSources,
	type ScheduledWorkSource,
} from "@refarm.dev/cli/scheduled-work-sources";
import { createLocalSchedulerLedger } from "@refarm.dev/windmill/local-scheduler-ledger";
import chalk from "chalk";
import { Command } from "commander";
import fs from "node:fs";
import path from "node:path";
import { refarmCommand } from "../brand.js";
import { resolveAdapter } from "./task-support.js";

/** Minimal effort submit adapter — the shape `runDueScheduledWork` needs. */
interface EffortSubmitAdapter {
	submit(effort: unknown): Promise<string>;
}

interface ProjectDeps {
	cwd(): string;
	now(): Date;
	/**
	 * Resolves the effort submit adapter used by `automations tick --submit`.
	 * Defaults to the real file transport (queues under `~/.refarm`); tests
	 * inject a collecting fake.
	 */
	effortSubmitAdapter(): EffortSubmitAdapter;
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
	ask?: string;
	dispatch?: string[];
	args?: string[];
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

interface AutomationsTickOptions extends AutomationsValidateOptions {
	submit?: boolean;
	owner?: string;
	now?: string;
	workspace?: string;
}

function defaultDeps(): ProjectDeps {
	return {
		cwd: () => process.cwd(),
		now: () => new Date(),
		effortSubmitAdapter: () => resolveAdapter("file"),
	};
}

function collectOption(value: string, previous: string[] = []): string[] {
	return [...previous, value];
}

function handoffPath(cwd: string): string {
	return path.join(cwd, PROJECT_HANDOFF_RELATIVE_PATH);
}

/**
 * A ledger for `tick` dry-run: it reads the real `.refarm` fired state (so the
 * report reflects what a real `--submit` would fire), but `recordFired` is a
 * no-op — a dry-run must never mutate the ledger.
 */
function dryRunLedger(cwd: string) {
	const real = createLocalSchedulerLedger({ cwd });
	return {
		hasFired: (key: string) => real.hasFired(key),
		recordFired: async () => {},
	};
}

/**
 * The directory a DECLARED workspace names, resolved from the node's config.
 *
 * Refuses an unknown id by NAMING the declared ones rather than describing the problem: the
 * operator or agent that mistyped needs the list, and a refusal that withholds it makes them go
 * looking for a surface that has it.
 */
async function resolveDeclaredWorkspaceCwd(workspaceId: string): Promise<string> {
	const { declaredBase, declaredWorkspacesFromConfig, loadConfig } = await import(
		"@refarm.dev/config"
	);
	// THE NODE'S CONFIG, NAMED. `loadConfig()` with no root walks up from the working directory,
	// so asking it for "the declared workspaces" from outside any tree answers "this node
	// declares none" — the ambient resolution this option exists to escape, reintroduced one
	// layer down. Measured from /tmp on 2026-08-28 before this argument was passed.
	const config = await loadConfig(declaredBase());
	// `absolutePath`, not `path`: the declaration may be relative, and the resolver anchors it on
	// the NODE's base so the same declaration names the same directory from anywhere. Taking the
	// raw `path` here would put the ambient working directory back into the answer.
	const workspaces = (
		declaredWorkspacesFromConfig(config) as Array<{ id: string; absolutePath: string } | null>
	).filter((workspace): workspace is { id: string; absolutePath: string } => workspace !== null);
	const match = workspaces.find((workspace) => workspace.id === workspaceId);
	if (!match) {
		const declared = workspaces.map((workspace) => workspace.id);
		throw new Error(
			declared.length > 0
				? `No declared workspace "${workspaceId}". Declared: ${declared.join(", ")}.`
				: `No declared workspace "${workspaceId}", and this node declares none.`,
		);
	}
	return match.absolutePath;
}

function formatTickReportPlain(
	report: {
		summary: {
			due: number;
			submitted: number;
			alreadyFired: number;
			skipped: number;
			failed: number;
		};
		results: Array<{ status: string; job: { name: string } }>;
		sources?: readonly ScheduledWorkSource[];
	},
	submit: boolean,
): string {
	const mode = submit ? "submit" : "dry-run";
	const s = report.summary;
	const lines = [
		`Scheduled work tick (${mode}): due=${s.due} ${submit ? "submitted" : "would-submit"}=${s.submitted} already-fired=${s.alreadyFired} skipped=${s.skipped} failed=${s.failed}`,
	];
	// WHAT IT READ, on the line under what it did. A supervised tick logs into a journal nobody
	// reads closely, and all-zeros is the same line whether nothing was due, nothing was declared,
	// or the clock was pointed at the wrong directory (ISS-175).
	if (report.sources?.length) {
		lines.push(`  read: ${formatScheduledWorkSources(report.sources)}`);
	}
	for (const result of report.results) {
		lines.push(`  ${result.status}: ${result.job.name}`);
	}
	if (!submit && s.submitted > 0) {
		lines.push(chalk.dim("  (dry-run — no efforts dispatched, ledger untouched)"));
	}
	return lines.join("\n");
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

function writeAutomations(filePath: string, document: ProjectAutomationsDocument): void {
	fs.mkdirSync(path.dirname(filePath), { recursive: true });
	fs.writeFileSync(filePath, `${JSON.stringify(document, null, 2)}\n`, "utf-8");
}

function formatValidationPlain(result: ProjectHandoffValidationResult): string {
	const lines = [`Project handoff: ${result.ok ? "valid" : "invalid"} ${result.path}`];
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
	return result.ok ? [refarmCommand(["resume", "--json"])] : [];
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

function formatAutomationsValidationPlain(result: ProjectAutomationsValidationResult): string {
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

function automationsNextCommands(result: ProjectAutomationsValidationResult): string[] {
	return result.ok
		? [
				refarmCommand(["project", "automations", "validate", "--json"]),
				refarmCommand(["resume", "--json"]),
				refarmCommand(["check", "--next-action", "--json"]),
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
	if (value === "draft" || value === "ready" || value === "active" || value === "archived") {
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
	const command = new Command("handoff").description(
		"Validate or write the governed project handoff",
	);

	command
		.command("validate")
		.description("Validate .project/handoff.json without modifying it")
		.option("--json", "Output machine-readable validation result")
		.option("--max-age-days <days>", "Warn when the handoff timestamp is older than this window")
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
				const document = buildProjectHandoffDocument(existing, updateFromOptions(options), {
					now: deps.now(),
				});
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
								refarmCommand(["resume", "--json"]),
								refarmCommand(["check", "--next-action", "--json"]),
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
	const command = new Command("automations").description(
		"Validate or write governed project automations",
	);

	command
		.command("validate")
		.description("Validate .project/automations.json without modifying it")
		.option("--json", "Output machine-readable validation result")
		.action((options: AutomationsValidateOptions) => {
			const filePath = automationsPath(deps.cwd());
			const document = readExistingJson(filePath);
			// The path it ACTUALLY read, not the bare relative name: the same string from every
			// directory cannot say which project answered (see `automationsPath`).
			const result = validateProjectAutomationsDocument(document, { path: filePath });
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
				const automations = filterAutomationsByStatus(document.automations, options.status);
				const nextCommands = automationsNextCommands(validation);
				if (options.json) {
					printJson(
						buildJsonSuccessEnvelope({
							command: "project",
							operation: "automations.list",
							nextCommands,
							extra: {
								path: automationsPath(deps.cwd()),
								status: options.status ?? null,
								count: automations.length,
								automations,
								validation,
							},
						}),
					);
					return;
				}
				console.log(
					formatAutomationsListPlain(automations, {
						status: options.status,
					}),
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
							operation: "automations.list",
							error: "project_automation_list_failed",
							message,
							nextAction:
								"Run `refarm project automations list --help` and retry with a valid filter.",
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
		.option(
			"--ask <prompt>",
			"What to ask the agent when it fires — a MODEL call that spends quota",
		)
		.option(
			"--dispatch <pluginId:verb>",
			"A plugin verb to call — ordinary computation, no model. Repeatable.",
			(value: string, previous: string[] = []) => [...previous, value],
		)
		.option(
			"--args <json>",
			"JSON arguments for the matching --dispatch, in order. Repeatable.",
			(value: string, previous: string[] = []) => [...previous, value],
		)
		.option("--dry-run", "Print the would-be automations document without writing")
		.option("--json", "Output machine-readable write result")
		.action((options: AutomationsAddOptions) => {
			const filePath = automationsPath(deps.cwd());
			try {
				const trigger = projectAutomationTriggerFromOptions(options);
				const automationId = options.id ?? "";
				// PARSED HERE, not at fire time. An automation whose args are malformed JSON must
				// fail while the operator is looking at it, never at 03:00 in a journal nobody
				// reads — which is the shape of failure this whole lane exists to remove.
				const parsedArgs = (options.args ?? []).map((raw, index) => {
					try {
						return JSON.parse(raw) as unknown;
					} catch (error) {
						const message = error instanceof Error ? error.message : String(error);
						throw new Error(`--args #${index + 1} is not valid JSON: ${message}`);
					}
				});
				const work: AutomationWorkInput = {
					...(options.ask ? { ask: options.ask } : {}),
					...(options.dispatch ? { dispatch: options.dispatch } : {}),
					...(parsedArgs.length > 0 ? { args: parsedArgs } : {}),
					direction: options.name ?? automationId,
					automationId,
				};
				const tasks = automationWorkTasks(work);
				const body = automationBodyFromWork(work);
				const document = addProjectAutomationRecord(readExistingJson(filePath), {
					id: automationId,
					name: options.name ?? "",
					description: options.description,
					status: options.status as ProjectAutomationStatus | undefined,
					trigger,
					...(body ? { body } : {}),
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
							operation: options.dryRun ? "automations.add.dry-run" : "automations.add",
							nextCommands,
							extra: {
								path: automationsPath(deps.cwd()),
								dryRun: Boolean(options.dryRun),
								automation,
								// WHAT IT WILL SPEND, decided by the host's own rule rather than restated
								// here: `agent` is a model turn, `dispatch` is ordinary computation. The
								// operator budgets along this line, so the write receipt names it.
								work: tasks.map((task) => ({
									pluginId: task.pluginId,
									fn: task.fn,
									workClass: task.workClass,
								})),
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
							nextAction:
								"Run `refarm project automations add --help` and retry with a valid automation.",
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
		.requiredOption("--status <status>", "Automation status: draft, ready, active, or archived")
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
								path: automationsPath(deps.cwd()),
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
							nextAction:
								"Run `refarm project automations set-status --help` and retry with a valid automation id and status.",
						}),
					);
				} else {
					console.error(chalk.red(`Project automation status update failed: ${message}`));
				}
				process.exitCode = 1;
			}
		});

	command
		.command("tick")
		.description(
			"Fire due local scheduled work once. Dry-run by default; use --submit to dispatch efforts and record the .refarm ledger.",
		)
		.option("--submit", "Dispatch due efforts and record the fired ledger")
		.option("--owner <owner>", "Ledger owner recorded on each job")
		.option("--now <iso>", "Clock override (ISO-8601) for due-ness")
		.option(
			"--workspace <id>",
			"Tick a DECLARED workspace by id, resolved from the node config — not from where this runs",
		)
		.option("--json", "Output machine-readable tick report")
		.action(async (options: AutomationsTickOptions) => {
			const submit = Boolean(options.submit);
			try {
				// A DECLARED TARGET BEATS AN AMBIENT ONE. Project automations resolve by walking up
				// from the working directory, so a supervised tick reads whatever tree its unit
				// happens to sit in — and on 2026-08-27 that was a directory with no automations,
				// reported as success for as long as it ran. Declared workspace paths come from the
				// NODE's config and name the same directory from anywhere (ISS-175, ISS-075).
				const cwd = options.workspace
					? await resolveDeclaredWorkspaceCwd(options.workspace)
					: deps.cwd();
				const report = await runDueScheduledWork({
					cwd,
					owner: options.owner,
					now: options.now,
					// Dry-run: collect efforts without submitting; --submit: real transport.
					effortAdapter: submit ? deps.effortSubmitAdapter() : { submit: async () => "dry-run" },
					// Dry-run consults the real .refarm ledger for hasFired (so it reports
					// what would actually fire) but never records — no side effect.
					ledger: submit ? createLocalSchedulerLedger({ cwd }) : dryRunLedger(cwd),
				});
				const nextCommands = submit
					? [
							refarmCommand(["resume", "--json"]),
							refarmCommand(["check", "--next-action", "--json"]),
						]
					: [refarmCommand(["project", "automations", "tick", "--submit", "--json"])];
				if (options.json) {
					printJson(
						buildJsonSuccessEnvelope({
							command: "project",
							operation: "automations.tick",
							nextCommands,
							extra: { submitted: submit, report },
						}),
					);
					return;
				}
				console.log(formatTickReportPlain(report, submit));
				for (const next of nextCommands) {
					console.log(chalk.dim(`  next: ${next}`));
				}
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				if (options.json) {
					printJson(
						buildJsonErrorEnvelope({
							command: "project",
							operation: "automations.tick",
							error: "project_automation_tick_failed",
							message,
							nextAction:
								"Run `refarm project automations tick --help`; check .project/automations.json and .refarm write access.",
						}),
					);
				} else {
					console.error(chalk.red(`Project automation tick failed: ${message}`));
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

/** The automations document this invocation actually read, ABSOLUTE.
 *
 * It used to report the bare relative `.project/automations.json`, which is the same string from
 * every directory — so the envelope could not say WHICH project answered, and three runs from three
 * different places were indistinguishable. `scripts/directory-independence.mjs` convicted it through
 * the inverse check: a project-scoped command that answers identically everywhere has stopped
 * reading the project, or has stopped saying which one it read. Same defect ISS-034 had in
 * `workspace sources declarations`, one command over.
 */
function automationsPath(cwd: string): string {
	return path.join(cwd, PROJECT_AUTOMATIONS_RELATIVE_PATH);
}

export function createProjectCommand(deps: Partial<ProjectDeps> = {}): Command {
	const resolvedDeps = { ...defaultDeps(), ...deps };
	return new Command("project")
		.description("Inspect and update Refarm project state")
		.addCommand(createHandoffCommand(resolvedDeps))
		.addCommand(createAutomationsCommand(resolvedDeps));
}

export const projectCommand = createProjectCommand();
