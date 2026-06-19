import {
	workspaceExecutionRecommendations as baseWorkspaceExecutionRecommendations,
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
import { buildJsonSuccessEnvelope, printJson } from "./json-output.js";
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
							operation: "execution",
							extra: payload,
							nextCommands: workspaceSweepRecommendationNextCommands(payload.recommendations),
						}),
					);
					return;
				}
				printWorkspaceExecutionObservations(observations);
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
