import os from "node:os";
import path from "node:path";

import {
	buildJsonErrorEnvelope,
	buildJsonSuccessEnvelope,
	printJson,
} from "@refarm.dev/capabilities/envelope";
import { loadRawSovereignConfig } from "@refarm.dev/config";
import {
	createFileOperationTrail,
	renderOperationRequest,
	runOperationConsent,
	standingDecision,
	undoOperationRecord,
	type OperationConsentChannel,
	type OperationRecord,
	type OperationTrail,
} from "@refarm.dev/operation-consent-v1";
import {
	describeProcessStatus,
	parseProcessCatalog,
	ProcessDeclarationError,
	processNotDeclared,
	resolveSupervisionBackend,
	SupervisionRefusal,
	type ProcessCatalog,
	type ProcessDeclaration,
	type ProcessStatus,
	type SupervisionBackend,
} from "@refarm.dev/process-contract-v1";
import {
	buildLingerRequest,
	createLingerFileSystem,
	createNodeCommandRunner,
	createSystemdUserBackend,
	readLingerState,
	refuseBundledLinger,
	type CommandRunner,
	type LingerState,
	type SystemdUnitPlan,
} from "@refarm.dev/process-systemd-user";
import { createStdioOperatorChannel } from "@refarm.dev/prompt-contract-v1";
import chalk from "chalk";
import { Command } from "commander";

import { refarmCommand } from "../brand.js";
import {
	processRecipeNames,
	ProcessAddRefusal,
	runProcessAdd,
	type ProcessAddOptions,
	type ProcessAddResult,
} from "./process-add.js";

/**
 * `refarm process` — what refarm supervises, and whether it is actually up.
 *
 * Design: `docs/superpowers/specs/2026-07-30-declared-processes-design.md`.
 *
 * WHAT FORCED THIS COMMAND. The operator rebooted their machine. The runtime and `refarm web serve`
 * both went away and NOTHING said so — it was found by measuring, and a device running
 * `farm-update` in that window would have failed with no explanation. refarm owned two long-running
 * processes and supervised neither.
 *
 * WHAT THIS COMMAND DOES NOT DO, deliberately: it never runs `systemctl --user enable`, `start` or
 * `stop`. Writing a unit file is a change to the operator's machine and goes through consent;
 * STARTING something in their live session is theirs to do, and the command hands over the exact
 * line. It is the same boundary `refarm cert trust` draws when it writes the trust anchor and then
 * says "falta rodar update-ca-certificates" — refarm does the part that can be shown, reviewed and
 * undone, and does not reach into a running session on the operator's behalf.
 */

const PROCESS_HELP_COMMAND = refarmCommand(["process", "--help"]);
const PROCESS_LIST_COMMAND = refarmCommand(["process", "list", "--json"]);
const PROCESS_STATUS_COMMAND = refarmCommand(["process", "status", "--json"]);
const PROCESS_LINGER_COMMAND = refarmCommand(["process", "linger"]);

/** Where the trail of process operations lives — beside the units they are about. */
export function resolveProcessTrailPath(root: string = process.cwd()): string {
	return path.join(root, ".refarm", "processes", "operations.json");
}

export interface ProcessDeps {
	root?: string;
	runner?: CommandRunner;
	user?: string;
	env?: NodeJS.ProcessEnv;
	unitDir?: string;
	trail?: OperationTrail;
	operator?: OperationConsentChannel | null;
	now?: () => string;
	say?: (line: string) => void;
	/** Injected so a test never needs a real `.refarm/config.json`. */
	config?: unknown;
}

/**
 * Read the `processes` block from `.refarm/config.json`.
 *
 * Same reader the `surfaces` and `delivery` catalogs use — fs-only, no interpolation, no legacy
 * merge — because a declaration about what runs on this machine must be read from exactly what is
 * on disk.
 */
export function readProcessCatalog(root: string = process.cwd(), config?: unknown): ProcessCatalog {
	return parseProcessCatalog(config === undefined ? loadRawSovereignConfig(root) : config);
}

