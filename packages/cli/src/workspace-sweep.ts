import fs from "node:fs";
import path from "node:path";
import { normalizeHandoffValues } from "./command-handoff.js";
import {
	buildWorkspaceExecutionStatus,
	type WorkspaceExecutionStatus,
} from "./workspace-execution.js";

export interface WorkspaceSweepDeclaredWorkspace {
	id: string;
	path: string;
	absolutePath: string;
	cache: {
		remote: unknown | null;
	};
	bridges: WorkspaceSweepBridge[];
}

export interface WorkspaceSweepBridge {
	id: string;
	path: string | null;
	hostPath: string | null;
	mountHint: string | null;
}

export interface WorkspaceSweepBuildStatusOptions {
	cwd: string;
	env?: NodeJS.ProcessEnv;
}

export type WorkspaceSweepBuildStatus<TStatus extends WorkspaceExecutionStatus> = (
	options: WorkspaceSweepBuildStatusOptions,
) => TStatus;

export interface WorkspaceSweepOptions<TStatus extends WorkspaceExecutionStatus = WorkspaceExecutionStatus> {
	env?: NodeJS.ProcessEnv;
	buildStatus?: WorkspaceSweepBuildStatus<TStatus>;
}

export interface WorkspaceSweepObservation<TStatus extends WorkspaceExecutionStatus = WorkspaceExecutionStatus> {
	declaredWorkspace: WorkspaceSweepDeclaredWorkspace;
	resolution: WorkspacePathResolution;
	ok: boolean;
	status?: TStatus;
	error?: {
		code: "workspace-execution-failed";
		message: string;
	};
}

export interface WorkspaceSweepSummary {
	total: number;
	ok: number;
	failed: number;
	missingPath: number;
	turboInstallNeeded: number;
	remoteCacheUnconfigured: number;
}

export interface WorkspaceSweepRecommendation {
	code: "workspace-path-missing" | "turbo-install-needed" | "remote-cache-unconfigured";
	workspaceId: string;
	message: string;
	nextCommand?: string;
	mountHints?: string[];
	devcontainerMounts?: string[];
}

export interface WorkspaceSweepPayload<TStatus extends WorkspaceExecutionStatus = WorkspaceExecutionStatus> {
	mode: "all";
	summary: WorkspaceSweepSummary;
	recommendations: WorkspaceSweepRecommendation[];
	observations: WorkspaceSweepObservation<TStatus>[];
}

export interface WorkspacePathCandidate {
	source: "declared" | "bridge";
	path: string;
	bridgeId?: string;
	hostPath?: string | null;
	mountHint?: string | null;
	exists: boolean;
}

export interface WorkspacePathResolution {
	requestedPath: string;
	resolvedPath: string | null;
	candidates: WorkspacePathCandidate[];
}

export function resolveDeclaredWorkspacePath(
	workspace: WorkspaceSweepDeclaredWorkspace,
): WorkspacePathResolution {
	const candidates: WorkspacePathCandidate[] = [
		{
			source: "declared",
			path: workspace.absolutePath,
			exists: fs.existsSync(workspace.absolutePath),
		},
	];
	for (const bridge of workspace.bridges) {
		if (!bridge.path) continue;
		const bridgePath = path.resolve(bridge.path);
		candidates.push({
			source: "bridge",
			path: bridgePath,
			bridgeId: bridge.id,
			hostPath: bridge.hostPath,
			mountHint: bridge.mountHint,
			exists: fs.existsSync(bridgePath),
		});
	}
	const resolvedPath = candidates.find((candidate) => candidate.exists)?.path ?? null;
	return {
		requestedPath: workspace.absolutePath,
		resolvedPath,
		candidates,
	};
}

export function observeDeclaredWorkspaceExecution<
	TStatus extends WorkspaceExecutionStatus = WorkspaceExecutionStatus,
>(
	workspace: WorkspaceSweepDeclaredWorkspace,
	options: WorkspaceSweepOptions<TStatus> = {},
): WorkspaceSweepObservation<TStatus> {
	const resolution = resolveDeclaredWorkspacePath(workspace);
	if (!resolution.resolvedPath) {
		return {
			declaredWorkspace: workspace,
			resolution,
			ok: false,
			error: {
				code: "workspace-execution-failed",
				message: missingWorkspacePathMessage(workspace.id),
			},
		};
	}
	try {
		const buildStatus = options.buildStatus ?? (buildWorkspaceExecutionStatus as WorkspaceSweepBuildStatus<TStatus>);
		return {
			declaredWorkspace: workspace,
			resolution,
			ok: true,
			status: buildStatus({
				cwd: resolution.resolvedPath,
				env: options.env ?? process.env,
			}),
		};
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return {
			declaredWorkspace: workspace,
			resolution,
			ok: false,
			error: {
				code: "workspace-execution-failed",
				message,
			},
		};
	}
}

