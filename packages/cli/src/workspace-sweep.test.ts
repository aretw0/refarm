import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	buildWorkspaceSourceCachePlan,
	buildWorkspaceSweepPayload,
	observeDeclaredWorkspaceExecution,
	observeDeclaredWorkspacesExecution,
	resolveDeclaredWorkspacePath,
	summarizeWorkspaceExecutionObservations,
	workspaceExecutionRecommendations,
	workspaceSweepRecommendationNextCommands,
	type WorkspaceSweepDeclaredWorkspace,
} from "./workspace-sweep.js";

let tempRoot: string;

beforeEach(() => {
	tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "refarm-cli-workspace-sweep-"));
});

afterEach(() => {
	fs.rmSync(tempRoot, { recursive: true, force: true });
});

describe("workspace sweep", () => {
	it("reports a missing declared workspace path with bridge mount hints", () => {
		const workspace = createWorkspace({
			absolutePath: path.join(tempRoot, "missing"),
			bridges: [
				{
					id: "windows-host",
					path: path.join(tempRoot, "also-missing"),
					hostPath: "C:\\work\\demo",
					mountHint: "Mount C:\\work\\demo inside this runtime.",
				},
			],
		});

		const observation = observeDeclaredWorkspaceExecution(workspace);
		const recommendations = workspaceExecutionRecommendations([observation]);

		expect(observation.ok).toBe(false);
		expect(observation.error).toEqual({
			code: "workspace-execution-failed",
			message: "No declared or bridged path is visible for workspace demo.",
		});
		expect(observation.resolution.resolvedPath).toBeNull();
		expect(observation.resolution.candidates).toHaveLength(2);
		expect(recommendations).toEqual([
			{
				code: "workspace-path-missing",
				workspaceId: "demo",
				message: "No declared or bridged path is visible for workspace demo.",
				mountHints: ["Mount C:\\work\\demo inside this runtime."],
				devcontainerMounts: [
					`source=C:\\work\\demo,target=${path.join(tempRoot, "missing")},type=bind`,
				],
			},
		]);
	});

	it("resolves to the first visible bridge when the declared path is outside the runtime", () => {
		const bridgePath = path.join(tempRoot, "mounted-demo");
		fs.mkdirSync(bridgePath, { recursive: true });
		const workspace = createWorkspace({
			absolutePath: path.join(tempRoot, "missing"),
			bridges: [
				{
					id: "mounted",
					path: bridgePath,
					hostPath: null,
					mountHint: null,
				},
			],
		});

		const resolution = resolveDeclaredWorkspacePath(workspace);
		const observation = observeDeclaredWorkspaceExecution(workspace);

		expect(resolution.resolvedPath).toBe(bridgePath);
		expect(observation.ok).toBe(true);
		expect(observation.status?.root).toBe(bridgePath);
	});

	it("summarizes adapter and remote cache recommendations across observations", () => {
		const turboWorkspace = path.join(tempRoot, "turbo-workspace");
		const installCommand = ["pnpm", "add", "-D", "-w", "turbo"].join(" ");
		const provisionCommand = ["refarm", "provision", "cloudflare", "turbo-cache", "--dry-run", "--json"].join(" ");
		fs.mkdirSync(turboWorkspace, { recursive: true });
		writeJson(path.join(turboWorkspace, "package.json"), {
			devDependencies: {},
		});
		writeJson(path.join(turboWorkspace, "turbo.json"), {
			tasks: {},
		});
		const workspace = createWorkspace({
			absolutePath: turboWorkspace,
			cache: {
				remote: {
					provider: "cloudflare-turbo",
				},
			},
		});

		const observation = observeDeclaredWorkspaceExecution(workspace, {
			buildStatus: ({ cwd }) => ({
				root: cwd,
				rootSource: "turbo",
				executor: {
					selected: "direct-script",
					reason: "test",
				},
				adapters: {
					directScript: {
						available: true,
					},
					turbo: {
						available: false,
						configured: true,
						declared: false,
						configPath: path.join(cwd, "turbo.json"),
						installCommand,
					},
				},
				cache: {
					local: {
						available: false,
						path: path.join(cwd, ".turbo", "cache"),
						kind: null,
					},
					remote: {
						configured: false,
						apiUrlEnv: "TURBO_CACHE_API_URL",
						tokenEnv: "TURBO_CACHE_TOKEN",
						provisionCommand,
					},
				},
			}),
		});

		expect(summarizeWorkspaceExecutionObservations([observation])).toEqual({
			total: 1,
			ok: 1,
			failed: 0,
			missingPath: 0,
			turboInstallNeeded: 1,
			remoteCacheUnconfigured: 1,
		});
		const recommendations = workspaceExecutionRecommendations([observation]);
		expect(recommendations).toMatchObject([
			{
				code: "turbo-install-needed",
				workspaceId: "demo",
				message: "Workspace demo has turbo.json but does not declare turbo.",
			},
			{
				code: "remote-cache-unconfigured",
				workspaceId: "demo",
				message: "Workspace demo declares remote cache intent but runtime env is not configured.",
			},
		]);
		expect(recommendations[0]?.nextCommand).toBe(installCommand);
		expect(recommendations[1]?.nextCommand).toBe(provisionCommand);
		expect(workspaceSweepRecommendationNextCommands([
			recommendations[0]!,
			recommendations[1]!,
			recommendations[0]!,
		])).toEqual([installCommand, provisionCommand]);
	});

	it("builds the reusable all-workspaces payload without command-shell fields", () => {
		const workspacePath = path.join(tempRoot, "demo");
		fs.mkdirSync(workspacePath, { recursive: true });
		const observations = observeDeclaredWorkspacesExecution([
			createWorkspace({ absolutePath: workspacePath }),
		]);

		expect(buildWorkspaceSweepPayload(observations)).toMatchObject({
			mode: "all",
			summary: {
				total: 1,
				ok: 1,
				failed: 0,
			},
			recommendations: [],
			observations,
		});
		expect(buildWorkspaceSweepPayload(observations)).not.toHaveProperty("command");
		expect(buildWorkspaceSweepPayload(observations)).not.toHaveProperty("operation");
	});

	it("plans source repository cache without requiring devcontainer rebuilds", () => {
		const visiblePath = path.join(tempRoot, "visible");
		const cachedPath = path.join(tempRoot, ".refarm", "cache", "checkouts", "github.com", "example", "cached");
		fs.mkdirSync(visiblePath, { recursive: true });
		fs.mkdirSync(cachedPath, { recursive: true });

		const plan = buildWorkspaceSourceCachePlan([
			createWorkspace({
				id: "visible",
				absolutePath: visiblePath,
				repository: {
					url: "https://github.com/example/visible.git",
					ref: null,
				},
			}),
			createWorkspace({
				id: "cached",
				absolutePath: path.join(tempRoot, "missing-cached"),
				repository: {
					url: "https://github.com/example/cached.git",
					ref: "develop",
				},
			}),
			createWorkspace({
				id: "missing",
				absolutePath: path.join(tempRoot, "missing"),
				repository: {
					url: "https://github.com/example/missing.git",
					ref: "main",
				},
			}),
			createWorkspace({
				id: "unconfigured",
				absolutePath: path.join(tempRoot, "unconfigured"),
			}),
		], { baseDir: tempRoot });

		expect(plan).toMatchObject({
			mode: "all",
			cacheRoot: path.join(tempRoot, ".refarm", "cache", "checkouts"),
			rebuildRequired: false,
			summary: {
				total: 4,
				visible: 1,
				cached: 1,
				materializable: 1,
				unconfigured: 1,
			},
			items: [
				{
					workspaceId: "visible",
					state: "visible",
					cacheKey: "github.com/example/visible",
					resolvedPath: visiblePath,
					updateIntervalSeconds: 300,
					rebuildRequired: false,
					process: null,
				},
				{
					workspaceId: "cached",
					state: "cached",
					cacheKey: "github.com/example/cached",
					resolvedPath: cachedPath,
					rebuildRequired: false,
					process: null,
				},
				{
					workspaceId: "missing",
					state: "materializable",
					cacheKey: "github.com/example/missing",
					resolvedPath: null,
					rebuildRequired: false,
					process: {
						command: "git",
						args: [
							"clone",
							"--filter=blob:none",
							"--branch",
							"main",
							"https://github.com/example/missing.git",
							path.join(tempRoot, ".refarm", "cache", "checkouts", "github.com", "example", "missing"),
						],
					},
				},
				{
					workspaceId: "unconfigured",
					state: "unconfigured",
					repository: null,
					cacheKey: null,
					rebuildRequired: false,
					process: null,
				},
			],
		});
	});
});

function createWorkspace(
	overrides: Partial<WorkspaceSweepDeclaredWorkspace> = {},
): WorkspaceSweepDeclaredWorkspace {
	return {
		id: "demo",
		path: "demo",
		absolutePath: path.join(tempRoot, "demo"),
		cache: {
			remote: null,
		},
		bridges: [],
		...overrides,
	};
}

function writeJson(filePath: string, value: unknown): void {
	fs.mkdirSync(path.dirname(filePath), { recursive: true });
	fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}
