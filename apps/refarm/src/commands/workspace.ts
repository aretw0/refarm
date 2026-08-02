import {
	buildJsonErrorEnvelope,
	buildJsonSuccessEnvelope,
	printJson,
} from "@refarm.dev/capabilities/envelope";
import {
	buildCommandPlanRunEnvelope,
	runCommandPlan,
	runCommandPlanProcessStep,
	type CommandPlanStep,
	type CommandPlanStepRunResult,
	type CommandProcessSpec,
} from "@refarm.dev/cli/command-plan";
import { createProcessHandoffDisplay, runProcessHandoff } from "@refarm.dev/cli/process-handoff";
import {
	workspaceExecutionRecommendations as baseWorkspaceExecutionRecommendations,
	buildWorkspaceSourceCachePlan,
	buildWorkspaceSweepPayload,
	missingWorkspacePathMessage,
	observeDeclaredWorkspaceExecution as observeBaseDeclaredWorkspaceExecution,
	observeDeclaredWorkspacesExecution as observeBaseDeclaredWorkspacesExecution,
	resolveDeclaredWorkspacePath,
	summarizeWorkspaceExecutionObservations as summarizeBaseWorkspaceExecutionObservations,
	workspaceSweepRecommendationNextCommands,
	type WorkspacePathCandidate,
	type WorkspacePathResolution,
	type WorkspaceSweepObservation,
	type WorkspaceSweepPayload,
	type WorkspaceSweepRecommendation,
	type WorkspaceSweepSummary,
} from "@refarm.dev/cli/workspace-sweep";
import {
	declaredWorkspaceFromConfig,
	declaredWorkspacesFromConfig,
	loadConfig,
	type DeclaredWorkspaceConfig,
} from "@refarm.dev/config";
import chalk from "chalk";
import { Command } from "commander";
import path from "node:path";
import { refarmCommand } from "../brand.js";
import {
	runWorkspaceAdd,
	WorkspaceAddRefusal,
	type WorkspaceAddOptions,
} from "./workspace-add.js";
import {
	runWorkspaceCommandAdd,
	WorkspaceCommandAddRefusal,
} from "./workspace-command-add.js";
import {
	buildWorkspaceExecutionStatus,
	type WorkspaceExecutionStatus,
} from "./workspace-execution.js";

const WORKSPACE_HELP_COMMAND = refarmCommand(["workspace", "--help"]);
const WORKSPACE_ADD_COMMAND = refarmCommand(["workspace", "add"]);

/**
 * The action boundary — the same one `commands/intention.ts` adopted in 0534737b, and
 * for the same reason: a validation error must REFUSE, not throw. An operator-facing
 * command must never surface a raw Node stack trace, and a `--json` consumer must get
 * an envelope on the error path too.
 *
 * Found by `test/architecture/cli-refusal-conformance.test.ts`: `refarm workspace
 * sources materialize` (and `refresh`) with neither `--dry-run` nor `--run` threw
 * straight out of the action. Every `throw` below stays exactly where it is — this is
 * the single place they stop being internal signals.
 */
function failWorkspace(operation: string, options: { json?: boolean }, error: unknown): void {
	const message = error instanceof Error ? error.message : String(error);
	if (options.json) {
		printJson(
			buildJsonErrorEnvelope({
				command: "workspace",
				operation,
				error: "workspace-invalid-request",
				message,
				nextAction: `Run \`${WORKSPACE_HELP_COMMAND}\` to see the accepted options.`,
				nextCommand: WORKSPACE_HELP_COMMAND,
			}),
		);
	} else {
		console.error(chalk.red(`✗  ${message}`));
		console.error(chalk.dim(`   ${WORKSPACE_HELP_COMMAND}`));
	}
	process.exitCode = 1;
}

/** Wrap an action so a thrown validation error becomes the repo's refusal shape
 *  instead of an uncaught exception. */
function guardedWorkspace<TOptions extends { json?: boolean }>(
	operation: string,
	handler: (options: TOptions, command: Command) => void,
): (options: TOptions, command: Command) => void {
	return (options, command) => {
		try {
			handler(options, command);
		} catch (error) {
			failWorkspace(operation, options, error);
		}
	};
}

export interface WorkspaceExecutionCommandOptions {
	cwd?: string;
	workspace?: string;
	all?: boolean;
	json?: boolean;
}

export interface WorkspaceListCommandOptions {
	json?: boolean;
}

export interface WorkspaceStatusCommandOptions {
	json?: boolean;
}

export interface WorkspaceMountsCommandOptions {
	json?: boolean;
}

export interface WorkspaceSourcesCommandOptions {
	json?: boolean;
}

export interface WorkspaceSourceMaterializeCommandOptions {
	dryRun?: boolean;
	run?: boolean;
	json?: boolean;
}

export interface WorkspaceSourceRefreshCommandOptions {
	dryRun?: boolean;
	run?: boolean;
	json?: boolean;
}

export interface WorkspaceSourceDeclarationsCommandOptions {
	json?: boolean;
}

export interface WorkspaceCommandDeps {
	cwd?: () => string;
	env?: NodeJS.ProcessEnv;
	loadConfig?: (root?: string) => unknown;
	runCommandPlanStep?: (step: CommandPlanStep) => CommandPlanStepRunResult;
}

export type WorkspaceExecutionObservation = WorkspaceSweepObservation<WorkspaceExecutionStatus> & {
	declaredWorkspace: DeclaredWorkspaceConfig;
};
export type WorkspaceExecutionSummary = WorkspaceSweepSummary;
export type WorkspaceExecutionRecommendation = WorkspaceSweepRecommendation;
export type WorkspaceExecutionSweepPayload = Omit<
	WorkspaceSweepPayload<WorkspaceExecutionStatus>,
	"observations"
