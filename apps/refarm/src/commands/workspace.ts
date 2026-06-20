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
import { refarmCommand } from "./command-handoff.js";
import { buildJsonErrorEnvelope, buildJsonSuccessEnvelope, printJson } from "./json-output.js";
import {
	buildWorkspaceExecutionStatus,
	type WorkspaceExecutionStatus,
} from "./workspace-execution.js";

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
	json?: boolean;
}

export interface WorkspaceSourceDeclarationsCommandOptions {
	json?: boolean;
}

export interface WorkspaceCommandDeps {
	cwd?: () => string;
	env?: NodeJS.ProcessEnv;
	loadConfig?: (root?: string) => unknown;
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

const WORKSPACE_MOUNTS_JSON_COMMAND = refarmCommand([
	"workspace",
	"mounts",
	"--json",
]);
const WORKSPACE_SOURCES_JSON_COMMAND = refarmCommand([
	"workspace",
	"sources",
	"--json",
]);
const WORKSPACE_SOURCES_MATERIALIZE_DRY_RUN_JSON_COMMAND = refarmCommand([
	"workspace",
	"sources",
	"materialize",
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
				? status.adapters.turbo.available ? "available" : "not provisioned"
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

function printWorkspaceExecutionObservations(
	observations: WorkspaceExecutionObservation[],
): void {
	const summary = summarizeWorkspaceExecutionObservations(observations);
	console.log(chalk.bold("Workspace execution"));
	console.log(
		chalk.dim(
			`  summary: ${summary.ok}/${summary.total} ready, ${summary.failed} failed`,
		),
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
		instructions: mounts.length > 0
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
				nextAction: plan.mountCount > 0
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
				nextAction: plan.summary.materializable > 0
					? "Materialize declared repositories into the source cache; no devcontainer rebuild is required."
					: plan.summary.unconfigured > 0
						? "Declare repository intent for missing workspaces, or use workspace mounts when the host checkout must be operated in place."
					: null,
				nextCommands: plan.summary.materializable > 0
					? [WORKSPACE_SOURCES_MATERIALIZE_DRY_RUN_JSON_COMMAND]
					: plan.summary.unconfigured > 0
						? [WORKSPACE_SOURCES_DECLARATIONS_JSON_COMMAND]
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

function buildWorkspaceSourceDeclarationPlan(plan: ReturnType<typeof buildWorkspaceSourceCachePlan>): {
	mode: "all";
	configPath: string;
	declarationCount: number;
	declarations: Array<{
		workspaceId: string;
		path: string;
		snippet: {
			workspaces: Record<string, {
				repository: {
					url: string;
					ref: string | null;
				};
			}>;
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
		instructions: declarations.length > 0
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
	const sourcePlan = buildWorkspaceSourceCachePlan(loadDeclaredWorkspaces(deps, baseDir), { baseDir });
	const declarationPlan = buildWorkspaceSourceDeclarationPlan(sourcePlan);
	if (options.json) {
		printJson(
			buildJsonSuccessEnvelope({
				command: "workspace",
				operation: "source-declarations",
				extra: declarationPlan,
				nextAction: declarationPlan.declarationCount > 0
					? "Add repository declarations for missing source cache workspaces."
					: null,
				nextCommands: declarationPlan.declarationCount > 0
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
	}
}

function printWorkspaceSourceMaterialize(
	options: WorkspaceSourceMaterializeCommandOptions,
	deps: WorkspaceCommandDeps | undefined,
): void {
	if (!options.dryRun) {
		if (options.json) {
			printJson(
				buildJsonErrorEnvelope({
					command: "workspace",
					operation: "source-materialize",
					error: "source-materialize-requires-dry-run",
					message: "Workspace source materialization currently requires --dry-run.",
					nextAction: "Inspect the source materialization plan before cloning repositories.",
					nextCommand: WORKSPACE_SOURCES_MATERIALIZE_DRY_RUN_JSON_COMMAND,
				}),
			);
			return;
		}
		throw new Error("workspace sources materialize currently requires --dry-run");
	}
	const baseDir = deps?.cwd?.() ?? process.cwd();
	const plan = buildWorkspaceSourceCachePlan(loadDeclaredWorkspaces(deps, baseDir), { baseDir });
	const processes = plan.items.flatMap((item) => item.process ? [item.process] : []);
	const nextAction = processes.length > 0
		? "Run the listed git clone processes to materialize source cache checkouts."
		: plan.summary.unconfigured > 0
			? "Declare repository intent for missing workspaces before materializing source cache checkouts."
			: null;
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
				nextCommands: processes.length > 0
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
				"  $ refarm workspace list --json",
				"",
				"Notes:",
				"  Refarm detects execution adapters such as Turbo, then reports local and remote cache readiness.",
				"  Use this when bringing Refarm into another project as a daily-driver CLI.",
			].join("\n"),
		);

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
			printWorkspaceSourceDeclarations({
				...options,
				json: options.json || declarationsCommand.parent?.opts().json,
			}, deps);
		});

	sourcesCommand
		.command("materialize")
		.description("Materialize declared workspace repositories into the local source cache")
		.option("--dry-run", "Print clone processes without executing them")
		.option("--json", "Output machine-readable materialization dry-run")
		.action((options: WorkspaceSourceMaterializeCommandOptions, materializeCommand: Command) => {
			printWorkspaceSourceMaterialize({
				...options,
				json: options.json || materializeCommand.parent?.opts().json,
			}, deps);
		});

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
					}),
				);
				return;
			}
			printDeclaredWorkspaces(workspaces);
		});

	return command;
}

export const workspaceCommand = createWorkspaceCommand();