/**
 * Who is there to ask — and `null` when nobody is.
 *
 * A consent prompt with no operator behind it does not "default to yes" and does not "default to
 * no": it never gets asked, and the consent block already models that as `no-operator`, applying
 * nothing and recording nothing. Building a stdio channel on a non-interactive stdin would instead
 * make the command WAIT FOREVER for a decision nobody is there to make — which is how a CLI in a
 * script, a cron job, or a CI step turns into a hang with no output.
 */
function resolveOperatorChannel(deps: ProcessDeps): OperationConsentChannel | null {
	if (deps.operator !== undefined) return deps.operator;
	return process.stdin.isTTY ? createStdioOperatorChannel() : null;
}

function sessionUser(deps: ProcessDeps): string {
	if (deps.user) return deps.user;
	const env = deps.env ?? process.env;
	return env.USER?.trim() || env.LOGNAME?.trim() || os.userInfo().username;
}

/**
 * The backends refarm may borrow, in preference order.
 *
 * One entry today. W5's tractor fallback — for a host with no borrowable supervisor, the phone most
 * likely — is a second element in this array and nothing else changes.
 */
export function buildSupervisionBackends(
	deps: ProcessDeps = {},
): SupervisionBackend<SystemdUnitPlan>[] {
	const runner = deps.runner ?? createNodeCommandRunner();
	return [
		createSystemdUserBackend({
			runner,
			user: sessionUser(deps),
			env: deps.env ?? process.env,
			...(deps.unitDir ? { unitDir: deps.unitDir } : {}),
			async readFile(target) {
				const { readFile } = await import("node:fs/promises");
				return readFile(target, "utf8").catch(() => null);
			},
			...(deps.now ? { now: deps.now } : {}),
		}),
	];
}

function declarationOrRefusal(catalog: ProcessCatalog, name: string): ProcessDeclaration {
	const declaration = catalog.get(name);
	if (!declaration) {
		throw new SupervisionRefusal(
			"not-declared",
			`processes."${name}" is not declared in .refarm/config.json`,
			`Declare it under "processes" first — \`${PROCESS_LIST_COMMAND}\` shows what is declared today.`,
		);
	}
	return declaration;
}

// ── list ──────────────────────────────────────────────────────────────────────

export interface ProcessListEntry {
	name: string;
	description: string;
	command: string[];
	restart: string;
	stopTimeoutSeconds: number;
	workingDirectory: string | null;
}

export interface ProcessListResult {
	ok: true;
	/** The resolved backend's id, or null when this host has none to borrow. */
	backend: string | null;
	backendDetail: string;
	/** W3 — what a unit's lifetime actually is here. `null` when no backend could say. */
	lifetime: string | null;
	processes: ProcessListEntry[];
	nextCommand: string;
	nextCommands: string[];
}

export async function runProcessList(deps: ProcessDeps = {}): Promise<ProcessListResult> {
	const catalog = readProcessCatalog(deps.root ?? process.cwd(), deps.config);
	let backend: string | null = null;
	let backendDetail: string;
	let lifetime: string | null = null;
	try {
		const resolved = await resolveSupervisionBackend(buildSupervisionBackends(deps));
		backend = resolved.id;
		backendDetail = resolved.title;
		lifetime = await resolved.describeLifetime();
	} catch (error) {
		backendDetail =
			error instanceof SupervisionRefusal
				? `${error.message} — ${error.fix}`
				: `no supervisor could be resolved: ${String(error)}`;
	}
	return {
		ok: true,
		backend,
		backendDetail,
		lifetime,
		processes: [...catalog.values()].map((declaration) => ({
			name: declaration.name,
			description: declaration.description,
			command: [...declaration.command],
			restart: declaration.restart,
			stopTimeoutSeconds: declaration.stopTimeoutSeconds,
			workingDirectory: declaration.workingDirectory ?? null,
		})),
		nextCommand: PROCESS_STATUS_COMMAND,
		nextCommands: [PROCESS_STATUS_COMMAND],
	};
}

