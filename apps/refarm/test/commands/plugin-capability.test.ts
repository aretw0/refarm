import { describe, expect, it } from "vitest";

import {
	createPluginCapabilityGroup,
	pluginCapabilityHooks,
	type PluginCommandDeps,
} from "../../src/commands/plugin-capability.js";

function makeDeps(overrides: Partial<PluginCommandDeps> = {}): PluginCommandDeps {
	return {
		buildListReport: async () => ({
			plugins: [
				{
					id: "@refarm/agent",
					version: "0.1.0",
					source: "bundled",
					packageSource: "node_modules",
					packageDir: "/x",
					installed: true,
				},
			],
		}),
		readManifest: async () => ({ permissions: [] }),
		readRuntimePluginState: async () => null,
		buildInstallReport: async () =>
			({ ok: true, command: "plugin", operation: "install" }) as never,
		runBundle: async () => ({ exitCode: 0, stdout: "", stderr: "" }) as never,
		onProgress: () => {},
		reloadAndWait: async () =>
			({ reloaded: [], skipped: [], timedOut: false }) as never,
		restartRuntime: async () =>
			({ ok: true, restartCommand: "refarm runtime restart" }) as never,
		...overrides,
	};
}

/** Non-optional action accessor — the actions Record is typed as possibly-undefined. */
function action(group: ReturnType<typeof createPluginCapabilityGroup>, key: string) {
	const descriptor = group.actions[key];
	if (!descriptor) throw new Error(`no such action: ${key}`);
	return descriptor;
}

const input = (args: Record<string, string> = {}) => ({
	args,
	options: {},
	json: true,
});