> & {
	observations: WorkspaceExecutionObservation[];
};
export type { WorkspacePathCandidate, WorkspacePathResolution };

const WORKSPACE_MOUNTS_JSON_COMMAND = refarmCommand(["workspace", "mounts", "--json"]);
const WORKSPACE_SOURCES_JSON_COMMAND = refarmCommand(["workspace", "sources", "--json"]);
const WORKSPACE_SOURCES_MATERIALIZE_DRY_RUN_JSON_COMMAND = refarmCommand([
	"workspace",
	"sources",
	"materialize",
	"--dry-run",
	"--json",
]);
const WORKSPACE_SOURCES_REFRESH_DRY_RUN_JSON_COMMAND = refarmCommand([
	"workspace",
	"sources",
	"refresh",
	"--dry-run",
	"--json",
]);
const WORKSPACE_SOURCES_DECLARATIONS_JSON_COMMAND = refarmCommand([
	"workspace",
	"sources",
	"declarations",
	"--json",
]);

function printWorkspaceExecutionStatus(status: WorkspaceExecutionStatus): void {
	console.log(chalk.bold("Workspace execution"));
	console.log(`  root:     ${status.root}`);
	console.log(chalk.dim(`  source:   ${status.rootSource}`));
	console.log(`  executor: ${status.executor.selected}`);
	console.log(chalk.dim(`  reason:   ${status.executor.reason}`));
	console.log(
		`  turbo:    ${
			status.adapters.turbo.configured
				? status.adapters.turbo.available
					? "available"
					: "not provisioned"
				: "not configured"
		}`,
	);
	if (status.adapters.turbo.installCommand) {
		console.log(chalk.dim(`  install:  ${status.adapters.turbo.installCommand}`));
	}
	console.log(
		`  cache:    local ${
			status.cache.local.available ? "available" : "not found"
		}, remote ${status.cache.remote.configured ? "configured" : "not configured"}`,
	);
	if (!status.cache.remote.configured) {
		console.log(chalk.dim(`  remote:   ${status.cache.remote.provisionCommand}`));
	}
}

function printWorkspaceExecutionObservations(observations: WorkspaceExecutionObservation[]): void {
	const summary = summarizeWorkspaceExecutionObservations(observations);
	console.log(chalk.bold("Workspace execution"));
	console.log(
		chalk.dim(`  summary: ${summary.ok}/${summary.total} ready, ${summary.failed} failed`),
	);
	if (observations.length === 0) {
		console.log(chalk.dim("  none declared"));
		return;
	}
	for (const observation of observations) {
		const workspace = observation.declaredWorkspace;
		if (!observation.ok || !observation.status) {
			console.log(`  ${workspace.id}: failed`);
			console.log(chalk.dim(`    path: ${workspace.path}`));
			if (observation.resolution.candidates.length > 0) {
				console.log(chalk.dim(`    candidates: ${observation.resolution.candidates.length}`));
			}
			console.log(chalk.dim(`    error: ${observation.error?.message ?? "unknown error"}`));
			continue;
		}
		console.log(`  ${workspace.id}: ${observation.status.executor.selected}`);
		console.log(chalk.dim(`    path: ${workspace.path}`));
		console.log(chalk.dim(`    root: ${observation.status.root}`));
		console.log(
			chalk.dim(
				`    cache: local ${
					observation.status.cache.local.available ? "available" : "not found"
				}, remote ${observation.status.cache.remote.configured ? "configured" : "not configured"}`,
			),
		);
	}
}

function printDeclaredWorkspaces(workspaces: DeclaredWorkspaceConfig[]): void {
	console.log(chalk.bold("Configured workspaces"));
	if (workspaces.length === 0) {
		console.log(chalk.dim("  none declared"));
		console.log(chalk.dim(`  declare one: ${WORKSPACE_ADD_COMMAND}`));
		return;
	}
	for (const workspace of workspaces) {
		console.log(`  ${workspace.id}: ${workspace.path}`);
		console.log(chalk.dim(`    kind: ${workspace.kind}`));
		console.log(chalk.dim(`    execution: ${workspace.execution.preferredAdapter}`));
		if (workspace.cache.remote) {
			console.log(chalk.dim(`    remote cache: ${workspace.cache.remote.provider}`));
		}
	}
}

function loadDeclaredWorkspaces(
	deps: WorkspaceCommandDeps | undefined,
	baseDir: string,
): DeclaredWorkspaceConfig[] {
	const config = (deps?.loadConfig ?? loadConfig)(baseDir);
	return declaredWorkspacesFromConfig(config, { baseDir });
}

/** One entry of a workspace's declared command allowlist (from `@refarm.dev/config`; runtime
 * shape carried by `normalizeWorkspaceCommands`). Bridged locally so this file doesn't depend on
 * the base config type exposing it. */
export interface WorkspaceDeclaredCommand {
	run: string[];
	cwd?: string;
	description?: string;
}

/** How a resolved declared command is actually executed — injected so the resolver is testable
 * without spawning a process, and so a remote surface can swap in a streaming runner later. */
export interface WorkspaceRunSpec {
	command: string;
	args: string[];
	cwd: string;
	env?: NodeJS.ProcessEnv;
}
export type WorkspaceRunner = (spec: WorkspaceRunSpec) => Promise<number>;

export interface WorkspaceRunResult {
	workspace: string;
	command: string;
	argv: string[];
	cwd: string;
	exitCode: number;
}