// ── status ────────────────────────────────────────────────────────────────────

export interface ProcessStatusResult {
	/** False only when something DECLARED is not known to be up. An undeclared name is not a failure. */
	ok: boolean;
	statuses: ProcessStatus[];
	lines: string[];
	nextCommand: string;
	nextCommands: string[];
}

/**
 * The three-way answer, surfaced.
 *
 * A declared process whose supervisor cannot be reached is `could-not-ask` — never "down". An
 * asked-for name that nobody declared is `not-declared`, which is silence by consent and not an
 * error. Both are distinct from a real "the supervisor told me it is not running".
 */
export async function runProcessStatus(
	names: string[],
	deps: ProcessDeps = {},
): Promise<ProcessStatusResult> {
	const catalog = readProcessCatalog(deps.root ?? process.cwd(), deps.config);
	const wanted = names.length > 0 ? names : [...catalog.keys()];

	let backend: SupervisionBackend<SystemdUnitPlan> | null = null;
	let refusal: SupervisionRefusal | null = null;
	try {
		backend = await resolveSupervisionBackend(buildSupervisionBackends(deps));
	} catch (error) {
		refusal = error instanceof SupervisionRefusal ? error : null;
	}

	const statuses: ProcessStatus[] = [];
	for (const name of wanted) {
		const declaration = catalog.get(name);
		if (!declaration) {
			statuses.push(processNotDeclared(name));
			continue;
		}
		if (!backend) {
			statuses.push({
				name,
				state: "could-not-ask",
				detail: refusal ? `${refusal.message} — ${refusal.fix}` : "no supervisor could be resolved",
				backend: null,
				supervised: null,
			});
			continue;
		}
		statuses.push(await backend.status(declaration));
	}

	const declaredNotUp = statuses.some(
		(status) => status.state === "not-running" || status.state === "could-not-ask",
	);
	return {
		ok: !declaredNotUp,
		statuses,
		lines:
			statuses.length > 0
				? statuses.map(describeProcessStatus)
				: ['no process is declared under "processes" in .refarm/config.json'],
		nextCommand: PROCESS_LIST_COMMAND,
		nextCommands: [PROCESS_LIST_COMMAND],
	};
}

// ── install ───────────────────────────────────────────────────────────────────

export interface ProcessInstallResult {
	ok: boolean;
	status: string;
	process: string;
	unitPath: string;
	unitText: string;
	/** W3, in the result too — a JSON consumer must not have to read prose to learn this. */
	lifetime: string;
	linger: LingerState;
	recordId: string | null;
	activationCommands: string[];
	nextCommand: string;
	nextCommands: string[];
}

/**
 * Propose the unit, show it exactly, and write it only if the operator says so (W2).
 *
 * Everything the consent block requires is here: the diff before the decision, the record with
 * before/after snapshots, and an undo that executes — `refarm process uninstall` runs it.
 */
export async function runProcessInstall(
	name: string,
	options: { revisit?: boolean } = {},
	deps: ProcessDeps = {},
): Promise<ProcessInstallResult> {
	const root = deps.root ?? process.cwd();
	const catalog = readProcessCatalog(root, deps.config);
	const declaration = declarationOrRefusal(catalog, name);
	const backend = await resolveSupervisionBackend(buildSupervisionBackends(deps));
	const plan = await backend.plan(declaration);

	// The rule at the moment it could be broken. `plan()` already checked; checking again at the
	// call site costs nothing and means no future backend can slip a bundled grant past this command.
	refuseBundledLinger(plan.request);

	const say = deps.say ?? (() => {});
	const trail = deps.trail ?? createFileOperationTrail(resolveProcessTrailPath(root));
	const channel = resolveOperatorChannel(deps);

	const outcome = await runOperationConsent({
		request: plan.request,
		trail,
		channel,
		...(deps.now ? { now: deps.now } : {}),
		host: os.hostname(),
		...(options.revisit ? { revisit: true } : {}),
		announce: (line) => say(line),
	});

	const authorized = outcome.status === "authorized";
	const uninstall = refarmCommand(["process", "uninstall", name]);
	return {
		ok: outcome.status !== "declined",
		status: outcome.status,
		process: name,
		unitPath: plan.unitPath,
		unitText: plan.unitText,
		lifetime: plan.lifetime,
		linger: plan.linger,
		recordId: outcome.record?.id ?? null,
		activationCommands: authorized ? plan.activationCommands : [],
		nextCommand: authorized ? plan.activationCommands[0]! : PROCESS_STATUS_COMMAND,
		nextCommands: authorized
			? [...plan.activationCommands, PROCESS_STATUS_COMMAND, uninstall]
			: [PROCESS_STATUS_COMMAND],
	};
}

