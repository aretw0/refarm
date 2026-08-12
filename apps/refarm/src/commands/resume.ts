import { buildJsonSuccessEnvelope, printJson } from "@refarm.dev/capabilities/envelope";
import { resolveWorkspaceLedger, type LedgerWorkspace } from "@refarm.dev/cli";
import { loadChatHistory } from "@refarm.dev/cli/chat-history";
import {
	buildOperatorResumeCommands,
	buildOperatorResumeEnvelope,
	buildOperatorResumeSummary,
	formatOperatorResumeSummary,
	type OperatorResumeAwaiting,
	type OperatorResumeEnvironmentPressure,
	type OperatorResumeModelSummary,
	type OperatorResumeProjectSummary,
	type OperatorResumeScheduledWorkInspection,
	type OperatorResumeSessionRecord,
} from "@refarm.dev/cli/operator-resume";
import {
	loadProjectScheduledWork,
	type ProjectScheduledWorkInspection,
} from "@refarm.dev/cli/project-automations";
import {
	parseProjectHandoffSummary,
	PROJECT_HANDOFF_RELATIVE_PATH,
} from "@refarm.dev/cli/project-handoff";
import { declaredBase, declaredWorkspacesFromConfig, loadConfig } from "@refarm.dev/config";
import { buildEnvironmentPressureReport } from "@refarm.dev/health/environment-pressure";
import {
	createFileOperationTrail,
	summariseStandingQuestions,
	type OperationQuestion,
} from "@refarm.dev/operation-consent-v1";
import { Command } from "commander";
import fs from "node:fs";
import path from "node:path";

import { refarmCommand } from "../brand.js";
import {
	agentFinishSessionFilePath,
	createAgentFinishSessionRecorder,
	type AgentFinishSessionRecorder,
} from "./agent-finish-session.js";
import { MODEL_CURRENT_JSON_COMMAND, MODEL_DOCTOR_JSON_COMMAND } from "./credential-handoffs.js";
import { buildCurrentModelStatus, defaultModelDeps, type ModelTokens } from "./model.js";
import { loadRecentRuntimeSessions } from "./session-history.js";
import { readActiveSessionId } from "./session-lock.js";
import { resolveStatusPayload, type ResolveStatusPayloadResult } from "./status.js";
import {
	createTaskSessionRecorder,
	taskSessionFilePath,
	type TaskSessionCheckpoint,
	type TaskSessionRecorder,
} from "./task-session.js";

// The app's operator-resume handoffs, built with its own binary name (ADR-087) —
// the generic operator-resume package names no binary; the app injects "refarm".
const RESUME_HANDOFFS = buildOperatorResumeCommands("refarm");

export interface ResumeDeps {
	resolveStatusPayload(options: { renderer?: string }): Promise<ResolveStatusPayloadResult>;
	sessionRecorder: TaskSessionRecorder;
	finishRecorder: AgentFinishSessionRecorder;
	readActiveSessionId(): string | null;
	loadRecentSessions(): Promise<OperatorResumeSessionRecord[]>;
	loadChatHistory(): string[];
	loadModelTokens(): Promise<ModelTokens>;
	/** Takes the optional `--workspace` id: `resume` must be able to answer about a workspace the
	 *  operator is not standing in (a phone, Termux, /tmp), and must SAY which one answered. */
	resolveProject(workspace?: string): ProjectHandoffResolutionResult;
	loadScheduledWork(): Promise<ProjectScheduledWorkInspection | undefined>;
	loadEnvironmentPressure(): OperatorResumeEnvironmentPressure | undefined;
	loadLedgerReads(): Record<string, LedgerReadResult>;
}

interface LoadScheduledWorkOptions {
	now?: string | Date;
	owner?: string;
}

interface ResumeOptions {
	workspace?: string;
	json?: boolean;
	status?: boolean;
	nextAction?: boolean;
	nextCommand?: boolean;
}