function workspaceCommands(
	workspace: DeclaredWorkspaceConfig,
): Record<string, WorkspaceDeclaredCommand> {
	return (
		(workspace as { commands?: Record<string, WorkspaceDeclaredCommand> }).commands ?? {}
	);
}

/**
 * The real runner — a thin caller of the `@refarm.dev/process-handoff` boundary
 * (`runProcessHandoff`) with `capture: false`, which the boundary maps to INHERITED
 * stdio, so a local `run` is fully interactive (the command's own prompts/notices/
 * streaming reach the terminal — e.g. serpro-vpn's "approve the push" + "Conectado"). A
 * command that holds (a VPN tunnel) holds this too.
 *
 * Deliberately NOT given `timeout` or `outputCap`: those are guarantees the boundary
 * grew for the connection probe (`commands/connection.ts`'s `runProbeProcess`), a
 * short-lived, non-interactive check. This runner is the opposite case — an operator
 * mid-login is exactly who a timeout would kill, which is the pain this whole lane
 * (`docs/CONVERGENCE-LANE.md`) exists to fix. `spawnErrorAsResult` IS used, so a missing
 * binary or bad cwd is a result to branch on rather than a rejection to catch — but the
 * observable behavior is unchanged: exit code 127, with the same logged message.
 */
async function defaultWorkspaceRunner(spec: WorkspaceRunSpec): Promise<number> {
	const result = await runProcessHandoff(
		{
			command: spec.command,
			args: spec.args,
			cwd: spec.cwd,
			display: createProcessHandoffDisplay(spec.command, spec.args),
		},
		{ capture: false, env: spec.env, spawnErrorAsResult: true },
	);
	if (result.spawnError) {
		console.error(chalk.red(`Failed to run: ${result.spawnError.message}`));
		return 127;
	}
	return result.exitCode;
}

/**
 * Resolve a NAMED declared command in a workspace and run it. This is an operation catalog, not a
 * shell: the name must be in the workspace's `commands` allowlist (config data); anything else is
 * rejected. Refarm holds only the argv + cwd; the logic lives in the workspace (e.g. rcdc5's
 * `@rcdcp/serpro-vpn`). The boundary that lets a remote surface trigger it safely.
 */
export async function runDeclaredWorkspaceCommand(
	input: { workspace: string; command: string; extraArgs: string[] },
	deps: WorkspaceCommandDeps | undefined,
	runner: WorkspaceRunner = defaultWorkspaceRunner,
): Promise<WorkspaceRunResult> {
	const baseDir = deps?.cwd?.() ?? process.cwd();
	const config = (deps?.loadConfig ?? loadConfig)(baseDir);
	const workspace = declaredWorkspaceFromConfig(config, input.workspace, { baseDir });
	if (!workspace) {
		throw new Error(`Workspace not declared in config: ${input.workspace}`);
	}
	const commands = workspaceCommands(workspace);
	const declared = commands[input.command];
	if (!declared) {
		const names = Object.keys(commands);
		throw new Error(
			`Command "${input.command}" is not declared for workspace "${input.workspace}". ` +
				`Declared commands: ${names.length ? names.join(", ") : "(none)"}`,
		);
	}
	const cwd = declared.cwd ? path.join(workspace.absolutePath, declared.cwd) : workspace.absolutePath;
	const argv = [...declared.run, ...input.extraArgs];
	const [command, ...args] = argv;
	if (!command) throw new Error(`Command "${input.command}" resolved to an empty argv.`);
	const exitCode = await runner({ command, args, cwd, env: deps?.env });
	return { workspace: workspace.id, command: input.command, argv, cwd, exitCode };
}

function resolveWorkspaceExecutionCwd(
	options: WorkspaceExecutionCommandOptions,
	deps: WorkspaceCommandDeps | undefined,
): {
	cwd: string;
	declaredWorkspace: DeclaredWorkspaceConfig | null;
	pathResolution: WorkspacePathResolution | null;
} {
	if (options.cwd) return { cwd: options.cwd, declaredWorkspace: null, pathResolution: null };
	const baseDir = deps?.cwd?.() ?? process.cwd();
	if (!options.workspace) return { cwd: baseDir, declaredWorkspace: null, pathResolution: null };
	const config = (deps?.loadConfig ?? loadConfig)(baseDir);
	const declaredWorkspace = declaredWorkspaceFromConfig(config, options.workspace, { baseDir });
	if (!declaredWorkspace) {
		throw new Error(`Workspace not declared in config: ${options.workspace}`);
	}
	const pathResolution = resolveDeclaredWorkspacePath(declaredWorkspace);
	if (!pathResolution.resolvedPath) {
		throw new Error(missingWorkspacePathMessage(declaredWorkspace.id));
	}
	return { cwd: pathResolution.resolvedPath, declaredWorkspace, pathResolution };
}

export function observeDeclaredWorkspaceExecution(
	workspace: DeclaredWorkspaceConfig,
	deps: WorkspaceCommandDeps | undefined,
): WorkspaceExecutionObservation {
	return observeBaseDeclaredWorkspaceExecution(workspace, {
		env: deps?.env ?? process.env,
		buildStatus: ({ cwd, env }) => buildWorkspaceExecutionStatus({ cwd, env }),
	}) as WorkspaceExecutionObservation;
}

export function observeDeclaredWorkspacesExecution(
	workspaces: DeclaredWorkspaceConfig[],
	deps: WorkspaceCommandDeps | undefined,
): WorkspaceExecutionObservation[] {
	return observeBaseDeclaredWorkspacesExecution(workspaces, {
		env: deps?.env ?? process.env,
		buildStatus: ({ cwd, env }) => buildWorkspaceExecutionStatus({ cwd, env }),
	}) as WorkspaceExecutionObservation[];
}