// ── uninstall ─────────────────────────────────────────────────────────────────

export interface ProcessUninstallResult {
	ok: boolean;
	process: string;
	/** The undo record, or null when there was nothing authorised to undo. */
	recordId: string | null;
	removedPath: string | null;
	stopCommand: string;
	nextCommand: string;
	nextCommands: string[];
}

/**
 * Run the undo the record already carries.
 *
 * Not "delete the unit file": UNDO THE RECORDED OPERATION. The distinction is the whole point of
 * the consent block — the trail stays append-only, the reversal is appended as its own record, and
 * what comes back is exactly what was there before rather than whatever this command guesses.
 */
export async function runProcessUninstall(
	name: string,
	deps: ProcessDeps = {},
): Promise<ProcessUninstallResult> {
	const root = deps.root ?? process.cwd();
	const catalog = readProcessCatalog(root, deps.config);
	const declaration = declarationOrRefusal(catalog, name);
	const backend = await resolveSupervisionBackend(buildSupervisionBackends(deps));
	const plan = await backend.plan(declaration);
	const trail = deps.trail ?? createFileOperationTrail(resolveProcessTrailPath(root));
	const standing: OperationRecord | null = standingDecision(await trail.read(), plan.request.id);

	const stopCommand = `systemctl --user disable --now ${plan.unitName}`;
	if (!standing || standing.decision !== "authorized") {
		throw new SupervisionRefusal(
			"nothing-to-undo",
			`processes."${name}": no authorised installation is recorded, so there is nothing to undo`,
			standing
				? `The last decision recorded for it was "${standing.decision}".`
				: `Nothing was installed by refarm for "${name}". If a unit exists, it was not written here.`,
		);
	}

	const undone = await undoOperationRecord({
		record: standing,
		trail,
		...(deps.now ? { now: deps.now } : {}),
	});
	return {
		ok: true,
		process: name,
		recordId: undone.id,
		removedPath: plan.unitPath,
		stopCommand,
		nextCommand: PROCESS_STATUS_COMMAND,
		nextCommands: [PROCESS_STATUS_COMMAND],
	};
}

// ── linger ────────────────────────────────────────────────────────────────────

export interface ProcessLingerResult {
	ok: boolean;
	status: string;
	user: string;
	current: LingerState;
	detail: string;
	recordId: string | null;
	nextCommand: string;
	nextCommands: string[];
}

/**
 * W3's separate, separately-authorised operation.
 *
 * It is its own subcommand for the reason the design gives: bundling is how a small yes becomes a
 * large one, and "keep my processes running while I am not on this machine" is a decision about the
 * MACHINE, not about the service that happened to prompt the question.
 */
