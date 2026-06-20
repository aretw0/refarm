import fs from "node:fs";
import path from "node:path";
import { normalizeHandoffValues, quoteCommandArgIfNeeded } from "./command-handoff.js";
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
	repository?: WorkspaceSweepRepository | null;
	bridges: WorkspaceSweepBridge[];
}

export interface WorkspaceSweepRepository {
	url: string;
	ref: string | null;
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

export type WorkspaceSourceCacheState =
	| "visible"
	| "cached"
	| "materializable"
	| "unconfigured";

export interface WorkspaceSourceCachePlanItem {
	workspaceId: string;
	state: WorkspaceSourceCacheState;
	repository: WorkspaceSweepRepository | null;
	cacheKey: string | null;
	requestedPath: string;
	resolvedPath: string | null;
	cachePath: string;
	cacheExists: boolean;
	cacheAgeSeconds: number | null;
	refreshRequired: boolean;
	updateIntervalSeconds: number;
	rebuildRequired: false;
	process: {
		command: "git";
		args: string[];
		display: string;
	} | null;
}

export interface WorkspaceSourceCachePlan {
	mode: "all";
	cacheRoot: string;
	rebuildRequired: false;
	summary: {
		total: number;
		visible: number;
		cached: number;
		materializable: number;
		unconfigured: number;
	};
	items: WorkspaceSourceCachePlanItem[];
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

export function buildWorkspaceSourceCachePlan(
	workspaces: WorkspaceSweepDeclaredWorkspace[],
	options: { baseDir: string; cacheRoot?: string; updateIntervalSeconds?: number },
): WorkspaceSourceCachePlan {
	const cacheRoot = path.resolve(options.baseDir, options.cacheRoot ?? ".refarm/cache/checkouts");
	const updateIntervalSeconds = options.updateIntervalSeconds ?? 300;
	const items = workspaces.map((workspace) => {
		const resolution = resolveDeclaredWorkspacePath(workspace);
		const repository = workspace.repository ?? null;
		const cacheKey = repository ? repositoryCacheKey(repository.url) : null;
		const cachePath = path.join(cacheRoot, cacheKey ?? safeWorkspaceCacheName(workspace.id));
		const cacheExists = fs.existsSync(cachePath);
		const cacheAgeSeconds = cacheExists ? cachePathAgeSeconds(cachePath) : null;
		const state: WorkspaceSourceCacheState = resolution.resolvedPath
			? "visible"
			: cacheExists
				? "cached"
				: repository
					? "materializable"
					: "unconfigured";
		return {
			workspaceId: workspace.id,
			state,
			repository,
			cacheKey,
			requestedPath: workspace.absolutePath,
			resolvedPath: resolution.resolvedPath ?? (cacheExists ? cachePath : null),
			cachePath,
			cacheExists,
			cacheAgeSeconds,
			refreshRequired: cacheAgeSeconds !== null && cacheAgeSeconds >= updateIntervalSeconds,
			updateIntervalSeconds,
			rebuildRequired: false as const,
			process: state === "materializable" && repository
				? gitCloneProcess(repository, cachePath)
				: null,
		};
	});
	return {
		mode: "all",
		cacheRoot,
		rebuildRequired: false,
		summary: {
			total: items.length,
			visible: items.filter((item) => item.state === "visible").length,
			cached: items.filter((item) => item.state === "cached").length,
			materializable: items.filter((item) => item.state === "materializable").length,
			unconfigured: items.filter((item) => item.state === "unconfigured").length,
		},
		items,
	};
}

function cachePathAgeSeconds(cachePath: string): number {
	const stats = fs.statSync(cachePath);
	return Math.max(0, Math.floor((Date.now() - stats.mtimeMs) / 1000));
}

function remoteProvisionCommand(status: WorkspaceExecutionStatus): string | undefined {
	const remote = status.cache.remote as WorkspaceExecutionStatus["cache"]["remote"] & {
		provisionCommand?: unknown;
	};
	return typeof remote.provisionCommand === "string" ? remote.provisionCommand : undefined;
}

function gitCloneProcess(
	repository: WorkspaceSweepRepository,
	cachePath: string,
): WorkspaceSourceCachePlanItem["process"] {
	const args = [
		"clone",
		"--filter=blob:none",
		...(repository.ref ? ["--branch", repository.ref] : []),
		repository.url,
		cachePath,
	];
	return {
		command: "git",
		args,
		display: ["git", ...args.map(quoteCommandArgIfNeeded)].join(" "),
	};
}

function safeWorkspaceCacheName(workspaceId: string): string {
	const normalized = workspaceId.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
	return normalized || "workspace";
}

function repositoryCacheKey(repositoryUrl: string): string {
	const parsed = parseRepositoryReference(repositoryUrl);
	if (!parsed) return safeWorkspaceCacheName(repositoryUrl);
	return path.join(parsed.host, parsed.owner, parsed.repo);
}

function parseRepositoryReference(repositoryUrl: string): {
	host: string;
	owner: string;
	repo: string;
} | null {
	const input = repositoryUrl.trim().replace(/[?#].*$/, "").replace(/\/$/, "");
	const sshMatch = input.match(/^git@([^:]+):(.+)$/);
	if (sshMatch) return parseRepositoryParts(sshMatch[1]!, sshMatch[2]!);
	if (input.startsWith("ssh://")) {
		try {
			const url = new URL(input);
			return parseRepositoryParts(url.hostname, url.pathname);
		} catch {
			return null;
		}
	}
	if (input.startsWith("http://") || input.startsWith("https://")) {
		try {
			const url = new URL(input);
			return parseRepositoryParts(url.hostname, url.pathname);
		} catch {
			return null;
		}
	}
	const firstSegment = input.split("/")[0] ?? "";
	if (firstSegment.includes(".") || firstSegment === "localhost") {
		return parseRepositoryParts(firstSegment, input.slice(firstSegment.length + 1));
	}
	return parseRepositoryParts("github.com", input);
}

function parseRepositoryParts(host: string, rawPath: string): {
	host: string;
	owner: string;
	repo: string;
} | null {
	const parts = rawPath
		.replace(/^\/+/, "")
		.replace(/\.git$/, "")
		.split("/")
		.filter(Boolean);
	if (parts.length < 2) return null;
	return {
		host,
		owner: parts[0]!,
		repo: parts[1]!,
	};
}