export function summarizeWorkspaceExecutionObservations(
	observations: WorkspaceExecutionObservation[],
): WorkspaceExecutionSummary {
	return summarizeBaseWorkspaceExecutionObservations(observations);
}

export function workspaceExecutionRecommendations(
	observations: WorkspaceExecutionObservation[],
): WorkspaceExecutionRecommendation[] {
	return baseWorkspaceExecutionRecommendations(observations);
}

export function buildWorkspaceExecutionSweepPayload(
	observations: WorkspaceExecutionObservation[],
): WorkspaceExecutionSweepPayload {
	return buildWorkspaceSweepPayload(observations) as WorkspaceExecutionSweepPayload;
}

function buildWorkspaceMountPlan(payload: WorkspaceExecutionSweepPayload): {
	mode: "all";
	mountCount: number;
	mounts: Array<{
		workspaceId: string;
		mount: string;
	}>;
	devcontainerJson: {
		path: string;
		mounts: string[];
	};
	rebuildRequired: boolean;
	instructions: string[];
} {
	const mounts = payload.recommendations.flatMap((recommendation) =>
		(recommendation.devcontainerMounts ?? []).map((mount) => ({
			workspaceId: recommendation.workspaceId,
			mount,
		})),
	);
	return {
		mode: "all",
		mountCount: mounts.length,
		mounts,
		devcontainerJson: {
			path: ".devcontainer/devcontainer.json",
			mounts: mounts.map((mount) => mount.mount),
		},
		rebuildRequired: mounts.length > 0,
		instructions:
			mounts.length > 0
				? [
						"Add the listed mount strings to .devcontainer/devcontainer.json mounts.",
						"Rebuild the devcontainer after changing mounts.",
					]
				: [],
	};
}

function workspaceStatusNextCommands(payload: WorkspaceExecutionSweepPayload): string[] {
	const nextCommands = workspaceSweepRecommendationNextCommands(payload.recommendations);
	if (!hasMissingWorkspacePath(payload)) return nextCommands;
	const missingPathCommands = [
		WORKSPACE_SOURCES_JSON_COMMAND,
		WORKSPACE_SOURCES_DECLARATIONS_JSON_COMMAND,
		WORKSPACE_SOURCES_MATERIALIZE_DRY_RUN_JSON_COMMAND,
	];
	if (buildWorkspaceMountPlan(payload).mountCount > 0) {
		missingPathCommands.push(WORKSPACE_MOUNTS_JSON_COMMAND);
	}
	return [...missingPathCommands, ...nextCommands];
}

function hasMissingWorkspacePath(payload: WorkspaceExecutionSweepPayload): boolean {
	return payload.recommendations.some(
		(recommendation) => recommendation.code === "workspace-path-missing",
	);
}

function printWorkspaceStatus(
	options: WorkspaceStatusCommandOptions,
	deps: WorkspaceCommandDeps | undefined,
	operation: "execution" | "status" = "status",
): void {
	const baseDir = deps?.cwd?.() ?? process.cwd();
	const observations = observeDeclaredWorkspacesExecution(
		loadDeclaredWorkspaces(deps, baseDir),
		deps,
	);
	const payload = buildWorkspaceExecutionSweepPayload(observations);
	if (options.json) {
		printJson(
			buildJsonSuccessEnvelope({
				command: "workspace",
				operation,
				extra: payload,
				nextCommands: workspaceStatusNextCommands(payload),
			}),
		);
		return;
	}
	printWorkspaceExecutionObservations(observations);
}

function printWorkspaceMounts(
	options: WorkspaceMountsCommandOptions,
	deps: WorkspaceCommandDeps | undefined,
): void {
	const baseDir = deps?.cwd?.() ?? process.cwd();
	const observations = observeDeclaredWorkspacesExecution(
		loadDeclaredWorkspaces(deps, baseDir),
		deps,
	);
	const payload = buildWorkspaceExecutionSweepPayload(observations);
	const plan = buildWorkspaceMountPlan(payload);
	if (options.json) {
		printJson(
			buildJsonSuccessEnvelope({
				command: "workspace",
				operation: "mounts",
				extra: plan,
				nextAction:
					plan.mountCount > 0
						? "Add listed mounts to .devcontainer/devcontainer.json and rebuild the devcontainer."
						: null,
			}),
		);
		return;
	}
	console.log(chalk.bold("Workspace mounts"));
	if (plan.mountCount === 0) {
		console.log(chalk.dim("  no missing bridge mounts detected"));
		return;
	}
	for (const mount of plan.mounts) {
		console.log(`  ${mount.workspaceId}: ${mount.mount}`);
	}
	console.log(chalk.dim("  Add these to .devcontainer/devcontainer.json mounts, then rebuild."));
}