export function createResumeCommand(deps?: Partial<ResumeDeps>): Command {
	const resolvedDeps: ResumeDeps = {
		resolveStatusPayload,
		sessionRecorder: createTaskSessionRecorder(),
		finishRecorder: createAgentFinishSessionRecorder(),
		readActiveSessionId,
		loadRecentSessions: loadRecentRuntimeSessions,
		loadChatHistory,
		loadModelTokens: defaultModelDeps().loadTokens,
		resolveProject,
		loadScheduledWork,
		loadEnvironmentPressure,
		loadLedgerReads,
		...deps,
	};

	return new Command("resume")
		.description("Show the operator resume view across runtime and worker tasks")
		.option("--workspace <id>", "Report the project block for this declared workspace instead of the current directory's")
		.option("--json", "Print machine-readable JSON output")
		.option("--no-status", "Skip runtime status inspection and only read local checkpoints")
		.option("--next-action", "Print only the first recovery command and exit")
		.option("--next-command", "Alias for --next-action")
		.addHelpText(
			"after",
			`

Examples:
  $ refarm resume
  $ refarm resume --json
  $ refarm resume --next-action
  $ refarm resume --next-action --json
  $ refarm resume --no-status

Notes:
  This is the operator-level "where was I?" view. It combines runtime status
  with local worker task checkpoints and prints the next useful commands.
  Use refarm task resume for the task-only checkpoint view.
`,
		)
		.action(async (options: ResumeOptions) => {
			await emitResume(options, resolvedDeps);
		});
}

async function emitResume(options: ResumeOptions, deps: ResumeDeps): Promise<void> {
	const taskCheckpoint = deps.sessionRecorder.getCheckpoint();
	const finish = deps.finishRecorder.getLatest();
	const activeSessionId = deps.readActiveSessionId();
	const recentPrompts = deps.loadChatHistory().slice(0, 5);
	const projectResolution = deps.resolveProject(options.workspace);
	const project = projectResolution.summary;
	const scheduledWork = await deps.loadScheduledWork();
	const environmentPressure = deps.loadEnvironmentPressure();
	const ledger = buildLedgerSummary(deps.loadLedgerReads());
	const ledgerNextCommands = buildLedgerNextCommands(ledger);
	const model = await loadModelResumeSummary(deps);
	const recentSessions = options.status === false ? [] : await deps.loadRecentSessions();
	const statusResult =
		options.status === false
			? undefined
			: await deps.resolveStatusPayload({ renderer: "headless" });
	try {
		const status = statusResult?.json;
		// READ ONCE. Two call sites build from this input — the JSON envelope and the human
		// summary — and reading the trails twice would be two answers to one question, taken a
		// moment apart. The first version patched only the envelope, so `--json` reported what
		// was waiting and the human surface silently did not.
		const awaitingOperator = await loadAwaitingOperator();
		const envelope = buildOperatorResumeEnvelope({
			status,
			model,
			project,
			scheduledWork,
			taskCheckpoint,
			activeSessionId,
			recentSessions,
			recentPrompts,
			finish,
			environmentPressure,
			awaitingOperator,
			handoffs: RESUME_HANDOFFS,
		});

		// Appended AFTER the generic operator-resume handoffs, never ahead of them: a failed
		// finish or a not-ready runtime stays the first, most urgent `nextCommand` — the ledger
		// hint is "what else is left," not a replacement for active recovery.
		const nextCommands = [...new Set([...envelope.nextCommands, ...ledgerNextCommands])];

		const nextCommandMode = options.nextAction || options.nextCommand;
		if (nextCommandMode && options.json) {
			printJson(
				buildJsonSuccessEnvelope({
					command: "resume",
					operation: "operator",
					nextAction: envelope.nextAction,
					nextActions: envelope.nextActions,
					nextCommands,
					extra: {
						nextProcesses: envelope.nextProcesses,
					},
				}),
			);
			return;
		}
		if (nextCommandMode) {
			const [command] = nextCommands;
			if (command) {
				console.log(command);
			}
			return;
		}

		if (options.json) {
			printJson({
				...envelope,
				// ISS-092: `project` is ALWAYS present, explicitly null when nothing was read, and
				// `projectResolution` always says which of the four states produced it. The key used to
				// vanish, so a consumer doing `project?.currentTasks ?? []` saw an empty list and no
				// signal — the same "a zero that is not a zero" shape this line of work keeps finding.
				project: project ?? null,
				projectResolution: projectResolution.resolution,
				ledger,
				nextCommand: nextCommands[0] ?? null,
				nextCommands,
			});
			return;
		}

		const summary = buildOperatorResumeSummary({
			status,
			model,
			project,
			scheduledWork,
			taskCheckpoint,
			activeSessionId,
			recentSessions,
			recentPrompts,
			finish,
			environmentPressure,
			awaitingOperator,
			handoffs: RESUME_HANDOFFS,
		});
		console.log(formatOperatorResumeSummary(summary));
		if (nextCommands.length > 0) {
			console.log("");
			console.log("Next commands:");
			for (const command of nextCommands) {
				console.log(`  ${command}`);
			}
		}
	} finally {
		await statusResult?.shutdown?.();
	}
}

