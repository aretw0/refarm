import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createWorkspaceCommand } from "../../src/commands/workspace.js";

const tempDirs: string[] = [];

function createWorkspaceRoot(options: {
	packageJson?: Record<string, unknown>;
	pnpmWorkspace?: boolean;
	turbo?: boolean;
	cache?: boolean;
} = {}): string {
	const root = mkdtempSync(join(tmpdir(), "refarm-workspace-command-"));
	tempDirs.push(root);
	writeFileSync(
		join(root, "package.json"),
		JSON.stringify(options.packageJson ?? { packageManager: "pnpm@11.7.0" }),
	);
	if (options.pnpmWorkspace !== false) {
		writeFileSync(join(root, "pnpm-workspace.yaml"), "packages:\n  - apps/*\n");
	}
	if (options.turbo) {
		writeFileSync(join(root, "turbo.json"), JSON.stringify({ tasks: {} }));
	}
	if (options.cache) {
		mkdirSync(join(root, ".turbo", "cache"), { recursive: true });
	}
	return root;
}

describe("workspace command", () => {
	afterEach(() => {
		vi.restoreAllMocks();
		while (tempDirs.length > 0) {
			rmSync(tempDirs.pop()!, { recursive: true, force: true });
		}
	});

	it("prints workspace execution status as JSON", async () => {
		const root = createWorkspaceRoot({
			packageJson: {
				packageManager: "pnpm@11.7.0",
				devDependencies: {
					turbo: "^2.9.14",
				},
			},
			turbo: true,
			cache: true,
		});
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await createWorkspaceCommand({
			cwd: () => root,
			env: {
				TURBO_CACHE_API_URL: "https://cache.example.test",
				TURBO_CACHE_TOKEN: "token",
			},
		}).parseAsync(["execution", "--json"], { from: "user" });

		expect(JSON.parse(String(logSpy.mock.calls[0]?.[0]))).toMatchObject({
			command: "workspace",
			operation: "execution",
			ok: true,
			root,
			rootSource: "turbo",
			executor: {
				selected: "turbo",
			},
			adapters: {
				turbo: {
					available: true,
					configured: true,
					declared: true,
					configPath: join(root, "turbo.json"),
					installCommand: null,
				},
			},
			cache: {
				local: {
					available: true,
					path: join(root, ".turbo", "cache"),
				},
				remote: {
					configured: true,
				},
			},
			nextAction: null,
			nextActions: [],
			nextCommand: null,
			nextCommands: [],
		});
	});

	it("surfaces the install handoff when turbo is configured but not declared", async () => {
		const root = createWorkspaceRoot({ turbo: true });
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await createWorkspaceCommand({
			cwd: () => root,
			env: {},
		}).parseAsync(["execution", "--json"], { from: "user" });

		expect(JSON.parse(String(logSpy.mock.calls[0]?.[0]))).toMatchObject({
			executor: {
				selected: "direct-script",
			},
			adapters: {
				turbo: {
					available: false,
					configured: true,
					declared: false,
					installCommand: "pnpm add -D -w turbo",
				},
			},
			nextCommand: "pnpm add -D -w turbo",
			nextCommands: ["pnpm add -D -w turbo"],
		});
	});

	it("allows inspecting another workspace with --cwd", async () => {
		const defaultRoot = createWorkspaceRoot();
		const targetRoot = createWorkspaceRoot({
			packageJson: {
				packageManager: "pnpm@11.7.0",
				devDependencies: {
					turbo: "^2.9.14",
				},
			},
			turbo: true,
		});
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await createWorkspaceCommand({
			cwd: () => defaultRoot,
			env: {},
		}).parseAsync(["execution", "--cwd", targetRoot, "--json"], { from: "user" });

		expect(JSON.parse(String(logSpy.mock.calls[0]?.[0]))).toMatchObject({
			root: targetRoot,
			rootSource: "turbo",
			executor: {
				selected: "turbo",
			},
			adapters: {
				turbo: {
					available: true,
					configured: true,
					declared: true,
					configPath: join(targetRoot, "turbo.json"),
				},
			},
		});
	});

	it("allows inspecting a workspace declared in config", async () => {
		const controlRoot = createWorkspaceRoot();
		const targetRoot = createWorkspaceRoot({
			packageJson: {
				packageManager: "pnpm@11.7.0",
				devDependencies: {
					turbo: "^2.9.14",
				},
			},
			turbo: true,
		});
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await createWorkspaceCommand({
			cwd: () => controlRoot,
			env: {},
			loadConfig: () => ({
				workspaces: {
					lab: {
						path: targetRoot,
						kind: "lab",
					},
				},
			}),
		}).parseAsync(["execution", "--workspace", "lab", "--json"], { from: "user" });

		expect(JSON.parse(String(logSpy.mock.calls[0]?.[0]))).toMatchObject({
			root: targetRoot,
			rootSource: "turbo",
			executor: {
				selected: "turbo",
			},
			declaredWorkspace: {
				id: "lab",
				path: targetRoot,
				absolutePath: targetRoot,
				kind: "lab",
				execution: {
					preferredAdapter: "auto",
				},
			},
		});
	});

	it("lists workspaces declared in config", async () => {
		const root = createWorkspaceRoot();
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await createWorkspaceCommand({
			cwd: () => root,
			env: {},
			loadConfig: () => ({
				workspaces: {
					refarm: {
						path: ".",
						kind: "refarm",
					},
					"vault-seed": {
						path: "../greenhouse/vault-seed",
						kind: "vault",
						execution: {
							preferredAdapter: "auto",
						},
					},
				},
			}),
		}).parseAsync(["list", "--json"], { from: "user" });

		expect(JSON.parse(String(logSpy.mock.calls[0]?.[0]))).toMatchObject({
			command: "workspace",
			operation: "list",
			ok: true,
			workspaces: [
				{
					id: "refarm",
					path: ".",
					absolutePath: root,
					kind: "refarm",
				},
				{
					id: "vault-seed",
					path: "../greenhouse/vault-seed",
					absolutePath: join(root, "..", "greenhouse", "vault-seed"),
					kind: "vault",
				},
			],
		});
	});

	it("observes every declared workspace with --all", async () => {
		const controlRoot = createWorkspaceRoot();
		const turboRoot = createWorkspaceRoot({
			packageJson: {
				packageManager: "pnpm@11.7.0",
				devDependencies: {
					turbo: "^2.9.14",
				},
			},
			turbo: true,
		});
		const simpleRoot = createWorkspaceRoot({ pnpmWorkspace: false });
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await createWorkspaceCommand({
			cwd: () => controlRoot,
			env: {},
			loadConfig: () => ({
				workspaces: {
					simple: {
						path: simpleRoot,
					},
					turbo: {
						path: turboRoot,
						kind: "lab",
					},
				},
			}),
		}).parseAsync(["execution", "--all", "--json"], { from: "user" });

		expect(JSON.parse(String(logSpy.mock.calls[0]?.[0]))).toMatchObject({
			command: "workspace",
			operation: "execution",
			ok: true,
			mode: "all",
			summary: {
				total: 2,
				ok: 2,
				failed: 0,
				missingPath: 0,
				turboInstallNeeded: 0,
				remoteCacheUnconfigured: 0,
			},
			recommendations: [],
			observations: [
				{
					declaredWorkspace: {
						id: "simple",
						path: simpleRoot,
					},
					resolution: {
						requestedPath: simpleRoot,
						resolvedPath: simpleRoot,
						candidates: [
							{
								source: "declared",
								path: simpleRoot,
								exists: true,
							},
						],
					},
					ok: true,
					status: {
						root: simpleRoot,
						rootSource: "package-json",
						executor: {
							selected: "direct-script",
						},
					},
				},
				{
					declaredWorkspace: {
						id: "turbo",
						path: turboRoot,
						kind: "lab",
					},
					resolution: {
						requestedPath: turboRoot,
						resolvedPath: turboRoot,
					},
					ok: true,
					status: {
						root: turboRoot,
						rootSource: "turbo",
						executor: {
							selected: "turbo",
						},
					},
				},
			],
		});
	});

	it("prints declared workspace status as a first-class operator command", async () => {
		const controlRoot = createWorkspaceRoot();
		const targetRoot = createWorkspaceRoot({
			packageJson: {
				packageManager: "pnpm@11.7.0",
				devDependencies: {
					turbo: "^2.9.14",
				},
			},
			turbo: true,
		});
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await createWorkspaceCommand({
			cwd: () => controlRoot,
			env: {},
			loadConfig: () => ({
				workspaces: {
					refarm: {
						path: targetRoot,
						cache: {
							remote: {
								provider: "cloudflare-turbo",
							},
						},
					},
				},
			}),
		}).parseAsync(["status", "--json"], { from: "user" });

		expect(JSON.parse(String(logSpy.mock.calls[0]?.[0]))).toMatchObject({
			command: "workspace",
			operation: "status",
			ok: true,
			mode: "all",
			summary: {
				total: 1,
				ok: 1,
				failed: 0,
				remoteCacheUnconfigured: 1,
			},
			recommendations: [
				{
					code: "remote-cache-unconfigured",
					workspaceId: "refarm",
					nextCommand: "refarm provision cloudflare turbo-cache --dry-run --json",
				},
			],
			nextCommand: "refarm provision cloudflare turbo-cache --dry-run --json",
			nextCommands: ["refarm provision cloudflare turbo-cache --dry-run --json"],
		});
	});

	it("prints a devcontainer mount plan for missing workspace bridges", async () => {
		const controlRoot = createWorkspaceRoot();
		const missingRoot = join(controlRoot, "..", "missing-workspace");
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await createWorkspaceCommand({
			cwd: () => controlRoot,
			env: {},
			loadConfig: () => ({
				workspaces: {
					bridged: {
						path: missingRoot,
						bridges: [
							{
								id: "windows-host",
								kind: "filesystem",
								path: "/mnt/c/Users/aretw/Documents/GitHub/bridged",
								hostPath: "C:\\Users\\aretw\\Documents\\GitHub\\bridged",
								mountHint: "Mount the host checkout into the dev container.",
							},
						],
					},
				},
			}),
		}).parseAsync(["mounts", "--json"], { from: "user" });

		expect(JSON.parse(String(logSpy.mock.calls[0]?.[0]))).toMatchObject({
			command: "workspace",
			operation: "mounts",
			ok: true,
			mode: "all",
			mountCount: 1,
			mounts: [
				{
					workspaceId: "bridged",
					mount: `source=C:\\Users\\aretw\\Documents\\GitHub\\bridged,target=${missingRoot},type=bind`,
				},
			],
			devcontainerJson: {
				path: ".devcontainer/devcontainer.json",
				mounts: [
					`source=C:\\Users\\aretw\\Documents\\GitHub\\bridged,target=${missingRoot},type=bind`,
				],
			},
			rebuildRequired: true,
			instructions: [
				"Add the listed mount strings to .devcontainer/devcontainer.json mounts.",
				"Rebuild the devcontainer after changing mounts.",
			],
			nextAction:
				"Add listed mounts to .devcontainer/devcontainer.json and rebuild the devcontainer.",
			nextCommand: null,
			nextCommands: [],
		});
	});

	it("prioritizes the mount plan before remote cache provisioning in workspace status", async () => {
		const controlRoot = createWorkspaceRoot();
		const missingRoot = join(controlRoot, "..", "missing-workspace");
		const targetRoot = createWorkspaceRoot({
			packageJson: {
				packageManager: "pnpm@11.7.0",
				devDependencies: {
					turbo: "^2.9.14",
				},
			},
			turbo: true,
		});
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await createWorkspaceCommand({
			cwd: () => controlRoot,
			env: {},
			loadConfig: () => ({
				workspaces: {
					bridged: {
						path: missingRoot,
						bridges: [
							{
								id: "windows-host",
								kind: "filesystem",
								path: "/mnt/c/Users/aretw/Documents/GitHub/bridged",
								hostPath: "C:\\Users\\aretw\\Documents\\GitHub\\bridged",
								mountHint: "Mount the host checkout into the dev container.",
							},
						],
					},
					refarm: {
						path: targetRoot,
						cache: {
							remote: {
								provider: "cloudflare-turbo",
							},
						},
					},
				},
			}),
		}).parseAsync(["status", "--json"], { from: "user" });

		expect(JSON.parse(String(logSpy.mock.calls[0]?.[0]))).toMatchObject({
			command: "workspace",
			operation: "status",
			ok: true,
			nextCommand: "refarm workspace mounts --json",
			nextCommands: [
				"refarm workspace mounts --json",
				"refarm provision cloudflare turbo-cache --dry-run --json",
			],
		});
	});

	it("keeps --all read-only and reports missing declared workspaces as observations", async () => {
		const controlRoot = createWorkspaceRoot();
		const missingRoot = join(controlRoot, "..", "missing-workspace");
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await createWorkspaceCommand({
			cwd: () => controlRoot,
			env: {},
			loadConfig: () => ({
				workspaces: {
					missing: {
						path: missingRoot,
					},
				},
			}),
		}).parseAsync(["execution", "--all", "--json"], { from: "user" });

		expect(JSON.parse(String(logSpy.mock.calls[0]?.[0]))).toMatchObject({
			command: "workspace",
			operation: "execution",
			ok: true,
			mode: "all",
			summary: {
				total: 1,
				ok: 0,
				failed: 1,
				missingPath: 1,
			},
			recommendations: [
				{
					code: "workspace-path-missing",
					workspaceId: "missing",
					message: "No declared or bridged path is visible for workspace missing.",
					mountHints: [],
				},
			],
			observations: [
				{
					declaredWorkspace: {
						id: "missing",
						path: missingRoot,
						absolutePath: missingRoot,
					},
					ok: false,
					resolution: {
						requestedPath: missingRoot,
						resolvedPath: null,
						candidates: [
							{
								source: "declared",
								path: missingRoot,
								exists: false,
							},
						],
					},
					error: {
						code: "workspace-execution-failed",
						message: "No declared or bridged path is visible for workspace missing.",
					},
				},
			],
		});
	});

	it("uses an available bridge path when the declared path is not mounted", async () => {
		const controlRoot = createWorkspaceRoot();
		const missingRoot = join(controlRoot, "..", "missing-workspace");
		const bridgeRoot = createWorkspaceRoot({ pnpmWorkspace: false });
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await createWorkspaceCommand({
			cwd: () => controlRoot,
			env: {},
			loadConfig: () => ({
				workspaces: {
					bridged: {
						path: missingRoot,
						bridges: [
							{
								id: "container",
								kind: "filesystem",
								path: bridgeRoot,
								hostPath: "C:\\Users\\aretw\\Documents\\GitHub\\bridged",
								mountHint: "Mount the host checkout into the dev container.",
							},
						],
					},
				},
			}),
		}).parseAsync(["execution", "--all", "--json"], { from: "user" });

		expect(JSON.parse(String(logSpy.mock.calls[0]?.[0]))).toMatchObject({
			summary: {
				total: 1,
				ok: 1,
				failed: 0,
				missingPath: 0,
			},
			recommendations: [],
			observations: [
				{
					ok: true,
					resolution: {
						requestedPath: missingRoot,
						resolvedPath: bridgeRoot,
						candidates: [
							{
								source: "declared",
								path: missingRoot,
								exists: false,
							},
							{
								source: "bridge",
								path: bridgeRoot,
								bridgeId: "container",
								hostPath: "C:\\Users\\aretw\\Documents\\GitHub\\bridged",
								mountHint: "Mount the host checkout into the dev container.",
								exists: true,
							},
						],
					},
					status: {
						root: bridgeRoot,
						rootSource: "package-json",
					},
				},
			],
		});
	});

	it("uses an available bridge path when inspecting a single declared workspace", async () => {
		const controlRoot = createWorkspaceRoot();
		const missingRoot = join(controlRoot, "..", "missing-workspace");
		const bridgeRoot = createWorkspaceRoot({ pnpmWorkspace: false });
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await createWorkspaceCommand({
			cwd: () => controlRoot,
			env: {},
			loadConfig: () => ({
				workspaces: {
					bridged: {
						path: missingRoot,
						bridges: [
							{
								id: "container",
								kind: "filesystem",
								path: bridgeRoot,
								hostPath: "C:\\Users\\aretw\\Documents\\GitHub\\bridged",
								mountHint: "Mount the host checkout into the dev container.",
							},
						],
					},
				},
			}),
		}).parseAsync(["execution", "--workspace", "bridged", "--json"], { from: "user" });

		expect(JSON.parse(String(logSpy.mock.calls[0]?.[0]))).toMatchObject({
			command: "workspace",
			operation: "execution",
			ok: true,
			root: bridgeRoot,
			rootSource: "package-json",
			declaredWorkspace: {
				id: "bridged",
				path: missingRoot,
				absolutePath: missingRoot,
			},
			pathResolution: {
				requestedPath: missingRoot,
				resolvedPath: bridgeRoot,
				candidates: [
					{
						source: "declared",
						path: missingRoot,
						exists: false,
					},
					{
						source: "bridge",
						path: bridgeRoot,
						bridgeId: "container",
						hostPath: "C:\\Users\\aretw\\Documents\\GitHub\\bridged",
						mountHint: "Mount the host checkout into the dev container.",
						exists: true,
					},
				],
			},
		});
	});

	it("recommends remote cache provisioning when config declares remote cache intent", async () => {
		const controlRoot = createWorkspaceRoot();
		const targetRoot = createWorkspaceRoot({
			packageJson: {
				packageManager: "pnpm@11.7.0",
				devDependencies: {
					turbo: "^2.9.14",
				},
			},
			turbo: true,
		});
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await createWorkspaceCommand({
			cwd: () => controlRoot,
			env: {},
			loadConfig: () => ({
				workspaces: {
					refarm: {
						path: targetRoot,
						cache: {
							remote: {
								provider: "cloudflare-turbo",
							},
						},
					},
				},
			}),
		}).parseAsync(["execution", "--all", "--json"], { from: "user" });

		expect(JSON.parse(String(logSpy.mock.calls[0]?.[0]))).toMatchObject({
			summary: {
				total: 1,
				ok: 1,
				failed: 0,
				remoteCacheUnconfigured: 1,
			},
			recommendations: [
				{
					code: "remote-cache-unconfigured",
					workspaceId: "refarm",
					message: "Workspace refarm declares remote cache intent but runtime env is not configured.",
					nextCommand: "refarm provision cloudflare turbo-cache --dry-run --json",
				},
			],
			nextCommand: "refarm provision cloudflare turbo-cache --dry-run --json",
			nextCommands: ["refarm provision cloudflare turbo-cache --dry-run --json"],
		});
	});

	it("uses the nearest package.json as a fallback root for simple projects", async () => {
		const root = createWorkspaceRoot({ pnpmWorkspace: false });
		const nested = join(root, "src", "commands");
		mkdirSync(nested, { recursive: true });
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await createWorkspaceCommand({
			cwd: () => nested,
			env: {},
		}).parseAsync(["execution", "--json"], { from: "user" });

		expect(JSON.parse(String(logSpy.mock.calls[0]?.[0]))).toMatchObject({
			root,
			rootSource: "package-json",
			executor: {
				selected: "direct-script",
			},
			adapters: {
				turbo: {
					available: false,
					configured: false,
					declared: false,
					configPath: null,
				},
			},
		});
	});

	it("prints a concise human-readable summary", async () => {
		const root = createWorkspaceRoot({ turbo: true });
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await createWorkspaceCommand({
			cwd: () => root,
			env: {},
		}).parseAsync(["execution"], { from: "user" });

		const output = logSpy.mock.calls.map((call) => String(call[0])).join("\n");
		expect(output).toContain("Workspace execution");
		expect(output).toContain(`root:     ${root}`);
		expect(output).toContain("source:   turbo");
		expect(output).toContain("executor: direct-script");
		expect(output).toContain("turbo:    not provisioned");
		expect(output).toContain("install:  pnpm add -D -w turbo");
		expect(output).toContain("cache:    local not found, remote not configured");
	});
});