function printWorkspaceSources(
	options: WorkspaceSourcesCommandOptions,
	deps: WorkspaceCommandDeps | undefined,
): void {
	const baseDir = deps?.cwd?.() ?? process.cwd();
	const plan = buildWorkspaceSourceCachePlan(loadDeclaredWorkspaces(deps, baseDir), { baseDir });
	if (options.json) {
		printJson(
			buildJsonSuccessEnvelope({
				command: "workspace",
				operation: "sources",
				extra: plan,
				nextAction:
					plan.summary.materializable > 0
						? "Materialize declared repositories into the source cache; no devcontainer rebuild is required."
						: plan.summary.unconfigured > 0
							? "Declare repository intent for missing workspaces, or use workspace mounts when the host checkout must be operated in place."
							: plan.summary.refreshRequired > 0
								? "Refresh stale source cache checkouts."
								: null,
				nextCommands:
					plan.summary.materializable > 0
						? [WORKSPACE_SOURCES_MATERIALIZE_DRY_RUN_JSON_COMMAND]
						: plan.summary.unconfigured > 0
							? [WORKSPACE_SOURCES_DECLARATIONS_JSON_COMMAND]
							: plan.summary.refreshRequired > 0
								? [WORKSPACE_SOURCES_REFRESH_DRY_RUN_JSON_COMMAND]
								: [],
			}),
		);
		return;
	}
	console.log(chalk.bold("Workspace sources"));
	console.log(chalk.dim(`  cache: ${plan.cacheRoot}`));
	if (plan.items.length === 0) {
		console.log(chalk.dim("  none declared"));
		return;
	}
	for (const item of plan.items) {
		console.log(`  ${item.workspaceId}: ${item.state}`);
		if (item.process) console.log(chalk.dim(`    ${item.process.display}`));
	}
}

function buildWorkspaceSourceDeclarationPlan(
	plan: ReturnType<typeof buildWorkspaceSourceCachePlan>,
): {
	mode: "all";
	configPath: string;
	declarationCount: number;
	declarations: Array<{
		workspaceId: string;
		path: string;
		snippet: {
			workspaces: Record<
				string,
				{
					repository: {
						url: string;
						ref: string | null;
					};
				}
			>;
		};
	}>;
	instructions: string[];
} {
	const declarations = plan.items
		.filter((item) => item.state === "unconfigured" && !item.repository)
		.map((item) => ({
			workspaceId: item.workspaceId,
			path: item.requestedPath,
			snippet: {
				workspaces: {
					[item.workspaceId]: {
						repository: {
							url: "<git-url>",
							ref: null,
						},
					},
				},
			},
		}));
	return {
		mode: "all",
		configPath: ".refarm/config.json",
		declarationCount: declarations.length,
		declarations,
		instructions:
			declarations.length > 0
				? [
						"Fill each repository.url with the canonical Git remote for that workspace.",
						"Keep ref null unless this workspace should materialize a specific branch or tag.",
						"Run refarm workspace sources materialize --dry-run --json after declaring repositories.",
					]
				: [],
	};
}

function printWorkspaceSourceDeclarations(
	options: WorkspaceSourceDeclarationsCommandOptions,
	deps: WorkspaceCommandDeps | undefined,
): void {
	const baseDir = deps?.cwd?.() ?? process.cwd();
	const sourcePlan = buildWorkspaceSourceCachePlan(loadDeclaredWorkspaces(deps, baseDir), {
		baseDir,
	});
	const declarationPlan = buildWorkspaceSourceDeclarationPlan(sourcePlan);
	if (options.json) {
		printJson(
			buildJsonSuccessEnvelope({
				command: "workspace",
				operation: "source-declarations",
				extra: declarationPlan,
				nextAction:
					declarationPlan.declarationCount > 0
						? "Add repository declarations for missing source cache workspaces."
						: null,
				nextCommands:
					declarationPlan.declarationCount > 0
						? [WORKSPACE_SOURCES_MATERIALIZE_DRY_RUN_JSON_COMMAND]
						: [],
			}),
		);
		return;
	}
	console.log(chalk.bold("Workspace source declarations"));
	if (declarationPlan.declarationCount === 0) {
		console.log(chalk.dim("  no missing repository declarations detected"));
		return;
	}
	for (const declaration of declarationPlan.declarations) {
		console.log(`  ${declaration.workspaceId}: ${declaration.path}`);
		console.log(chalk.dim(`    add to ${declarationPlan.configPath}:`));
		const snippet = JSON.stringify(
			declaration.snippet.workspaces[declaration.workspaceId],
			null,
			2,
		);
		for (const line of snippet.split("\n")) {
			console.log(chalk.dim(`    ${line}`));
		}
	}
	console.log(chalk.dim(`  next: ${WORKSPACE_SOURCES_MATERIALIZE_DRY_RUN_JSON_COMMAND}`));
}