/**
 * What this node is waiting on the operator for, read from the consent trails.
 *
 * ## Why the paths are a LIST and not a search
 *
 * Every trail this repo writes is named `operations.json`, in the directory that owns the thing it
 * records — processes beside processes, certificates beside certificates, catalog decisions beside
 * the config they change. That is a convention, not a registry, so this names them. A recursive
 * search would find trails belonging to other roots and report another node's questions as this
 * one's, which is the directory-versus-node confusion in a new costume.
 *
 * ## Absent is not empty
 *
 * Returns `null` when nothing could be read at all, so `resume` prints nothing rather than
 * "nothing is waiting" — a sentence that would be a claim. An empty summary, by contrast, IS the
 * claim, and it is the one that lets an operator stop wondering.
 *
 * Never throws: `resume` is the command an operator runs when they have lost the thread, and a
 * trail it cannot parse must not be the reason they cannot run it.
 */
async function loadAwaitingOperator(): Promise<OperatorResumeAwaiting | null> {
	try {
		const root = declaredBase();
		const paths = [
			path.join(root, ".refarm", "processes", "operations.json"),
			path.join(root, ".refarm", "tls", "operations.json"),
			path.join(root, ".refarm", "operations.json"),
		];
		const questions: OperationQuestion[] = [];
		for (const trailPath of paths) {
			const trail = createFileOperationTrail(trailPath);
			questions.push(...((await trail.readQuestions?.()) ?? []));
		}
		const summary = summariseStandingQuestions(questions, new Date().toISOString());
		const flatten = (list: OperationQuestion[]) =>
			list.map((question) => ({
				requestId: question.requestId,
				title: question.title,
				requester: question.requester,
				askedAt: question.askedAt,
				expiresAt: question.expiresAt,
			}));
		return { outstanding: flatten(summary.outstanding), expired: flatten(summary.expired) };
	} catch {
		return null;
	}
}

export function loadEnvironmentPressure(): OperatorResumeEnvironmentPressure | undefined {
	try {
		const report = buildEnvironmentPressureReport({
			command: "environment-pressure",
			operation: "resume",
			sessionFiles: loadKnownSessionPressureFiles(),
			guidance: {
				diskPressureAction:
					"Run `pnpm run clean:rust:check`, then choose the smallest cleanup tier from docs/local-disk-hygiene.md before broad builds.",
				diskPressureCommand: "pnpm run clean:rust:check",
				diskProbeFailureAction: "Run `pnpm run disk:check` only if disk pressure is suspected.",
				diskProbeFailureCommand: "pnpm run disk:check",
				memoryPressureAction:
					"Use explicit test files, bounded workers, and package-scoped checks until memory pressure drops.",
				gitGcLogAction:
					"Inspect `.git/gc.log`; do not run prune or destructive Git cleanup from an agent without explicit operator intent.",
			},
		});
		return {
			command: report.command,
			operation: report.operation,
			ok: report.ok,
			decision: report.decision,
			signals: report.signals,
			nextCommands: report.nextCommands,
		};
	} catch {
		return undefined;
	}
}

export interface SessionPressureFile {
	path: string;
	bytes: number;
}

export function loadKnownSessionPressureFiles(baseDir?: string): SessionPressureFile[] {
	return [taskSessionFilePath(baseDir), agentFinishSessionFilePath(baseDir)].flatMap(
		(sessionPath) => {
			try {
				const stat = fs.statSync(sessionPath);
				if (!stat.isFile()) return [];
				return [{ path: sessionPath, bytes: stat.size }];
			} catch {
				return [];
			}
		},
	);
}

/** The low-level reader: the handoff at THIS directory. `cwd` is required — the `= process.cwd()`
 *  default it used to carry is the exact shape
 *  `docs/superpowers/plans/2026-08-07-no-resolver-defaults-to-the-os.md` calls the footgun, and it
 *  was how `resume` came to read a project nobody chose. Deciding WHICH directory is
 *  `resolveProjectHandoff`'s job, below; this function only reads the one it is handed. */