export async function runProcessLinger(
	options: { revisit?: boolean } = {},
	deps: ProcessDeps = {},
): Promise<ProcessLingerResult> {
	const root = deps.root ?? process.cwd();
	const runner = deps.runner ?? createNodeCommandRunner();
	const user = sessionUser(deps);
	const { state, detail } = await readLingerState(runner, user);

	if (state === "enabled") {
		return {
			ok: true,
			status: "already-enabled",
			user,
			current: state,
			detail: `${detail} — nothing to ask`,
			recordId: null,
			nextCommand: PROCESS_STATUS_COMMAND,
			nextCommands: [PROCESS_STATUS_COMMAND],
		};
	}

	const request = buildLingerRequest({
		user,
		requester: PROCESS_LINGER_COMMAND,
		requestedAt: deps.now?.() ?? new Date().toISOString(),
		current: state,
	});
	refuseBundledLinger(request);

	const say = deps.say ?? (() => {});
	const trail = deps.trail ?? createFileOperationTrail(resolveProcessTrailPath(root));
	const channel = resolveOperatorChannel(deps);

	const outcome = await runOperationConsent({
		request,
		trail,
		channel,
		fs: createLingerFileSystem(runner, user),
		...(deps.now ? { now: deps.now } : {}),
		host: os.hostname(),
		...(options.revisit ? { revisit: true } : {}),
		announce: (line) => say(line),
	});

	return {
		ok: outcome.status !== "declined",
		status: outcome.status,
		user,
		current: state,
		detail,
		recordId: outcome.record?.id ?? null,
		nextCommand: PROCESS_STATUS_COMMAND,
		nextCommands: [PROCESS_STATUS_COMMAND],
	};
}

// ── the commander surface ─────────────────────────────────────────────────────

function print(json: boolean, payload: unknown, lines: string[]): void {
	process.stdout.write(json ? `${JSON.stringify(payload)}\n` : `${lines.join("\n")}\n`);
}

/**
 * THE ACTION BOUNDARY — every `throw` above stops being one here.
 *
 * `test/architecture/cli-refusal-conformance.test.ts` enforces this for the whole CLI, and it
 * matters especially here: the first thing a host without systemd gets from this command is a
 * refusal, and a refusal that arrives as a stack trace is indistinguishable from a bug in refarm.
 */
function guarded<TOptions extends { json?: boolean }>(
	operation: string,
	handler: (options: TOptions) => Promise<void>,
): (options: TOptions) => Promise<void> {
	return async (options) => {
		try {
			await handler(options);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			const fix =
				error instanceof SupervisionRefusal
					? error.fix
					: error instanceof ProcessDeclarationError
						? "Fix the declaration in .refarm/config.json, then try again."
						: null;
			const reason =
				error instanceof SupervisionRefusal
					? error.reason
					: error instanceof ProcessAddRefusal
						? error.code
						: "process-failed";
			// A refusal that knows the command which fixes it hands it over; everything else falls
			// back to `--help`, which is honest about knowing nothing more specific.
			const nextCommands =
				error instanceof ProcessAddRefusal ? error.nextCommands : [PROCESS_HELP_COMMAND];
			if (options.json) {
				printJson(
					buildJsonErrorEnvelope({
						command: "process",
						operation,
						// `ProcessAddRefusal` codes are already namespaced (`process-add-…`); a
						// `SupervisionRefusal` reason is a bare word and gets the prefix here.
						error: error instanceof ProcessAddRefusal ? reason : `process-${reason}`,
						message,
						nextAction: fix ?? `Run \`${nextCommands[0] ?? PROCESS_HELP_COMMAND}\`.`,
						nextCommand: nextCommands[0] ?? PROCESS_HELP_COMMAND,
						nextCommands,
					}),
				);
			} else {
				console.error(chalk.red(`✗  ${message}`));
				console.error(chalk.dim(`   ${fix ?? nextCommands[0] ?? PROCESS_HELP_COMMAND}`));
				if (fix) for (const next of nextCommands) console.error(chalk.dim(`   ${next}`));
			}
			process.exitCode = 1;
		}
	};
}

/**
 * Where the operator goes next, per outcome.
 *
 * `ok` means "the command did its job", not "the answer was yes" — declining, deferring and
 * cancelling are all successful runs of a command whose job was to ask. What changes is the
 * handoff, because those lead to genuinely different next steps.
 */