function printWorkspaceSourceMaterialize(
	options: WorkspaceSourceMaterializeCommandOptions,
	deps: WorkspaceCommandDeps | undefined,
): void {
	if (!options.dryRun && !options.run) {
		if (options.json) {
			printJson(
				buildJsonErrorEnvelope({
					command: "workspace",
					operation: "source-materialize",
					error: "source-materialize-requires-dry-run",
					message: "Workspace source materialization currently requires --dry-run or --run.",
					nextAction:
						"Inspect the source materialization plan before cloning repositories, or use --run to execute it.",
					nextCommand: WORKSPACE_SOURCES_MATERIALIZE_DRY_RUN_JSON_COMMAND,
				}),
			);
			// An ok:false envelope with exit 0 is a lie to the shell: `refarm … --json &&`
			// reads this refusal as success. Envelope and exit code must agree.
			process.exitCode = 1;
			return;
		}
		throw new Error("workspace sources materialize currently requires --dry-run or --run");
	}
	const baseDir = deps?.cwd?.() ?? process.cwd();
	const plan = buildWorkspaceSourceCachePlan(loadDeclaredWorkspaces(deps, baseDir), { baseDir });
	const processes = plan.items.flatMap((item) => (item.process ? [item.process] : []));
	const steps = workspaceSourceProcessSteps(processes, {
		idPrefix: "source-cache-materialize",
		description: "Materialize a declared repository into the source cache.",
	});
	const nextAction =
		processes.length > 0
			? "Run the listed git clone processes to materialize source cache checkouts."
			: plan.summary.unconfigured > 0
				? "Declare repository intent for missing workspaces before materializing source cache checkouts."
				: null;
	if (options.run) {
		const result = runCommandPlan(
			steps,
			deps?.runCommandPlanStep ??
				((step) =>
					runCommandPlanProcessStep(step, { cwd: baseDir, env: deps?.env ?? process.env })),
		);
		if (options.json) {
			const envelope = buildCommandPlanRunEnvelope(
				{
					action: "source-materialize",
					command: "workspace",
					operation: "source-materialize-run",
				},
				result,
			);
			if (processes.length === 0 && plan.summary.unconfigured > 0) {
				envelope.nextAction = nextAction;
				envelope.nextActions = [nextAction].filter((action): action is string => Boolean(action));
				envelope.nextCommand = WORKSPACE_SOURCES_DECLARATIONS_JSON_COMMAND;
				envelope.nextCommands = [WORKSPACE_SOURCES_DECLARATIONS_JSON_COMMAND];
			}
			printJson(envelope);
			return;
		}
		console.log(chalk.bold("Workspace source materialize"));
		if (result.steps.length === 0) {
			console.log(chalk.dim(nextAction ?? "  no source cache materialization needed"));
			if (processes.length === 0 && plan.summary.unconfigured > 0) {
				console.log(chalk.dim(`  next: ${WORKSPACE_SOURCES_DECLARATIONS_JSON_COMMAND}`));
			}
			return;
		}
		for (const step of result.steps) {
			console.log(`${step.ok ? "  ✓" : "  ✗"} ${step.command}`);
		}
		return;
	}
	if (options.json) {
		printJson(
			buildJsonSuccessEnvelope({
				command: "workspace",
				operation: "source-materialize-dry-run",
				extra: {
					dryRun: true,
					materializeCount: processes.length,
					processes,
					nextProcesses: processes,
					plan,
				},
				nextAction,
				nextCommands:
					processes.length > 0
						? []
						: plan.summary.unconfigured > 0
							? [WORKSPACE_SOURCES_DECLARATIONS_JSON_COMMAND]
							: [],
			}),
		);
		return;
	}
	console.log(chalk.bold("Workspace source materialize"));
	console.log(chalk.yellow("  (dry-run — no repositories will be cloned)\n"));
	if (processes.length === 0) {
		console.log(chalk.dim(nextAction ?? "  no source cache materialization needed"));
		return;
	}
	for (const process of processes) {
		console.log(`  ${process.display}`);
	}
}

function workspaceSourceProcessSteps(
	processes: CommandProcessSpec[],
	options: {
		idPrefix: string;
		description: string;
	},
): CommandPlanStep[] {
	return processes.map((process, index) => ({
		id: `${options.idPrefix}-${index + 1}`,
		command: process.display,
		args: process.args,
		description: options.description,
		effect: "write",
		process,
	}));
}

function printWorkspaceSourceRefresh(
	options: WorkspaceSourceRefreshCommandOptions,
	deps: WorkspaceCommandDeps | undefined,
): void {
	if (!options.dryRun && !options.run) {
		if (options.json) {
			printJson(
				buildJsonErrorEnvelope({
					command: "workspace",
					operation: "source-refresh",
					error: "source-refresh-requires-dry-run",
					message: "Workspace source refresh currently requires --dry-run or --run.",
					nextAction:
						"Inspect the source refresh plan before fetching repositories, or use --run to execute it.",
					nextCommand: WORKSPACE_SOURCES_REFRESH_DRY_RUN_JSON_COMMAND,
				}),
			);
			// Same contract as materialize above: an ok:false envelope must not exit 0.
			process.exitCode = 1;
			return;
		}
		throw new Error("workspace sources refresh currently requires --dry-run or --run");
	}
	const baseDir = deps?.cwd?.() ?? process.cwd();
	const plan = buildWorkspaceSourceCachePlan(loadDeclaredWorkspaces(deps, baseDir), { baseDir });
	const processes = plan.items.flatMap((item) =>
		item.refreshProcess ? [item.refreshProcess] : [],
	);
	const steps = workspaceSourceProcessSteps(processes, {
		idPrefix: "source-cache-refresh",
		description: "Refresh a stale source cache checkout.",
	});
	const nextAction =
		processes.length > 0
			? "Run the listed git fetch processes to refresh stale source cache checkouts."
			: null;
	if (options.run) {
		const result = runCommandPlan(
			steps,
			deps?.runCommandPlanStep ??
				((step) =>
					runCommandPlanProcessStep(step, { cwd: baseDir, env: deps?.env ?? process.env })),
		);
		if (options.json) {
			printJson(
				buildCommandPlanRunEnvelope(
					{
						action: "source-refresh",
						command: "workspace",
						operation: "source-refresh-run",
					},
					result,
				),
			);
			return;
		}
		console.log(chalk.bold("Workspace source refresh"));
		for (const step of result.steps) {
			console.log(`${step.ok ? "  ✓" : "  ✗"} ${step.command}`);
		}
		return;
	}
	if (options.json) {
		printJson(
			buildJsonSuccessEnvelope({
				command: "workspace",
				operation: "source-refresh-dry-run",
				extra: {
					dryRun: true,
					refreshCount: processes.length,
					processes,
					nextProcesses: processes,
					plan,
				},
				nextAction,
			}),
		);
		return;
	}
	console.log(chalk.bold("Workspace source refresh"));
	console.log(chalk.yellow("  (dry-run — no repositories will be fetched)\n"));
	if (processes.length === 0) {
		console.log(chalk.dim("  no source cache refresh needed"));
		return;
	}
	for (const process of processes) {
		console.log(`  ${process.display}`);
	}
}