export function loadProjectHandoff(cwd: string): OperatorResumeProjectSummary | undefined {
	const handoffPath = path.join(cwd, PROJECT_HANDOFF_RELATIVE_PATH);
	try {
		return parseProjectHandoffSummary(JSON.parse(fs.readFileSync(handoffPath, "utf-8")), {
			arrayLimit: 5,
		});
	} catch {
		return undefined;
	}
}

/**
 * FOUR STATES, and the old code had one. `loadProjectHandoff` returned `undefined` for "there is no
 * project here", "the handoff is corrupt", and "the handoff exists and was never checkpointed"
 * alike, and `resume` then omitted the key entirely — so from outside a project the envelope said
 * `ok: true` with no project, no tasks, no blockers and `truncation: null`. A consumer reading
 * `project?.currentTasks ?? []` got an empty list and no signal at all (ISS-092).
 */
export type ProjectHandoffResolution =
	| { state: "read"; workspaceId: string | null; from: "flag" | "cwd-match" | "cwd-convention"; path: string; catalogError?: string }
	| { state: "empty"; workspaceId: string | null; from: "flag" | "cwd-match" | "cwd-convention"; path: string; catalogError?: string }
	| { state: "unreadable"; workspaceId: string | null; path: string; reason: string; catalogError?: string }
	| {
			state: "absent";
			reason: "no-project-here" | "no-such-workspace" | "no-handoff-in-workspace";
			workspaceId?: string;
			cwd: string;
			declared: string[];
			/** Set when the node's catalog could not be READ at all — a different fact from "this node
			 *  declares no workspaces", and one `resume` must never present as the latter. */
			catalogError?: string;
	  };

export interface ProjectHandoffResolutionResult {
	summary: OperatorResumeProjectSummary | undefined;
	resolution: ProjectHandoffResolution;
}

export interface ResolveProjectHandoffInput {
	/** An explicit workspace id. This is what lets `resume` answer about refarm from a phone, a
	 *  Termux session or `/tmp` — anywhere the operator is not standing in the checkout. */
	workspace?: string;
	/** A DELIBERATE cwd read, used only to match against the declared catalog or, failing that, to
	 *  look for a project by convention. Always reported in `from`. */
	cwd: string;
	loadWorkspaces: () => LedgerWorkspace[];
	fileExists: (candidate: string) => boolean;
	readDocument: (candidate: string) => string;
}

