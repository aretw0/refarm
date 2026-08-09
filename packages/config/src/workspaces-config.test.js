import { describe, expect, it } from "vitest";
import {
	declaredWorkspaceFromConfig,
	declaredWorkspacesFromConfig,
	parseWorkspaceExecutionAdapter,
	parseWorkspaceKind,
	parseWorkspaceRemoteCacheProvider,
} from "./workspaces-config.js";

describe("workspace config declarations", () => {
	it("normalizes declared workspaces as intent, not observed runtime state", () => {
		const config = {
			workspaces: {
				refarm: {
					path: ".",
					kind: "refarm",
					execution: {
						preferredAdapter: "auto",
					},
					cache: {
						local: true,
						remote: {
							provider: "cloudflare-turbo",
							env: {
								apiUrl: "REFARM_TURBO_CACHE_API_URL",
								token: "REFARM_TURBO_CACHE_TOKEN",
							},
						},
					},
				},
				"agents-lab": {
					path: "../agents-lab",
					kind: "lab",
					execution: {
						preferredAdapter: "turbo",
					},
				},
			},
		};

		expect(declaredWorkspacesFromConfig(config, { baseDir: "/workspaces/refarm" })).toEqual([
			{
				id: "agents-lab",
				path: "../agents-lab",
				absolutePath: "/workspaces/agents-lab",
				kind: "lab",
				execution: {
					preferredAdapter: "turbo",
				},
				cache: {
					local: true,
					remote: null,
				},
				repository: null,
				bridges: [],
				commands: {},
				issues: null,
			},
			{
				id: "refarm",
				path: ".",
				absolutePath: "/workspaces/refarm",
				kind: "refarm",
				execution: {
					preferredAdapter: "auto",
				},
				cache: {
					local: true,
					remote: {
						provider: "cloudflare-turbo",
						env: {
							apiUrl: "REFARM_TURBO_CACHE_API_URL",
							token: "REFARM_TURBO_CACHE_TOKEN",
						},
					},
				},
				repository: null,
				bridges: [],
				commands: {},
				issues: null,
			},
		]);
	});

	it("normalizes a declared command allowlist to argv (an operation catalog, not a shell)", () => {
		const workspace = declaredWorkspaceFromConfig(
			{
				workspaces: {
					rcdc5: {
						path: "../rcdc5",
						kind: "project",
						commands: {
							// shorthand string → split to argv (no shell)
							vpn: "pnpm --filter @rcdcp/serpro-vpn run vpn connect",
							// explicit argv + cwd + description
							scrape: {
								run: ["node", "src/index.js", "scrape"],
								cwd: "packages/scraper-playwright",
								description: "Raspagem de requisitos",
								remote: true,
								result: "operation-result.v1",
							},
							local: { run: ["node", "local.js"], remote: "true", result: "json" },
							"": "ignored — blank name",
							bad: { run: 42 },
						},
					},
				},
			},
			"rcdc5",
			{ baseDir: "/home/me/git/refarm" },
		);

		expect(workspace?.commands).toEqual({
			vpn: { run: ["pnpm", "--filter", "@rcdcp/serpro-vpn", "run", "vpn", "connect"] },
			scrape: {
				run: ["node", "src/index.js", "scrape"],
				cwd: "packages/scraper-playwright",
				description: "Raspagem de requisitos",
				remote: true,
				result: "operation-result.v1",
			},
			local: { run: ["node", "local.js"] },
		});
	});

	it("carries a command's provenance when it names the workspace-offer source, and drops any other value", () => {
		const workspace = declaredWorkspaceFromConfig(
			{
				workspaces: {
					app: {
						path: ".",
						commands: {
							// accepted from the workspace's own offer via `refarm workspace sync`
							build: { run: ["pnpm", "build"], source: "workspace-offer" },
							// authored directly via `refarm workspace command add` — no provenance tag
							test: { run: ["pnpm", "test"] },
							// an unrecognized value is not a fact anyone authored — dropped, fail-closed
							deploy: { run: ["pnpm", "deploy"], source: "operator" },
						},
					},
				},
			},
			"app",
			{ baseDir: "/workspaces/refarm" },
		);

		expect(workspace?.commands).toEqual({
			build: { run: ["pnpm", "build"], source: "workspace-offer" },
			test: { run: ["pnpm", "test"] },
			deploy: { run: ["pnpm", "deploy"] },
		});
	});

	it("uses conservative defaults for partial declarations", () => {
		expect(
			declaredWorkspaceFromConfig(
				{
					workspaces: {
						"vault-seed": {
							path: "../greenhouse/vault-seed",
							kind: "vault",
						},
					},
				},
				"vault-seed",
				{ baseDir: "/workspaces/refarm" },
			),
		).toMatchObject({
			id: "vault-seed",
			path: "../greenhouse/vault-seed",
			absolutePath: "/workspaces/greenhouse/vault-seed",
			kind: "vault",
			execution: {
				preferredAdapter: "auto",
			},
			cache: {
				local: true,
				remote: null,
			},
			repository: null,
			bridges: [],
		});
	});

	it("normalizes optional source repository intent", () => {
		expect(
			declaredWorkspaceFromConfig(
				{
					workspaces: {
						"agents-lab": {
							path: "../agents-lab",
							repository: {
								url: " https://github.com/example/agents-lab.git ",
								ref: " develop ",
							},
						},
					},
				},
				"agents-lab",
				{ baseDir: "/workspaces/refarm" },
			),
		).toMatchObject({
			repository: {
				url: "https://github.com/example/agents-lab.git",
				ref: "develop",
			},
		});
	});

	it("normalizes filesystem bridge candidates without resolving runtime state", () => {
		expect(
			declaredWorkspaceFromConfig(
				{
					workspaces: {
						"agents-lab": {
							path: "../agents-lab",
							bridges: [
								{
									id: "windows-host",
									kind: "filesystem",
									path: "/mnt/c/Users/aretw/Documents/GitHub/agents-lab",
									hostPath: "C:\\Users\\aretw\\Documents\\GitHub\\agents-lab",
									mountHint: "Mount the Windows checkout into the container.",
								},
							],
						},
					},
				},
				"agents-lab",
				{ baseDir: "/workspaces/refarm" },
			),
		).toMatchObject({
			bridges: [
				{
					id: "windows-host",
					kind: "filesystem",
					path: "/mnt/c/Users/aretw/Documents/GitHub/agents-lab",
					hostPath: "C:\\Users\\aretw\\Documents\\GitHub\\agents-lab",
					mountHint: "Mount the Windows checkout into the container.",
				},
			],
		});
	});

	it("ignores malformed workspace declarations", () => {
		expect(
			declaredWorkspacesFromConfig({
				workspaces: {
					ok: {
						path: ".",
					},
					nope: null,
				},
			}),
		).toHaveLength(1);
	});

	it("parses known workspace enum values", () => {
		expect(parseWorkspaceExecutionAdapter("direct-script")).toBe("direct-script");
		expect(parseWorkspaceExecutionAdapter("make")).toBeNull();
		expect(parseWorkspaceKind("consumer")).toBe("consumer");
		expect(parseWorkspaceKind("unknown")).toBeNull();
		expect(parseWorkspaceRemoteCacheProvider("custom")).toBe("custom");
		expect(parseWorkspaceRemoteCacheProvider("redis")).toBeNull();
	});
});