export function createWorkspaceCommand(deps?: WorkspaceCommandDeps): Command {
	const command = new Command("workspace")
		.description("Inspect workspace execution and cache capabilities")
		.addHelpText(
			"after",
			[
				"",
				"Examples:",
				"  $ refarm workspace execution",
				"  $ refarm workspace execution --json",
				"  $ refarm workspace execution --cwd ../agents-lab --json",
				"  $ refarm workspace execution --workspace agents-lab --json",
				"  $ refarm workspace execution --all --json",
				"  $ refarm workspace status --json",
				"  $ refarm workspace mounts --json",
				"  $ refarm workspace sources --json",
				"  $ refarm workspace sources declarations --json",
				"  $ refarm workspace sources materialize --dry-run --json",
				"  $ refarm workspace sources refresh --dry-run --json",
				"  $ refarm workspace list --json",
				"",
				"Notes:",
				"  Refarm detects execution adapters such as Turbo, then reports local and remote cache readiness.",
				"  Use this when bringing Refarm into another project as a daily-driver CLI.",
			].join("\n"),
		);

	command
		.command("add [path]")
		.description("Declare a workspace through a reviewed, authorised proposal")
		.option("--id <id>", "Stable name used by workspace commands")
		.option("--kind <kind>", "refarm | consumer | lab | vault | project")
		.option("--repository <url>", "Portable repository URL; otherwise derive origin when present")
		.option("--replace", "Re-open an existing declaration or prior decision")
		.option("--local", "Write this workspace's local .refarm/config.json instead of operator home")
		.option("--attended-elsewhere", "A remote surface is attending the consent prompts")
		.option("--json", "Output the declaration result as JSON")
		.action(async (workspacePath: string | undefined, options: WorkspaceAddOptions) => {
			try {
				const result = await runWorkspaceAdd({ ...options, path: workspacePath });
				if (options.json) {
					printJson(
						buildJsonSuccessEnvelope({
							command: "workspace",
							operation: "add",
							extra: result,
							nextCommands:
								result.status === "declared"
									? [refarmCommand(["workspace", "status", "--json"])]
									: [],
						}),
					);
					return;
				}
				if (result.status === "declared") {
					console.log(chalk.green(`✓  declared "${result.workspace}"`));
					console.log(chalk.dim(`   ${result.configPath}`));
					console.log(chalk.dim(`   undo: ${result.undoCommand}`));
					console.log(chalk.dim(`   inspect: ${refarmCommand(["workspace", "status", "--json"])}`));
				} else {
					console.log(chalk.dim(`workspace ${result.status}`));
				}
			} catch (error) {
				if (error instanceof WorkspaceAddRefusal && options.json) {
					printJson(
						buildJsonErrorEnvelope({
							command: "workspace",
							operation: "add",
							error: error.code,
							message: error.message,
							nextAction: `Run \`${WORKSPACE_ADD_COMMAND}\` from an attended surface.`,
							nextCommand: WORKSPACE_ADD_COMMAND,
						}),
					);
					process.exitCode = 1;
					return;
				}
				failWorkspace(
					"add",
					options,
					error,
				);
			}
		});

	const workspaceOperationCommand = command
		.command("command")
		.description("Author named, shell-free operations for declared workspaces");

	workspaceOperationCommand
		.command("add <workspace> <name> [argv...]")
		.description("Declare an exact argv operation through reviewed consent")
		.option("--cwd <path>", "Working directory relative to the workspace root")
		.option("--description <text>", "Human description shown by operation surfaces")
		.option("--replace", "Review and replace an existing operation")
		.option("--local", "Write this workspace's local .refarm/config.json")
		.option("--attended-elsewhere", "A remote surface is attending the consent prompts")
		.option("--json", "Output the declaration result as JSON")
		.addHelpText(
			"after",
			[
				"",
				"Use `--` before argv when it contains flags, so Refarm preserves every token exactly:",
				"  $ refarm workspace command add my-app test -- pnpm test --runInBand",
			].join("\n"),
		)
		.action(async (workspace: string, name: string, argv: string[], options: { cwd?: string; description?: string; replace?: boolean; local?: boolean; attendedElsewhere?: boolean; json?: boolean }) => {
			try {
				const result = await runWorkspaceCommandAdd({ workspace, name, argv: argv ?? [], ...options });
				if (options.json) {
					printJson(buildJsonSuccessEnvelope({
						command: "workspace",
						operation: "command-add",
						extra: result,
						nextCommands: result.status === "declared" ? [refarmCommand(["workspace", "run", workspace, name])] : [],
					}));
					return;
				}
				if (result.status === "declared") {
					console.log(chalk.green(`✓  declared "${workspace}:${name}"`));
					console.log(chalk.dim(`   ${result.configPath}`));
					console.log(chalk.dim(`   undo: ${result.undoCommand}`));
					console.log(chalk.dim(`   run:  ${refarmCommand(["workspace", "run", workspace, name])}`));
				} else console.log(chalk.dim(`workspace command ${result.status}`));
			} catch (error) {
				if (error instanceof WorkspaceCommandAddRefusal && options.json) {
					printJson(buildJsonErrorEnvelope({
						command: "workspace",
						operation: "command-add",
						error: error.code,
						message: error.message,
						nextAction: `Run \`${refarmCommand(["workspace", "command", "add", "--help"])}\` from an attended surface.`,
						nextCommand: refarmCommand(["workspace", "command", "add", "--help"]),
					}));
					process.exitCode = 1;
					return;
				}
				failWorkspace("command-add", options, error);
			}
		});

	command
		.command("execution")
		.description("Inspect detected workspace executor and cache readiness")
		.option("--cwd <dir>", "Inspect a workspace from another directory")
		.option("--workspace <id>", "Inspect a workspace declared in .refarm/config.json")
		.option("--all", "Inspect every workspace declared in .refarm/config.json")
		.option("--json", "Output machine-readable workspace execution status")
		.action((options: WorkspaceExecutionCommandOptions) => {
			if (options.all) {
				printWorkspaceStatus({ json: options.json }, deps, "execution");
				return;
			}
			const resolved = resolveWorkspaceExecutionCwd(options, deps);
			const status = buildWorkspaceExecutionStatus({
				cwd: resolved.cwd,
				env: deps?.env ?? process.env,
			});
			if (options.json) {
				printJson(
					buildJsonSuccessEnvelope({
						command: "workspace",
						operation: "execution",
						extra: {
							...status,
							declaredWorkspace: resolved.declaredWorkspace,
							pathResolution: resolved.pathResolution,
						},
						nextCommands: status.adapters.turbo.installCommand
							? [status.adapters.turbo.installCommand]
							: [],
					}),
				);
				return;
			}
			printWorkspaceExecutionStatus(status);
		});

	command
		.command("status")
		.description("Inspect every declared workspace and cache readiness")
		.option("--json", "Output machine-readable workspace status")
		.action((options: WorkspaceStatusCommandOptions) => {
			printWorkspaceStatus(options, deps);
		});

	command
		.command("mounts")
		.description("Plan devcontainer mounts for missing declared workspace bridges")
		.option("--json", "Output machine-readable devcontainer mount plan")
		.action((options: WorkspaceMountsCommandOptions) => {
			printWorkspaceMounts(options, deps);
		});

	const sourcesCommand = command
		.command("sources")
		.description("Plan local source cache materialization for declared workspace repositories")
		.option("--json", "Output machine-readable source cache plan");

	sourcesCommand
		.command("declarations")
		.description("Plan missing repository declarations for source cache materialization")
		.option("--json", "Output machine-readable repository declaration plan")
		.action((options: WorkspaceSourceDeclarationsCommandOptions, declarationsCommand: Command) => {
			printWorkspaceSourceDeclarations(
				{
					...options,
					json: options.json || declarationsCommand.parent?.opts().json,
				},
				deps,
			);
		});

	sourcesCommand
		.command("materialize")
		.description("Materialize declared workspace repositories into the local source cache")
		.option("--dry-run", "Print clone processes without executing them")
		.option("--run", "Execute source cache materialization processes")
		.option("--json", "Output machine-readable materialization dry-run")
		.action(
			guardedWorkspace<WorkspaceSourceMaterializeCommandOptions>(
				"source-materialize",
				(options, materializeCommand) => {
					printWorkspaceSourceMaterialize(
						{
							...options,
							json: options.json || materializeCommand.parent?.opts().json,
						},
						deps,
					);
				},
			),
		);

	sourcesCommand
		.command("refresh")
		.description("Refresh stale local source cache checkouts")
		.option("--dry-run", "Print fetch processes without executing them")
		.option("--run", "Execute stale source cache refresh processes")
		.option("--json", "Output machine-readable refresh dry-run")
		.action(
			guardedWorkspace<WorkspaceSourceRefreshCommandOptions>(
				"source-refresh",
				(options, refreshCommand) => {
					printWorkspaceSourceRefresh(
						{
							...options,
							json: options.json || refreshCommand.parent?.opts().json,
						},
						deps,
					);
				},
			),
		);

	sourcesCommand.action((options: WorkspaceSourcesCommandOptions) => {
		printWorkspaceSources(options, deps);
	});

	command
		.command("list")
		.description("List workspaces declared in Refarm config")
		.option("--json", "Output machine-readable configured workspaces")
		.action((options: WorkspaceListCommandOptions) => {
			const baseDir = deps?.cwd?.() ?? process.cwd();
			const workspaces = loadDeclaredWorkspaces(deps, baseDir);
			if (options.json) {
				printJson(
					buildJsonSuccessEnvelope({
						command: "workspace",
						operation: "list",
						extra: {
							workspaces,
						},
						nextAction:
							workspaces.length === 0
								? "Declare a workspace through a reviewed host-local proposal."
								: null,
						nextCommands: workspaces.length === 0 ? [WORKSPACE_ADD_COMMAND] : [],
					}),
				);
				return;
			}
			printDeclaredWorkspaces(workspaces);
		});

	command
		.command("run <workspace> <command> [args...]")
		.description("Run a NAMED command from a workspace's declared commands allowlist")
		.addHelpText(
			"after",
			[
				"",
				"Runs only commands authored with `refarm workspace command add` (or declared directly) —",
				"an operation catalog, not a shell. Refarm holds the command string + cwd; the logic",
				"lives in the workspace. Authoring preserves argv exactly and asks for consent:",
				"  $ refarm workspace command add my-app test -- pnpm test",
				"  $ refarm workspace run my-app test",
			].join("\n"),
		)
		.action(async (workspace: string, cmd: string, args: string[]) => {
			try {
				const result = await runDeclaredWorkspaceCommand(
					{ workspace, command: cmd, extraArgs: args ?? [] },
					deps,
				);
				process.exitCode = result.exitCode;
			} catch (error) {
				console.error(chalk.red(error instanceof Error ? error.message : String(error)));
				process.exitCode = 1;
			}
		});

	return command;
}

export const workspaceCommand = createWorkspaceCommand();