function isInsideDirectory(parent: string, candidate: string): boolean {
	const relative = path.relative(parent, candidate);
	return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

/**
 * Resolves WHICH project `resume` should report on, through the node's declared catalog — the same
 * way this module's `ledger` block already resolves, so one envelope stops carrying two resolution
 * models.
 *
 * Precedence, each step reported rather than inferred: an explicit `--workspace` id; else the
 * longest declared workspace containing `cwd`; else a `.project/handoff.json` sitting in `cwd`
 * itself, read and reported as `cwd-convention` so a checkout nobody declared keeps working and
 * says that it was inferred; else absent, naming where it looked and what this node declares.
 */
export function resolveProjectHandoff(input: ResolveProjectHandoffInput): ProjectHandoffResolutionResult {
	// `resume` is the command that must ALWAYS answer — it is what an operator runs when he does not
	// know what state anything is in, and CLAUDE.md mandates it at the start of every slice. A
	// catalog that cannot be read degrades this block to the convention path and is REPORTED;
	// it never takes the whole envelope down with it. (Found by the test suite: the first version
	// of this resolver let `loadConfig` throw straight through `emitResume`.)
	let workspaces: LedgerWorkspace[] = [];
	let catalogError: string | undefined;
	try {
		workspaces = input.loadWorkspaces();
	} catch (error) {
		catalogError = error instanceof Error ? error.message : String(error);
	}
	const declared = workspaces.map((workspace) => workspace.id);
	const withCatalogError = <T extends object>(resolution: T): T & { catalogError?: string } =>
		catalogError ? { ...resolution, catalogError } : resolution;

	let root: string | undefined;
	let workspaceId: string | null = null;
	let from: "flag" | "cwd-match" | "cwd-convention";

	if (input.workspace) {
		const match = workspaces.find((workspace) => workspace.id === input.workspace);
		if (!match) {
			return {
				summary: undefined,
				resolution: withCatalogError({ state: "absent" as const, reason: "no-such-workspace" as const, cwd: input.cwd, declared }),
			};
		}
		root = match.absolutePath;
		workspaceId = match.id;
		from = "flag";
	} else {
		// LONGEST match wins, so a workspace nested inside another is not shadowed by its parent —
		// the same rule `resolveWorkspaceLedger` follows for the ledger.
		const match = workspaces
			.filter((workspace) => isInsideDirectory(workspace.absolutePath, input.cwd))
			.sort((left, right) => right.absolutePath.length - left.absolutePath.length)[0];
		if (match) {
			root = match.absolutePath;
			workspaceId = match.id;
			from = "cwd-match";
		} else {
			root = input.cwd;
			from = "cwd-convention";
		}
	}

	const handoffPath = path.join(root, PROJECT_HANDOFF_RELATIVE_PATH);
	if (!input.fileExists(handoffPath)) {
		return {
			summary: undefined,
			resolution: withCatalogError({
				state: "absent" as const,
				reason: (workspaceId ? "no-handoff-in-workspace" : "no-project-here") as
					| "no-handoff-in-workspace"
					| "no-project-here",
				...(workspaceId ? { workspaceId } : {}),
				cwd: input.cwd,
				declared,
			}),
		};
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(input.readDocument(handoffPath));
	} catch (error) {
		return {
			summary: undefined,
			resolution: withCatalogError({
				state: "unreadable" as const,
				workspaceId,
				path: handoffPath,
				reason: error instanceof Error ? error.message : String(error),
			}),
		};
	}

	const summary = parseProjectHandoffSummary(parsed, { arrayLimit: 5 });
	if (!summary) {
		// The document is there and holds no checkpoint. That is a real state — a project nobody has
		// written a handoff for yet — and folding it into `absent` would tell the operator to go
		// looking for a project that is right in front of him.
		return {
			summary: undefined,
			resolution: withCatalogError({ state: "empty" as const, workspaceId, from, path: handoffPath }),
		};
	}
	return { summary, resolution: withCatalogError({ state: "read" as const, workspaceId, from, path: handoffPath }) };
}

/** The default seam: the node's declared catalog and the real filesystem. */
export function resolveProject(workspace?: string): ProjectHandoffResolutionResult {
	return resolveProjectHandoff({
		workspace,
		cwd: currentDirectoryForCatalogMatch(),
		loadWorkspaces: defaultLedgerIo.loadWorkspaces,
		fileExists: defaultLedgerIo.fileExists,
		readDocument: defaultLedgerIo.readDocument,
	});
}

export async function loadScheduledWork(
	// os-resolution: project — scheduled work is declared per project, in the tree the operator is standing in
	cwd: string = process.cwd(),
	options: LoadScheduledWorkOptions = {},
): Promise<OperatorResumeScheduledWorkInspection | undefined> {
	return loadProjectScheduledWork({ cwd, ...options });
}

export interface LedgerReadResult {
	ok: boolean;
	items?: { id: string; status: string; axis?: string }[];
	error?: { reason: string; message: string };
}

export interface LedgerSummary {
	workspaces: Record<string, { open: number; unclassified: number; byAxis: Record<string, number> }>;
	unreadable: Record<string, { reason: string; message?: string }>;
}

/** PURE. Takes already-read results so it is testable without a filesystem, and so a slow or
 * failing workspace cannot change the shape of the answer. There is no `total` field, and
 * adding one later would be a regression: summing open items across workspaces is exactly the
 * mixing the operator ruled out when he said issues from different workspaces must never mix. */
export function buildLedgerSummary(reads: Record<string, LedgerReadResult>): LedgerSummary {
	const workspaces: LedgerSummary["workspaces"] = {};
	const unreadable: LedgerSummary["unreadable"] = {};

	for (const [id, read] of Object.entries(reads)) {
		if (!read.ok) {
			unreadable[id] = read.error ?? { reason: "unknown" };
			continue; // NEVER `workspaces[id] = { open: 0 }` — unreadable is not empty.
		}
		const open = (read.items ?? []).filter((item) => item.status === "open");
		const byAxis: Record<string, number> = {};
		for (const item of open) {
			if (!item.axis) continue; // unclassified is its own row, never an axis bucket
			byAxis[item.axis] = (byAxis[item.axis] ?? 0) + 1;
		}
		workspaces[id] = {
			open: open.length,
			unclassified: open.filter((item) => !item.axis).length,
			byAxis,
		};
	}

	return { workspaces, unreadable };
}

/** The workspace with the most open items becomes `resume`'s ledger handoff — never a
 *  cross-workspace sum (there is no `total` on `LedgerSummary`, see above). Ties keep the
 *  first-encountered id, which is alphabetical in production
 *  (`declaredWorkspacesFromConfig` sorts by `id.localeCompare`). Empty when no workspace has
 *  any open item — `resume` must not invent a handoff for a clean ledger. */
export function buildLedgerNextCommands(ledger: LedgerSummary): string[] {
	let busiest: string | undefined;
	let busiestOpen = 0;
	for (const [id, workspace] of Object.entries(ledger.workspaces)) {
		if (workspace.open > busiestOpen) {
			busiest = id;
			busiestOpen = workspace.open;
		}
	}
	return busiest ? [refarmCommand(["issues", "list", "--workspace", busiest, "--json"])] : [];
}

/** Every filesystem read `loadLedgerReads` performs, gathered behind one seam so a test can
 *  inject a fake catalog and fake ledger documents without touching the operator's real
 *  `~/.refarm/config.json` or any real `.project/issues.json`. Structurally identical to
 *  `IssuesIo` in `./issues.js` (same four methods) — kept as its own copy here, NOT extracted
 *  into `@refarm.dev/cli` alongside `resolveWorkspaceLedger`, on a judgement call: both copies
 *  are pure interface shape with no behavior of their own, `resolveWorkspaceLedger`'s own
 *  `ResolveLedgerInput` already names the same four fields as its parameter type (so a real
 *  drift would surface as a type error at either call site, not silently), and hoisting a
 *  fifth copy of this shape into a published, dist-mode package for two four-line interfaces
 *  is not proportionate to the duplication it would remove. Revisit if a THIRD command needs
 *  the same seam — that is the point at which one shared shape earns its keep. */
export interface LedgerIo {
	loadWorkspaces: () => LedgerWorkspace[];
	fileExists: (candidate: string) => boolean;
	readDocument: (candidate: string) => string;
	writeDocument: (candidate: string, contents: string) => void;
}

/** `declaredWorkspacesFromConfig` is JS-inferred as returning `(… | null)[]` because its
 *  `.filter(Boolean)` does not narrow for TypeScript — filtered here, explicitly, rather than
 *  widening `LedgerWorkspace` to tolerate `null` (same shape as `./issues.js`'s copy). */
function defaultLoadWorkspaces(): LedgerWorkspace[] {
	const baseDir = declaredBase();
	return declaredWorkspacesFromConfig(loadConfig(baseDir), { baseDir }).filter(
		(workspace): workspace is NonNullable<typeof workspace> => workspace !== null,
	);
}

const defaultLedgerIo: LedgerIo = {
	loadWorkspaces: defaultLoadWorkspaces,
	fileExists: (candidate: string) => fs.existsSync(candidate),
	readDocument: (candidate: string) => fs.readFileSync(candidate, "utf-8"),
	writeDocument: (candidate: string, contents: string) => fs.writeFileSync(candidate, contents),
};

/** THE ONE DELIBERATE cwd READ in this module — satisfies `resolveWorkspaceLedger`'s required
 *  `cwd` field and is never actually consulted: every call below passes an explicit `workspace`
 *  id with `enumerated: true`, so the resolver's cwd-match branch never runs. Wrapped in a
 *  named, documented function (a `return`, never a bare `= process.cwd()` default or `??`
 *  fallback) so it reads as the same deliberate, reported, non-default read `./issues.js`
 *  documents for the identical reason — not a silent OS fallback of the kind
 *  `scripts/no-os-resolution.mjs` exists to catch. */
function currentDirectoryForCatalogMatch(): string {
	return process.cwd();
}

/** `resolveWorkspaceLedger`'s `ok: false` branch names a `reason` but not a message — this
 *  echoes the BASE wording `refuse()` in `./issues.js` uses for the same three reasons, but
 *  deliberately NOT the full strings: `refuse()`'s messages are CLI stderr guidance for a
 *  human who typed `--workspace <id>` (they append `Declared: <list>` and, for
 *  `cwd_unmatched`, `Pass --workspace <id>.`) — a suffix that does not belong in a JSON ledger
 *  row's `error.message`, and would be actively misleading here besides: `resume` always
 *  passes an explicit `workspace` id drawn from the SAME catalog it just enumerated, so
 *  `no_such_workspace` and `cwd_unmatched` are unreachable in practice (kept only so this
 *  table stays exhaustive over `LedgerResolution`'s reason union) and `no_provider` is the
 *  only one that can really fire in practice today — `provider_unsupported` joins it as
 *  reachable the day any declared workspace names a provider with no adapter (`github`,
 *  `gitlab`). A shared helper would have to take a "for a human CLI refusal, or for a JSON
 *  reason table" flag to serve both call sites correctly — more machinery than the ~3 lines of
 *  overlap it would save. Left duplicated for that reason. */
const RESOLUTION_FAILURE_MESSAGES: Record<string, string> = {
	no_such_workspace: "No declared workspace with that id.",
	cwd_unmatched: "This directory is inside no declared workspace.",
	no_provider: "This workspace declares no work-item provider and has no .project/issues.json.",
	provider_unsupported: "This workspace declares a work-item provider with no adapter yet.",
};

/**
 * Reads every declared workspace's ledger DEFENSIVELY, through `resolveWorkspaceLedger` (Task
 * 4) — the same resolver `refarm issues` uses, so `resume`'s counts and `issues list`'s counts
 * can never drift apart by walking two different paths to the same document. A throw anywhere
 * in ONE workspace's read (a malformed document, an adapter bug, a filesystem error) lands
 * THAT workspace's row in `unreadable` and never aborts the read for any other declared
 * workspace, nor the `resume` envelope as a whole — `resume` is the first command an operator
 * runs, and degrading it to a hard error because one ledger is malformed would be worse than
 * the defect it exists to report.
 */
export function loadLedgerReads(io: LedgerIo = defaultLedgerIo): Record<string, LedgerReadResult> {
	const reads: Record<string, LedgerReadResult> = {};
	let workspaces: LedgerWorkspace[];
	try {
		workspaces = io.loadWorkspaces();
	} catch {
		return reads; // No declared catalog readable — an empty ledger, not a crashed resume.
	}

	for (const workspace of workspaces) {
		try {
			const resolution = resolveWorkspaceLedger({
				workspace: workspace.id,
				enumerated: true,
				cwd: currentDirectoryForCatalogMatch(),
				loadWorkspaces: io.loadWorkspaces,
				fileExists: io.fileExists,
				readDocument: io.readDocument,
				writeDocument: io.writeDocument,
			});
			if (!resolution.ok) {
				reads[workspace.id] = {
					ok: false,
					error: {
						reason: resolution.reason,
						message: RESOLUTION_FAILURE_MESSAGES[resolution.reason] ?? resolution.reason,
					},
				};
				continue;
			}
			const read = resolution.adapter.list();
			reads[workspace.id] = read.ok
				? { ok: true, items: read.items }
				: {
						ok: false,
						error: read.error ?? {
							reason: "document_unreadable",
							message: "Could not read this workspace's ledger.",
						},
					};
		} catch (error) {
			reads[workspace.id] = {
				ok: false,
				error: {
					reason: "ledger_read_failed",
					message: error instanceof Error ? error.message : String(error),
				},
			};
		}
	}
	return reads;
}

async function loadModelResumeSummary(
	deps: Pick<ResumeDeps, "loadModelTokens">,
): Promise<OperatorResumeModelSummary | undefined> {
	try {
		const tokens = await deps.loadModelTokens();
		const status = buildCurrentModelStatus(tokens);
		return {
			current: {
				scope: "default",
				provider: status.current.provider,
				modelId: status.current.modelId,
				ref: status.current.ref,
			},
			routes: status.routes,
			credential: {
				state: status.credential.state,
				status: status.credential.status,
				envKey: status.credential.envKey,
			},
			source: status.source.kind,
			inspectCommand: MODEL_CURRENT_JSON_COMMAND,
			doctorCommand: MODEL_DOCTOR_JSON_COMMAND,
		};
	} catch {
		return undefined;
	}
}

export type { TaskSessionCheckpoint };

export const resumeCommand = createResumeCommand();