describe("plugin capability group", () => {
	it("is named `plugin` with list as the default action (handoff byte-stability)", () => {
		const group = createPluginCapabilityGroup(makeDeps());
		expect(group.name).toBe("plugin");
		expect(group.defaultAction).toBe("list");
		// tri-surface declaration — one entry lights up CLI/REPL/HTTP/TUI
		expect(group.transports?.http).toEqual({ method: "GET", path: "/plugins" });
	});

	describe("list", () => {
		it("returns the inventory report with a status next-command when all installed", async () => {
			const group = createPluginCapabilityGroup(makeDeps());
			const env = await action(group, "list").run(input());
			expect(env.ok).toBe(true);
			expect(env.command).toBe("plugin");
			expect(env.operation).toBe("list");
			// all installed → next step is status, not install
			expect(env.nextCommand).toContain("plugin");
			expect(env.nextCommand).toContain("status");
		});

		it("points at install when a plugin is missing", async () => {
			const group = createPluginCapabilityGroup(
				makeDeps({
					buildListReport: async () => ({
						plugins: [
							{
								id: "@refarm/agent",
								version: null,
								source: "bundled",
								packageSource: "unresolved",
								packageDir: null,
								installed: false,
							},
						],
					}),
				}),
			);
			const env = await action(group, "list").run(input());
			expect(env.ok).toBe(true);
			expect(env.nextCommand).toContain("install");
		});
	});

	describe("permissions <id>", () => {
		it("maps declared permissions through the vocab into {id,label,risk}", async () => {
			const group = createPluginCapabilityGroup(
				makeDeps({
					readManifest: async () => ({
						permissions: ["fs:read", "shell:spawn"],
					}),
				}),
			);
			const env = await action(group, "permissions").run(input({ id: "@x/p" }));
			expect(env.ok).toBe(true);
			expect(env.operation).toBe("permissions");
			const perms = (env as { permissions?: unknown }).permissions as Array<{
				id: string;
				label: string;
				risk: string;
			}>;
			// The envelope carries the vocab-rendered permissions under extra.
			const extra = env as unknown as {
				permissions: typeof perms;
				unknown: string[];
			};
			expect(extra.permissions.map((p) => p.id)).toEqual([
				"fs:read",
				"shell:spawn",
			]);
			expect(extra.permissions.find((p) => p.id === "shell:spawn")?.risk).toBe(
				"high",
			);
			expect(extra.unknown).toEqual([]);
		});

		it("surfaces permissions outside the closed vocabulary as unknown", async () => {
			const group = createPluginCapabilityGroup(
				makeDeps({
					readManifest: async () => ({ permissions: ["fs:read", "fs:reed"] }),
				}),
			);
			const env = await action(group, "permissions").run(input({ id: "@x/p" }));
			const extra = env as unknown as {
				permissions: Array<{ id: string }>;
				unknown: string[];
			};
			expect(extra.permissions.map((p) => p.id)).toEqual(["fs:read"]);
			expect(extra.unknown).toEqual(["fs:reed"]);
		});

		it("returns an error envelope when the manifest is missing", async () => {
			const group = createPluginCapabilityGroup(
				makeDeps({
					readManifest: async () => {
						throw new Error("ENOENT");
					},
				}),
			);
			const env = await action(group, "permissions").run(input({ id: "@x/nope" }));
			expect(env.ok).toBe(false);
			expect((env as { error?: string }).error).toBe(
				"plugin-manifest-not-found",
			);
		});
	});

	describe("status", () => {
		it("returns a graceful ok:false envelope when the sidecar is unreachable", async () => {
			// readRuntimePluginState → null must not throw; the report is the
			// byte-stable "unavailable" envelope, safe to return from a headless run().
			const group = createPluginCapabilityGroup(
				makeDeps({ readRuntimePluginState: async () => null }),
			);
			const env = await action(group, "status").run(input());
			expect(env.command).toBe("plugin");
			expect(env.operation).toBe("status");
			expect(env.ok).toBe(false);
			expect((env as { available?: boolean }).available).toBe(false);
		});
	});

	describe("install / update", () => {
		it("install stamps operation:install and passes --force through", async () => {
			let sawForce: boolean | undefined;
			const group = createPluginCapabilityGroup(
				makeDeps({
					buildInstallReport: async ({ force }) => {
						sawForce = force;
						return {
							ok: true,
							command: "plugin",
							operation: "install",
						} as never;
					},
				}),
			);
			const env = await action(group, "install").run({
				args: {},
				options: { force: true },
				json: true,
			});
			expect(sawForce).toBe(true);
			expect(env.operation).toBe("install");
		});

		it("update calls the installer with force:false", async () => {
			let sawForce: boolean | undefined;
			const group = createPluginCapabilityGroup(
				makeDeps({
					buildInstallReport: async ({ force }) => {
						sawForce = force;
						return { ok: true, command: "plugin", operation: "install" } as never;
					},
				}),
			);
			await action(group, "update").run(input());
			expect(sawForce).toBe(false);
		});
	});

	describe("bundle <input>", () => {
		it("dry-run returns the transpile plan without spawning", async () => {
			let spawned = false;
			const group = createPluginCapabilityGroup(
				makeDeps({
					runBundle: async () => {
						spawned = true;
						return { exitCode: 0, stdout: "", stderr: "" } as never;
					},
				}),
			);
			const env = await action(group, "bundle").run({
				args: { input: "./p.wasm" },
				options: { "dry-run": true },
				json: true,
			});
			expect(env.ok).toBe(true);
			expect(env.operation).toBe("bundle");
			expect((env as { dryRun?: boolean }).dryRun).toBe(true);
			expect(spawned).toBe(false);
		});

		it("success returns the artifact envelope", async () => {
			const group = createPluginCapabilityGroup(makeDeps());
			const env = await action(group, "bundle").run({
				args: { input: "./p.wasm" },
				options: {},
				json: true,
			});
			expect(env.ok).toBe(true);
			expect((env as { artifact?: string }).artifact).toContain(".js");
		});

		it("failure forwards jco's exit code via the hook (as flat exitCode)", async () => {
			const group = createPluginCapabilityGroup(
				makeDeps({
					runBundle: async () =>
						({ exitCode: 3, stdout: "", stderr: "boom" }) as never,
				}),
			);
			const env = await action(group, "bundle").run({
				args: { input: "./p.wasm" },
				options: {},
				json: true,
			});
			expect(env.ok).toBe(false);
			expect((env as { error?: string }).error).toBe("plugin-bundle-failed");
			// The hook reads this flat field to forward jco's own code (not 1).
			expect((env as { exitCode?: number }).exitCode).toBe(3);
			expect(pluginCapabilityHooks("bundle").exitCode?.(env)).toBe(3);
		});

		it("a successful bundle exits 0 (hook guards on ok)", () => {
			const okEnv = { ok: true, command: "plugin", operation: "bundle" } as never;
			expect(pluginCapabilityHooks("bundle").exitCode?.(okEnv)).toBe(0);
		});
	});

	describe("reload [pluginIds...] — the 7-branch matrix", () => {
		const reloadInput = (
			pluginIds: string[] = [],
			options: Record<string, boolean> = {},
		) => ({ args: { pluginIds }, options, json: true });

		it("B7 full success returns ok with reloaded/skipped/timedOut", async () => {
			const group = createPluginCapabilityGroup(
				makeDeps({
					reloadAndWait: async () =>
						({ reloaded: ["agent"], skipped: [], timedOut: false }) as never,
				}),
			);
			const env = await action(group, "reload").run(reloadInput(["agent"]));
			expect(env.ok).toBe(true);
			expect(env.operation).toBe("reload");
			const x = env as unknown as { requested: string[]; reloaded: string[] };
			expect(x.requested).toEqual(["agent"]); // RAW pluginIds
			expect(x.reloaded).toEqual(["agent"]);
		});

		it("B1 endpoint unavailable, no restart → ok:false unavailable error", async () => {
			const group = createPluginCapabilityGroup(
				makeDeps({ reloadAndWait: async () => null }),
			);
			const env = await action(group, "reload").run(reloadInput(["agent"]));
			expect(env.ok).toBe(false);
			expect((env as { error?: string }).error).toBe(
				"runtime-plugin-reload-unavailable",
			);
			// requested is RAW; recommendations present
			expect((env as unknown as { requested: string[] }).requested).toEqual([
				"agent",
			]);
		});

		it("B2 unavailable + restart OK → ok:true, skipped normalized", async () => {
			const group = createPluginCapabilityGroup(
				makeDeps({
					reloadAndWait: async () => null,
					restartRuntime: async () =>
						({ ok: true, restartCommand: "refarm runtime restart" }) as never,
				}),
			);
			const env = await action(group, "reload").run(
				reloadInput(["agent"], { "restart-if-needed": true }),
			);
			expect(env.ok).toBe(true);
			const x = env as unknown as {
				restarted: boolean;
				skipped: string[];
				requested: string[];
			};
			expect(x.restarted).toBe(true);
			expect(x.requested).toEqual(["agent"]); // raw
			expect(x.skipped).toEqual(["@refarm/agent"]); // normalized
		});

		it("B3 unavailable + restart FAILED → restart-failed error", async () => {
			const group = createPluginCapabilityGroup(
				makeDeps({
					reloadAndWait: async () => null,
					restartRuntime: async () =>
						({
							ok: false,
							restartCommand: "refarm runtime restart",
							failedCommand: "refarm runtime restart --wait",
						}) as never,
				}),
			);
			const env = await action(group, "reload").run(
				reloadInput(["agent"], { "restart-if-needed": true, wait: true }),
			);
			expect(env.ok).toBe(false);
			expect((env as { error?: string }).error).toBe(
				"runtime-plugin-restart-failed",
			);
			// nextCommand is the failedCommand
			expect((env as { nextCommand?: string }).nextCommand).toBe(
				"refarm runtime restart --wait",
			);
		});

		it("B4 partial/timeout, no restart → reload-partial error", async () => {
			const group = createPluginCapabilityGroup(
				makeDeps({
					reloadAndWait: async () =>
						({
							reloaded: [],
							skipped: ["@refarm/agent"],
							timedOut: false,
						}) as never,
				}),
			);
			const env = await action(group, "reload").run(reloadInput(["agent"]));
			expect(env.ok).toBe(false);
			expect((env as { error?: string }).error).toBe(
				"runtime-plugin-reload-partial",
			);
			expect(
				(env as unknown as { skipped: string[] }).skipped,
			).toEqual(["@refarm/agent"]);
		});

		it("B5 partial + restart OK → ok:true (timedOut precedes restarted in extra)", async () => {
			const group = createPluginCapabilityGroup(
				makeDeps({
					reloadAndWait: async () =>
						({
							reloaded: [],
							skipped: ["@refarm/agent"],
							timedOut: true,
						}) as never,
					restartRuntime: async () =>
						({ ok: true, restartCommand: "refarm runtime restart" }) as never,
				}),
			);
			const env = await action(group, "reload").run(
				reloadInput(["agent"], { "restart-if-needed": true }),
			);
			expect(env.ok).toBe(true);
			// byte-order: extra has …skipped, timedOut, restarted, restart
			const keys = Object.keys(env as object);
			expect(keys.indexOf("timedOut")).toBeLessThan(keys.indexOf("restarted"));
		});

		it("B6 partial + restart FAILED → error (timedOut LAST in extra)", async () => {
			const group = createPluginCapabilityGroup(
				makeDeps({
					reloadAndWait: async () =>
						({
							reloaded: [],
							skipped: ["@refarm/agent"],
							timedOut: true,
						}) as never,
					restartRuntime: async () =>
						({
							ok: false,
							restartCommand: "refarm runtime restart",
							failedCommand: "refarm runtime restart --wait",
						}) as never,
				}),
			);
			const env = await action(group, "reload").run(
				reloadInput(["agent"], { "restart-if-needed": true, wait: true }),
			);
			expect(env.ok).toBe(false);
			expect((env as { error?: string }).error).toBe(
				"runtime-plugin-restart-failed",
			);
			// byte-order: extra has …restarted, restart, timedOut (timedOut LAST)
			const keys = Object.keys(env as object);
			expect(keys.indexOf("restart")).toBeLessThan(keys.indexOf("timedOut"));
		});
	});
});