export function observeDeclaredWorkspacesExecution<
	TStatus extends WorkspaceExecutionStatus = WorkspaceExecutionStatus,
>(
	workspaces: WorkspaceSweepDeclaredWorkspace[],
	options: WorkspaceSweepOptions<TStatus> = {},
): WorkspaceSweepObservation<TStatus>[] {
	return workspaces.map((workspace) => observeDeclaredWorkspaceExecution(workspace, options));
}

export function buildWorkspaceSweepPayload<
	TStatus extends WorkspaceExecutionStatus = WorkspaceExecutionStatus,
>(
	observations: WorkspaceSweepObservation<TStatus>[],
): WorkspaceSweepPayload<TStatus> {
	return {
		mode: "all",
		summary: summarizeWorkspaceExecutionObservations(observations),
		recommendations: workspaceExecutionRecommendations(observations),
		observations,
	};
}

export function summarizeWorkspaceExecutionObservations(
	observations: WorkspaceSweepObservation[],
): WorkspaceSweepSummary {
	return observations.reduce<WorkspaceSweepSummary>(
		(summary, observation) => {
			summary.total += 1;
			if (observation.ok) {
				summary.ok += 1;
			} else {
				summary.failed += 1;
			}
			if (!observation.resolution.resolvedPath) {
				summary.missingPath += 1;
			}
			if (observation.status?.adapters.turbo.installCommand) {
				summary.turboInstallNeeded += 1;
			}
			if (
				observation.declaredWorkspace.cache.remote &&
				observation.status &&
				!observation.status.cache.remote.configured
			) {
				summary.remoteCacheUnconfigured += 1;
			}
			return summary;
		},
		{
			total: 0,
			ok: 0,
			failed: 0,
			missingPath: 0,
			turboInstallNeeded: 0,
			remoteCacheUnconfigured: 0,
		},
	);
}

export function missingWorkspacePathMessage(workspaceId: string): string {
	return `No declared or bridged path is visible for workspace ${workspaceId}.`;
}

export function workspaceExecutionRecommendations(
	observations: WorkspaceSweepObservation[],
): WorkspaceSweepRecommendation[] {
	const recommendations: WorkspaceSweepRecommendation[] = [];
	for (const observation of observations) {
		const workspaceId = observation.declaredWorkspace.id;
		if (!observation.resolution.resolvedPath) {
			const mountHints = observation.resolution.candidates
				.map((candidate) => candidate.mountHint)
				.filter((hint): hint is string => Boolean(hint));
			const devcontainerMounts = observation.resolution.candidates
				.map((candidate) =>
					candidate.hostPath
						? `source=${candidate.hostPath},target=${observation.declaredWorkspace.absolutePath},type=bind`
						: null,
				)
				.filter((mount): mount is string => Boolean(mount));
			recommendations.push({
				code: "workspace-path-missing",
				workspaceId,
				message: missingWorkspacePathMessage(workspaceId),
				mountHints,
				...(devcontainerMounts.length > 0 ? { devcontainerMounts } : {}),
			});
		}
		if (observation.status?.adapters.turbo.installCommand) {
			recommendations.push({
				code: "turbo-install-needed",
				workspaceId,
				message: `Workspace ${workspaceId} has turbo.json but does not declare turbo.`,
				nextCommand: observation.status.adapters.turbo.installCommand,
			});
		}
		if (
			observation.declaredWorkspace.cache.remote &&
			observation.status &&
			!observation.status.cache.remote.configured
		) {
			recommendations.push({
				code: "remote-cache-unconfigured",
				workspaceId,
				message: `Workspace ${workspaceId} declares remote cache intent but runtime env is not configured.`,
				nextCommand: remoteProvisionCommand(observation.status),
			});
		}
	}
	return recommendations;
}

export function workspaceSweepRecommendationNextCommands(
	recommendations: WorkspaceSweepRecommendation[],
): string[] {
	return normalizeHandoffValues(
		recommendations
			.map((recommendation) => recommendation.nextCommand)
			.filter((command): command is string => Boolean(command)),
	);
}

function remoteProvisionCommand(status: WorkspaceExecutionStatus): string | undefined {
	const remote = status.cache.remote as WorkspaceExecutionStatus["cache"]["remote"] & {
		provisionCommand?: unknown;
	};
	return typeof remote.provisionCommand === "string" ? remote.provisionCommand : undefined;
}