function addNextAction(result: ProcessAddResult): string | null {
	switch (result.status) {
		case "declared":
			return (
				`Declared. Nothing is supervised yet and no systemctl ran — \`${result.installCommand}\` ` +
				"proposes the unit, shows it exactly, and then hands you the activation line."
			);
		case "declined":
			return "Nothing was written. The refusal is recorded, so this will not be asked again.";
		case "deferred":
			return "Nothing was written and nothing recorded — run it again when you want to decide.";
		case "cancelled":
			return "Cancelled. Nothing was written.";
		case "unchanged":
			return "Kept what was already there.";
	}
}

function addNextCommands(result: ProcessAddResult): string[] {
	if (result.status === "declared") {
		return [result.installCommand, PROCESS_STATUS_COMMAND, result.undoCommand];
	}
	return [PROCESS_LIST_COMMAND];
}

function printAddResult(result: ProcessAddResult): void {
	if (result.status !== "declared") {
		console.log(chalk.dim(addNextAction(result) ?? ""));
		return;
	}
	console.log(chalk.green(`✓  ${result.replaced ? "replaced" : "declared"} "${result.process}"`));
	console.log(chalk.dim(`   ${result.configPath}`));
	console.log(chalk.dim(`   command: ${result.command.join(" ")}`));
	if (result.workingDirectory) console.log(chalk.dim(`   cwd:     ${result.workingDirectory}`));
	console.log(chalk.dim(`   restart: ${result.restart}`));
	console.log(chalk.dim(`   undo:    ${result.undoCommand}`));
	// VERIFIED, not claimed: the real `process status`, read back after the write.
	for (const status of result.statuses)
		console.log(chalk.dim(`   ${describeProcessStatus(status)}`));
	console.log(chalk.dim(`   ${addNextAction(result)}`));
}