describe("declared workspace issues block", () => {
	it("carries a declared issues block through normalisation", () => {
		const [workspace] = declaredWorkspacesFromConfig(
			{ workspaces: { a: { path: "/w/a", issues: { provider: "project-json", path: ".project/issues.json" } } } },
			{ baseDir: "/base" },
		);
		expect(workspace.issues).toEqual({ provider: "project-json", path: ".project/issues.json" });
	});

	it("is null when undeclared — never a guess", () => {
		const [workspace] = declaredWorkspacesFromConfig(
			{ workspaces: { a: { path: "/w/a" } } },
			{ baseDir: "/base" },
		);
		expect(workspace.issues).toBeNull();
	});

	it("is null when the block is malformed rather than half-normalised", () => {
		const [workspace] = declaredWorkspacesFromConfig(
			{ workspaces: { a: { path: "/w/a", issues: { provider: 42 } } } },
			{ baseDir: "/base" },
		);
		expect(workspace.issues).toBeNull();
	});

	it("does not drop the commands map when issues is present", () => {
		const [workspace] = declaredWorkspacesFromConfig(
			{ workspaces: { a: { path: "/w/a", commands: { vpn: { run: ["true"] } }, issues: { provider: "project-json", path: "p.json" } } } },
			{ baseDir: "/base" },
		);
		expect(Object.keys(workspace.commands)).toContain("vpn");
	});
});
