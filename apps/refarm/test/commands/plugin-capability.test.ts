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
		persistApproval: (filePath, pluginId, capabilities) => ({
			pluginId,
			filePath,
			approved: [...new Set(capabilities)].sort(),
			changed: true,
		}),
		persistTrust: (filePath, pluginId, trusted) => ({
			pluginId,
			filePath,
			trusted,
			trustedPlugins: trusted ? [pluginId] : [],
			changed: true,
		}),
		persistRevocation: (filePath, pluginId, capability) => ({
			pluginId,
			filePath,
			capability,
			changed: true,
		}),
		persistUnrevocation: (filePath, pluginId, capability) => ({
			pluginId,
			filePath,
			capability,
			changed: true,
		}),
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

		// ADR-086 phase 2: the origin axis. --origin passes a validated filter to
		// the reader; an unknown origin is a loud error, not a silent empty list.
		it("passes a validated --origin filter through to the reader", async () => {
			let received: { origin?: string } | undefined;
			const group = createPluginCapabilityGroup(
				makeDeps({
					buildListReport: async (opts) => {
						received = opts;
						return { plugins: [] };
					},
				}),
			);
			const env = await action(group, "list").run({
				args: {},
				options: { origin: "local" },
				json: true,
			});
			expect(env.ok).toBe(true);
			expect(received).toEqual({ origin: "local" });
		});

		// ADR-086 white-label seam: a white-label app injects its OWN bundled set,
		// and both list + install must reflect it (not refarm's fixed BUNDLED_PLUGINS).
		it("threads the app's injected bundled set into the list reader", async () => {
			const appBundled = [
				{
					id: "@acme/tool",
					npmPackage: "@acme/tool",
					workspaceDir: "",
					wasmFile: "",
					manifestFile: "",
					requiredProvides: [],
				},
			];
			let receivedBundled: unknown;
			const group = createPluginCapabilityGroup(
				makeDeps({
					bundledPlugins: appBundled,
					buildListReport: async (opts) => {
						receivedBundled = opts?.bundled;
						return { plugins: [] };
					},
				}),
			);
			await action(group, "list").run(input());
			expect(receivedBundled).toBe(appBundled);
		});

		it("calls the reader with no filter when --origin is absent", async () => {
			let received: { origin?: string } | undefined = { origin: "sentinel" };
			const group = createPluginCapabilityGroup(
				makeDeps({
					buildListReport: async (opts) => {
						received = opts;
						return { plugins: [] };
					},
				}),
			);
			await action(group, "list").run(input());
			expect(received).toEqual({});
		});

		it("rejects an unknown --origin with a loud error envelope", async () => {
			let called = false;
			const group = createPluginCapabilityGroup(
				makeDeps({
					buildListReport: async () => {
						called = true;
						return { plugins: [] };
					},
				}),
			);
			const env = await action(group, "list").run({
				args: {},
				options: { origin: "moon" },
				json: true,
			});
			expect(env.ok).toBe(false);
			expect((env as { error?: string }).error).toBe("invalid-origin");
			expect((env as { message?: string }).message).toContain("local");
			// loud: it never queried the reader with a bad filter.
			expect(called).toBe(false);
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

		it("resolves a DECLARED runtime id to the manifest the store is keyed by", async () => {
			// ISS-068, measured on the operator's node 2026-08-25. `plugin status` shows
			// `lsp-code-ops`; the installed directory and `approvedPermissions` are keyed by
			// `@refarm/lsp-code-ops`; and `plugin list` contains it under NO --origin filter. So
			// the audit question "what may this loaded plugin do" — and it declares shell:spawn —
			// had no answer path from any id the node published.
			const seen: string[] = [];
			const group = createPluginCapabilityGroup(
				makeDeps({
					readManifest: async (id: string) => {
						seen.push(id);
						return { permissions: ["fs:read"] };
					},
				}),
			);
			await action(group, "permissions").run(input({ id: "lsp-code-ops" }));
			expect(seen).toEqual(["@refarm/lsp-code-ops"]);
		});

		it("passes an UNDECLARED id through untouched, so nothing is guessed", async () => {
			// The distinction `pluginIdPair` exists to keep: a confidently wrong manifest id is
			// what put a deny-all on the operator's real node. Only ids this repo DECLARES are
			// mapped; everything else reaches the store exactly as typed and refuses honestly.
			const seen: string[] = [];
			const group = createPluginCapabilityGroup(
				makeDeps({
					readManifest: async (id: string) => {
						seen.push(id);
						return { permissions: [] };
					},
				}),
			);
			await action(group, "permissions").run(input({ id: "some-third-party" }));
			expect(seen).toEqual(["some-third-party"]);
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

		// ADR-086 phase 3: install unifies bundled-sync + install-one-by-ref, routing
		// on the reference shape. These cover the routing WITHOUT touching the fs
		// (the local branch is proven e2e); each asserts the branch is reached.
		it("--bundled (no ref) syncs the bundled set", async () => {
			let called = false;
			const group = createPluginCapabilityGroup(
				makeDeps({
					buildInstallReport: async () => {
						called = true;
						return { ok: true, command: "plugin", operation: "install" } as never;
					},
				}),
			);
			const env = await action(group, "install").run({
				args: {},
				options: { bundled: true },
				json: true,
			});
			expect(called).toBe(true);
			expect(env.ok).toBe(true);
		});

		it("threads the app's injected bundled set into --bundled install (white-label)", async () => {
			const appBundled = [
				{
					id: "@acme/tool",
					npmPackage: "@acme/tool",
					workspaceDir: "",
					wasmFile: "",
					manifestFile: "",
					requiredProvides: [],
				},
			];
			let receivedBundled: unknown;
			const group = createPluginCapabilityGroup(
				makeDeps({
					bundledPlugins: appBundled,
					buildInstallReport: async (opts) => {
						receivedBundled = opts?.bundled;
						return { ok: true, command: "plugin", operation: "install" } as never;
					},
				}),
			);
			await action(group, "install").run({
				args: {},
				options: { bundled: true },
				json: true,
			});
			expect(receivedBundled).toBe(appBundled);
		});

		it("routes an npm ref to the npm installer (wired; unresolved package fails loud)", async () => {
			let syncCalled = false;
			const group = createPluginCapabilityGroup(
				makeDeps({
					buildInstallReport: async () => {
						syncCalled = true;
						return { ok: true } as never;
					},
				}),
			);
			// A package not present in this test's resolution scope routes to the npm
			// installer (ADR-086 Fase 7b) and fails loud — NOT the old not-wired, and
			// NOT a silent registry fetch.
			const env = await action(group, "install").run({
				args: { ref: "@scope/pkg-not-installed-anywhere" },
				options: {},
				json: true,
			});
			expect(env.ok).toBe(false);
			expect((env as { error?: string }).error).toBe("npm_package_not_resolved");
			// it did NOT fall back to a bundled sync.
			expect(syncCalled).toBe(false);
		});

		it("routes a git ref to the git installer (wired; a bad remote fails at clone)", async () => {
			const group = createPluginCapabilityGroup(makeDeps());
			// A non-resolvable host (.invalid, RFC 6761) — the clone fails fast (DNS),
			// proving git routes to the git installer (ADR-086 Fase 7c), NOT the old
			// not-wired path.
			const env = await action(group, "install").run({
				args: { ref: "git+https://nonexistent.invalid/x.git" },
				options: {},
				json: true,
			});
			expect(env.ok).toBe(false);
			expect((env as { error?: string }).error).toBe("git_clone_failed");
		});

		it("refuses --subdir for a non-git origin", async () => {
			const group = createPluginCapabilityGroup(makeDeps());
			const env = await action(group, "install").run({
				args: { ref: "@scope/pkg" },
				options: { subdir: "packages/plugin" },
				json: true,
			});
			expect(env.ok).toBe(false);
			expect((env as { error?: string }).error).toBe("install-subdir-origin");
		});

		it("rejects --bundled together with a positional ref (ambiguous)", async () => {
			const group = createPluginCapabilityGroup(makeDeps());
			const env = await action(group, "install").run({
				args: { ref: "./somewhere" },
				options: { bundled: true },
				json: true,
			});
			expect(env.ok).toBe(false);
			expect((env as { error?: string }).error).toBe("install-ambiguous");
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

	describe("approve <id> — the persona write step", () => {
		const approveInput = (
			id: string,
			options: Record<string, string | string[] | boolean> = {},
		) => ({ args: { id }, options, json: true });

		it("approves a subset of the declared permissions, rendered with label/risk", async () => {
			let persisted: string[] | undefined;
			const group = createPluginCapabilityGroup(
				makeDeps({
					readManifest: async () => ({
						permissions: ["fs:read", "fs:write", "network:outbound"],
					}),
					persistApproval: (filePath, pluginId, capabilities) => {
						persisted = capabilities;
						return {
							pluginId,
							filePath,
							approved: [...capabilities].sort(),
							changed: true,
						};
					},
				}),
			);
			const env = await action(group, "approve").run(
				approveInput("@x/p", { approve: ["fs:read", "network:outbound"] }),
			);
			expect(env.ok).toBe(true);
			expect(env.operation).toBe("approve");
			expect(persisted).toEqual(["fs:read", "network:outbound"]);
			const x = env as unknown as {
				approved: Array<{ id: string; label: string; risk: string }>;
			};
			expect(x.approved.map((p) => p.id)).toEqual([
				"fs:read",
				"network:outbound",
			]);
			expect(x.approved.find((p) => p.id === "fs:read")?.risk).toBe("low");
		});

		it("rejects approving a capability the plugin never declared", async () => {
			const group = createPluginCapabilityGroup(
				makeDeps({
					readManifest: async () => ({ permissions: ["fs:read"] }),
				}),
			);
			const env = await action(group, "approve").run(
				approveInput("@x/p", { approve: ["shell:spawn"] }),
			);
			expect(env.ok).toBe(false);
			expect((env as { error?: string }).error).toBe("capability-not-declared");
		});

		it("--deny revokes: persists an empty approved set", async () => {
			let persisted: string[] | undefined;
			const group = createPluginCapabilityGroup(
				makeDeps({
					readManifest: async () => ({ permissions: ["fs:read"] }),
					persistApproval: (filePath, pluginId, capabilities) => {
						persisted = capabilities;
						return { pluginId, filePath, approved: [], changed: true };
					},
				}),
			);
			const env = await action(group, "approve").run(
				approveInput("@x/p", { deny: true }),
			);
			expect(env.ok).toBe(true);
			expect(persisted).toEqual([]);
		});

		it("rejects an unknown scope", async () => {
			const group = createPluginCapabilityGroup(makeDeps());
			const env = await action(group, "approve").run(
				approveInput("@x/p", { scope: "galaxy" }),
			);
			expect(env.ok).toBe(false);
			expect((env as { error?: string }).error).toBe("unknown-scope");
		});

		it("errors when the plugin manifest is missing", async () => {
			const group = createPluginCapabilityGroup(
				makeDeps({
					readManifest: async () => {
						throw new Error("ENOENT");
					},
				}),
			);
			const env = await action(group, "approve").run(
				approveInput("@x/nope", { approve: ["fs:read"] }),
			);
			expect(env.ok).toBe(false);
			expect((env as { error?: string }).error).toBe(
				"plugin-manifest-not-found",
			);
		});
	});

	describe("revoke / unrevoke verbs (G — the persona projection over the primitives)", () => {
		const input = (id: string, options: Record<string, string> = {}) => ({
			args: { id },
			options,
			json: true,
		});

		it("revoke persists a whole-plugin revocation via the injected primitive", async () => {
			let seen: { id: string; cap: string | null } | undefined;
			const group = createPluginCapabilityGroup(
				makeDeps({
					persistRevocation: (filePath, pluginId, capability) => {
						seen = { id: pluginId, cap: capability };
						return { pluginId, filePath, capability, changed: true };
					},
				}),
			);
			const env = await action(group, "revoke").run(input("@x/p"));
			expect(env.ok).toBe(true);
			expect(env.operation).toBe("revoke");
			expect(seen).toEqual({ id: "@x/p", cap: null });
			expect((env as unknown as { changed: boolean }).changed).toBe(true);
		});

		it("revoke --cap targets a single capability", async () => {
			let seen: string | null | undefined;
			const group = createPluginCapabilityGroup(
				makeDeps({
					persistRevocation: (filePath, pluginId, capability) => {
						seen = capability;
						return { pluginId, filePath, capability, changed: true };
					},
				}),
			);
			await action(group, "revoke").run(input("@x/p", { cap: "network:outbound" }));
			expect(seen).toBe("network:outbound");
		});

		it("unrevoke persists an annulment via the injected primitive", async () => {
			let called = false;
			const group = createPluginCapabilityGroup(
				makeDeps({
					persistUnrevocation: (filePath, pluginId, capability) => {
						called = true;
						return { pluginId, filePath, capability, changed: true };
					},
				}),
			);
			const env = await action(group, "unrevoke").run(input("@x/p"));
			expect(env.ok).toBe(true);
			expect(env.operation).toBe("unrevoke");
			expect(called).toBe(true);
		});

		it("both reject an unknown scope", async () => {
			const group = createPluginCapabilityGroup(makeDeps());
			for (const verb of ["revoke", "unrevoke"]) {
				const env = await action(group, verb).run(input("@x/p", { scope: "galaxy" }));
				expect(env.ok).toBe(false);
				expect((env as { error?: string }).error).toBe("unknown-scope");
			}
		});

		it("does NOT require a manifest (you can revoke a plugin whose manifest is gone)", async () => {
			// Unlike approve, revoke targets the id/cap directly — no readManifest call.
			const group = createPluginCapabilityGroup(
				makeDeps({
					readManifest: async () => {
						throw new Error("ENOENT — manifest gone");
					},
				}),
			);
			const env = await action(group, "revoke").run(input("@x/gone"));
			expect(env.ok).toBe(true);
		});
	});
});