export function createProcessCommand(): Command {
	const command = new Command("process").description(
		"Long-running processes refarm owns — declared in .refarm/config.json, supervised by this host",
	);

	command
		.command("add")
		.description(
			"Declare a process, guided — proposes what refarm can derive, asks only what it cannot",
		)
		.argument("[name]", `Which process (refarm proposes: ${processRecipeNames().join(", ")})`)
		.option("--description <text>", "What it is FOR — becomes the unit's Description")
		.option(
			"--command <line>",
			"The command, as you would type it (must exec a program, not a shell)",
		)
		.option("--working-directory <path>", "Absolute directory the supervisor starts it from")
		.option("--restart <policy>", "always | on-failure | never — asked when not given")
		.option("--dir <path>", "For web-serve: the directory to serve")
		.option("--port <port>", "For web-serve: the port to listen on")
		.option("--replace", "Re-open a process that is already declared or already decided")
		.option(
			"--attended-elsewhere",
			"No terminal here, and that is fine — you are attending from another surface",
		)
		.option("--json", "Print the result as JSON")
		.action(async (name: string | undefined, options: ProcessAddOptions & { json?: boolean }) => {
			await guarded("add", async () => {
				const result = await runProcessAdd(
					{ ...options, ...(name ? { name } : {}) },
					{
						announce: (line) => {
							if (!options.json) process.stdout.write(`${line}\n`);
						},
					},
				);
				if (options.json) {
					printJson(
						buildJsonSuccessEnvelope({
							command: "process",
							operation: "add",
							nextAction: addNextAction(result),
							nextCommands: addNextCommands(result),
							extra: { ...result },
						}),
					);
					return;
				}
				printAddResult(result);
			})(options);
		});

	command
		.command("list")
		.description("What is declared, which supervisor would serve it, and what lifetime it gets")
		.option("--json", "Print the catalog as JSON")
		.action(
			guarded("list", async (options: { json?: boolean }) => {
				const result = await runProcessList();
				print(Boolean(options.json), result, [
					`supervisor: ${result.backend ?? "none"} — ${result.backendDetail}`,
					...(result.lifetime ? [`${result.lifetime}`] : []),
					"",
					...(result.processes.length === 0
						? ['no process is declared under "processes" in .refarm/config.json']
						: result.processes.flatMap((entry) => [
								`  ${entry.name} — ${entry.description}`,
								`      command: ${entry.command.join(" ")}`,
								`      restart: ${entry.restart}, stop timeout: ${entry.stopTimeoutSeconds}s`,
								...(entry.workingDirectory ? [`      cwd:     ${entry.workingDirectory}`] : []),
							])),
				]);
			}),
		);

	command
		.command("status")
		.description("Is it up? Answers 'not running', 'not declared' and 'could not ask' separately")
		.argument("[name...]", "Which declared processes to ask about (default: all)")
		.option("--json", "Print the report as JSON")
		.action(async (names: string[], options: { json?: boolean }) => {
			await guarded("status", async () => {
				const result = await runProcessStatus(names ?? []);
				print(Boolean(options.json), result, result.lines);
				// A declared process that is NOT known to be up is a failed check, and the exit code
				// says so — that is what makes this usable from a script that has to notice.
				if (!result.ok) process.exitCode = 1;
			})(options);
		});

	command
		.command("install")
		.description("Propose the supervisor unit for a declared process — shown exactly, then decided")
		.argument("<name>", "The declared process to supervise")
		.option("--revisit", "Re-open a decision you already made")
		.option("--json", "Print the result as JSON")
		.action(async (name: string, options: { json?: boolean; revisit?: boolean }) => {
			await guarded("install", async () => {
				const result = await runProcessInstall(
					name,
					{ ...(options.revisit ? { revisit: true } : {}) },
					{
						say: (line) => {
							if (!options.json) process.stdout.write(`${line}\n`);
						},
					},
				);
				print(Boolean(options.json), result, [
					`decisão: ${result.status}`,
					`unit:    ${result.unitPath}`,
					result.lifetime,
					...(result.activationCommands.length > 0
						? [
								"",
								"refarm escreveu o arquivo. Ligar é com você:",
								...result.activationCommands.map((line) => `  ${line}`),
							]
						: []),
				]);
			})(options);
		});

	command
		.command("uninstall")
		.description("Undo the recorded installation — removes the unit refarm wrote")
		.argument("<name>", "The declared process whose unit should go")
		.option("--json", "Print the result as JSON")
		.action(async (name: string, options: { json?: boolean }) => {
			await guarded("uninstall", async () => {
				const result = await runProcessUninstall(name);
				print(Boolean(options.json), result, [
					`removido: ${result.removedPath}`,
					`registro: ${result.recordId}`,
					"",
					"Se a unit estava habilitada, pare-a você mesmo:",
					`  ${result.stopCommand}`,
				]);
			})(options);
		});

	command
		.command("linger")
		.description(
			"Ask to keep your services running after you log out — a SEPARATE grant, never bundled",
		)
		.option("--revisit", "Re-open a decision you already made")
		.option("--json", "Print the result as JSON")
		.action(
			guarded("linger", async (options: { json?: boolean; revisit?: boolean }) => {
				const result = await runProcessLinger(
					{ ...(options.revisit ? { revisit: true } : {}) },
					{
						say: (line) => {
							if (!options.json) process.stdout.write(`${line}\n`);
						},
					},
				);
				print(Boolean(options.json), result, [
					`usuário: ${result.user}`,
					`estado:  ${result.current} — ${result.detail}`,
					`decisão: ${result.status}`,
				]);
			}),
		);

	command.addHelpText(
		"after",
		`

Examples:
  $ ${refarmCommand(["process", "add", "web-serve"])}
  $ ${refarmCommand(["process", "add", "web-serve", "--restart", "always"])}
  $ ${refarmCommand(["process", "list", "--json"])}
  $ ${refarmCommand(["process", "install", "web-serve"])}

Notes:
  \`add\` is a humane path to the SAME .refarm/config.json: it PROPOSES what refarm can
  derive (the command, the directory, the port), asks only what it cannot — \`restart\`
  is never defaulted — shows the exact JSON, and writes only after you authorise it.
  Hand-editing the "processes" block keeps working, and \`add\` reads what you wrote.
  \`install\` writes the unit and then hands you the systemctl line; refarm never runs it.
`,
	);

	return command;
}

/** Re-exported so a caller can render a request without importing the consent block itself. */
export { renderOperationRequest };
