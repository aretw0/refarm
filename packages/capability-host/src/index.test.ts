import { describe, expect, it, vi } from "vitest";

import {
	buildCapabilityHostServeInfo,
	buildJsonErrorEnvelope,
	buildJsonSuccessEnvelope,
	buildManifestPrimaryVerbs,
	createHostCommandResolver,
	createLocalCapabilityDeps,
	createLocalVaultCommandDeps,
	createMemorySubmitEffort,
	createPluginDescriptorDeps,
	createRecordsCapabilityGroup,
	createSourceCapabilityGroup,
	createVaultCapabilityGroup,
	createWasmEnrichmentProvider,
	createWasmSourceProvider,
	DEFAULT_HOST_COMMAND_ENV_KEY,
	defaultRecordsDeps,
	defaultSourceDeps,
	defaultVaultDeps,
	defineCapabilityApp,
	defineCapabilityHost,
	definePluginInspectorCapability,
	defineRecordsViewCapability,
	mountedHttpHandler,
	parseDispatchArgs,
	pluginSurfaceName,
	renderWebUi,
	resolveHostCommand,
	serveWebUi,
	surfaceablePluginVerbsFrom,
	type CapabilityHost,
	type CapabilityHostDefinition,
} from "./index.js";

describe("command-resolution helper", () => {
	it("picks explicit command before env fallback and trims values", () => {
		expect(resolveHostCommand({
			command: "  custom-cmd  ",
			defaultCommand: "dgk",
		})).toBe("custom-cmd");
	});

	it("uses commandEnv override map before process env", () => {
		const previous = process.env[DEFAULT_HOST_COMMAND_ENV_KEY];
		process.env[DEFAULT_HOST_COMMAND_ENV_KEY] = "process-env-command";
		expect(resolveHostCommand({
			commandEnv: { [DEFAULT_HOST_COMMAND_ENV_KEY]: "explicit-env-command" },
			defaultCommand: "dgk",
		})).toBe("explicit-env-command");
		if (previous === undefined) {
			delete process.env[DEFAULT_HOST_COMMAND_ENV_KEY];
		} else {
			process.env[DEFAULT_HOST_COMMAND_ENV_KEY] = previous;
		}
	});

	it("builds a resolver closure with stable defaults", () => {
		const resolveCommand = createHostCommandResolver({
			defaultCommand: "fallback-command",
		});
		expect(resolveCommand({ command: "inline-command" })).toBe("inline-command");
		expect(resolveCommand({ commandEnv: { [DEFAULT_HOST_COMMAND_ENV_KEY]: "env-command" } })).toBe(
			"env-command",
		);
		expect(resolveCommand({})).toBe("fallback-command");
	});

	it("supports custom environment keys in resolver defaults", () => {
		const resolveCommand = createHostCommandResolver({
			defaultCommand: "fallback-command",
			commandEnvKey: "CUSTOM_COMMAND",
		});
		expect(resolveCommand({
			commandEnv: {
				CUSTOM_COMMAND: "custom-key-command",
			},
		})).toBe("custom-key-command");
	});

	it("falls back to default when empty command and env are blank", () => {
		expect(
			resolveHostCommand({
				command: "   ",
				defaultCommand: "dgk",
				env: { [DEFAULT_HOST_COMMAND_ENV_KEY]: "   " },
			}),
		).toBe("dgk");
	});

	it("keeps legacy env fallback for backward compatibility", () => {
		expect(resolveHostCommand({
			env: { [DEFAULT_HOST_COMMAND_ENV_KEY]: "legacy-env-command" },
			defaultCommand: "dgk",
		})).toBe("legacy-env-command");
	});
});

describe("manifest-primary verb helper", () => {
	it("builds a unique set of primary verbs from multiple manifests", () => {
		const primaryVerbs = buildManifestPrimaryVerbs({
			manifests: [
				{
					id: "@app/agent",
					capabilities: {
						provides: ["agent:code", "agent:review"],
						subscribes: ["agent:dispatch"],
					},
				},
				{
					id: "@app/agent-v2",
					capabilities: {
						provides: ["agent:code", "notes:search"],
						subscribes: ["agent:dispatch", "notes:dispatch"],
					},
				},
			],
		});

		expect(primaryVerbs.map((verb) => verb.intent)).toEqual([
			"agent:code",
			"agent:review",
			"notes:search",
		]);
		expect(primaryVerbs.map((verb) => verb.name)).toEqual([
			"agent-code",
			"agent-review",
			"notes-search",
		]);
	});

	it("supports opting out of auto subject derivation", () => {
		const primaryVerbs = buildManifestPrimaryVerbs({
			manifests: [
				{
					id: "@app/agent",
					capabilities: {
						provides: ["agent:code"],
						subscribes: ["agent:dispatch"],
					},
				},
			],
			includeSubject: false,
		});
		expect(primaryVerbs).toHaveLength(1);
		expect(primaryVerbs[0]).toMatchObject({
			name: "agent-code",
			subject: undefined,
			actionId: "run-agent-code",
			intent: "agent:code",
		});
	});
});

describe("@refarm.dev/capability-host public API", () => {
	it("exposes the white-label host boundary without importing capabilities-v1 host symbols", async () => {
		const definition = {
			id: "examples/public-api",
			command: "dgk",
			description: "Digital Gardening Kit",
			capabilities: {
				deps: {
					source: defaultSourceDeps(),
					vault: createLocalVaultCommandDeps(),
				},
				extensions: [
					{
						name: "open",
						summary: "Open the workbench",
						transports: { cli: {}, http: { method: "GET", path: "/open" } },
						renderers: { tui: { section: "workbench" } },
						run: () =>
							buildJsonSuccessEnvelope({
								command: "open",
								operation: "render",
								extra: { opened: true },
							}),
					},
				],
			},
			operatorStatus: {
				capabilityUnit: {
					subject: "Workbench",
					action: {
						id: "open-workbench",
						label: "dgk open --json",
						command: "dgk open --json",
						primary: true,
					},
				},
			},
			serve: false,
		} satisfies CapabilityHostDefinition;

		const host: CapabilityHost = defineCapabilityHost(definition);
		expect(host.program().name()).toBe("dgk");
		expect(host.registry().get("open")).toBeDefined();
		expect(host.surfaceActions().map((action) => action.id)).toEqual([
			"open-workbench",
		]);
		expect(host.baseModel().nextCommands).toEqual(["dgk open --json"]);
	});

	it("builds app helpers around a white-label host declaration", async () => {
		const parseAsync = vi.fn(async () => undefined);
		const createHost = vi.fn((options: { statePath?: string } = {}) => ({
			registry: () => ({ statePath: options.statePath }),
			baseModel: () => ({ nextCommands: [options.statePath ?? "memory"] }),
			surfaceActions: () => [],
			surfaceActionRows: () => [],
			surfaceContext: () => ({
				hostId: "examples/public-api",
				data: { command: "dgk", description: "Digital Gardening Kit" },
				actions: [],
			}),
			program: () => ({ parseAsync }),
			serve: () => {
				throw new Error("not used");
			},
		}) as unknown as CapabilityHost);
		const app = defineCapabilityApp({
			host: createHost,
			programOptions: (options: { statePath?: string } = {}) => ({
				...options,
				statePath: options.statePath ?? "/tmp/dgk-state.json",
			}),
		});

		expect(app.registry()).toEqual({ statePath: undefined });
		expect(app.baseModel({ statePath: "/tmp/explicit.json" })).toEqual({
			nextCommands: ["/tmp/explicit.json"],
		});
		expect(app.program()).toEqual({ parseAsync });
		expect(createHost).toHaveBeenLastCalledWith({ statePath: "/tmp/dgk-state.json" });

		const argv = ["node", "/repo/examples/wallet-t2/dist/cli.js"];
		await expect(app.runCli("file:///repo/examples/wallet-t2/dist/cli.js", {
			argv,
			compiledFileName: "cli.js",
		})).resolves.toBe(true);
		expect(parseAsync).toHaveBeenCalledWith(argv);
	});

	it("applies app default options to every helper surface", () => {
		const createHost = vi.fn((options: { statePath?: string } = {}) => ({
			registry: () => ({ statePath: options.statePath }),
			baseModel: () => ({ nextCommands: [options.statePath ?? "memory"] }),
			surfaceActions: () => [{ id: options.statePath ?? "memory" }],
			surfaceActionRows: () => [],
			surfaceContext: () => ({
				hostId: "examples/public-api",
				data: { command: "dgk", description: "Digital Gardening Kit" },
				actions: [{ id: options.statePath ?? "memory" }],
			}),
			program: () => ({ parseAsync: vi.fn(async () => undefined) }),
			serve: () => {
				throw new Error("not used");
			},
		}) as unknown as CapabilityHost);
		const app = defineCapabilityApp({
			host: createHost,
			defaultOptions: () => ({ statePath: "/tmp/dgk-state.json" }),
		});

		expect(app.registry()).toEqual({ statePath: "/tmp/dgk-state.json" });
		expect(app.baseModel()).toEqual({ nextCommands: ["/tmp/dgk-state.json"] });
		expect(app.surfaceActions()).toEqual([{ id: "/tmp/dgk-state.json" }]);
		expect(app.surfaceContext().actions).toEqual([
			{ id: "/tmp/dgk-state.json" },
		]);
		expect(app.registry({ statePath: "/tmp/explicit.json" })).toEqual({
			statePath: "/tmp/explicit.json",
		});
	});

	it("serves through the app helper with app defaults and call options", async () => {
		const serve = vi.fn((options: { port?: number } = {}) => ({
			listening: Promise.resolve({
				port: options.port,
				statePath: createHost.mock.calls.at(-1)?.[0]?.statePath,
			}),
			close: vi.fn(async () => undefined),
		}));
		const createHost = vi.fn((options: { statePath?: string } = {}) => ({
			registry: () => ({ statePath: options.statePath }),
			baseModel: () => ({ nextCommands: [options.statePath ?? "memory"] }),
			surfaceActions: () => [],
			surfaceActionRows: () => [],
			surfaceContext: () => ({
				hostId: "examples/public-api",
				data: { command: "dgk", description: "Digital Gardening Kit" },
				actions: [],
			}),
			program: () => ({ parseAsync: vi.fn(async () => undefined) }),
			serve,
		}) as unknown as CapabilityHost);
		const app = defineCapabilityApp({
			host: createHost,
			defaultOptions: () => ({ statePath: "/tmp/dgk-state.json" }),
		});

		const server = app.serve({ port: 0 });
		expect(serve).toHaveBeenCalledWith({ port: 0 });
		await expect(server.listening).resolves.toEqual({
			port: 0,
			statePath: "/tmp/dgk-state.json",
		});

		app.serve({ port: 4321, appOptions: { statePath: "/tmp/explicit.json" } });
		expect(createHost).toHaveBeenLastCalledWith({
			statePath: "/tmp/explicit.json",
		});
	});

	it("re-exports serve info helpers from the white-label host boundary", () => {
		expect(buildCapabilityHostServeInfo(4322, {
			openApiPath: "/docs/openapi.json",
		})).toMatchObject({
			ok: true,
			url: "http://127.0.0.1:4322",
			openApiUrl: "http://127.0.0.1:4322/docs/openapi.json",
		});
	});

	it("re-exports plugin descriptor deps helpers from the host boundary", () => {
		const deps = createPluginDescriptorDeps({
			submitEffort: async (effort) => effort.id,
			newId: () => "id-1",
			nowIso: () => "2026-01-01T00:00:00Z",
		});

		expect(deps.newId()).toBe("id-1");
		expect(deps.nowIso()).toBe("2026-01-01T00:00:00Z");
	});

	it("creates a memory submit sink for tests and harnesses", async () => {
		const submit = createMemorySubmitEffort();
		await expect(submit({
			id: "effort-1",
			direction: "dispatch",
			source: "test",
			submittedAt: "2026-01-01T00:00:00Z",
			tasks: [{ id: "task-1", pluginId: "@example/plugin", fn: "search", args: {} }],
		})).resolves.toBe("effort-1");

		expect(submit.submitted).toHaveLength(1);
		expect(submit.submitted[0]?.tasks[0]?.fn).toBe("search");
	});

	it("re-exports JSON envelopes and local deps used by host extensions", () => {
		expect(buildJsonSuccessEnvelope({
			command: "extension",
			operation: "run",
		})).toMatchObject({ ok: true, command: "extension" });
		expect(buildJsonErrorEnvelope({
			command: "extension",
			operation: "run",
			error: "failed",
			message: "failed",
			nextAction: "Retry the extension.",
		})).toMatchObject({ ok: false, error: "failed" });
		expect(createLocalVaultCommandDeps()).toHaveProperty("discover");
	});

	it("re-exports WASM provider adapters from the host boundary", async () => {
		const sourceCalls: Array<{ verb: string; payload: string }> = [];
		const source = createWasmSourceProvider({
			pluginId: "source-provider-ref",
			callRespond: async (verb, payload) => {
				sourceCalls.push({ verb, payload });
				return JSON.stringify({ entries: [{ ref: "demo", kind: "local" }] });
			},
		});
		await expect(source.discover()).resolves.toEqual({
			entries: [{ ref: "demo", kind: "local" }],
		});
		expect(sourceCalls[0]?.verb).toBe("source:discover");

		const enrichment = createWasmEnrichmentProvider({
			pluginId: "enrich-ref",
			callRespond: async () =>
				JSON.stringify({ records: [], summary: { total: 0, changed: 0, skipped: 0 } }),
		});
		await expect(enrichment.enrich([], { mode: "dry-run" })).resolves.toMatchObject({
			records: [],
		});
	});

	it("re-exports extension helpers needed by example personas", () => {
		expect(createLocalCapabilityDeps()).toHaveProperty("records");
		expect(defineRecordsViewCapability({
			name: "view",
			summary: "View records",
			records: defaultRecordsDeps(),
			project: () => ({ seen: true }),
		}).name).toBe("view");
		expect(definePluginInspectorCapability({
			name: "extension",
			summary: "Inspect extension",
			manifest: { id: "@example/ext" },
			deps: createPluginDescriptorDeps({
				submitEffort: async (effort) => effort.id,
				newId: () => "id-1",
				nowIso: () => "2026-01-01T00:00:00Z",
			}),
		}).name).toBe("extension");
	});

	it("re-exports built-in capability groups for host composition", () => {
		expect(createRecordsCapabilityGroup().name).toBe("records");
		expect(createSourceCapabilityGroup(defaultSourceDeps()).name).toBe("source");
		expect(createVaultCapabilityGroup(defaultVaultDeps({
			discover: () => ({ providers: [], rejected: [] }),
			submitEffort: async (effort) => effort.id,
		})).name).toBe("vault");
		expect(defaultRecordsDeps()).toHaveProperty("loadManifest");
	});

	it("re-exports web surface helpers from the host boundary", () => {
		expect(typeof renderWebUi).toBe("function");
		expect(typeof serveWebUi).toBe("function");
	});

	it("re-exports plugin bridge helpers from the host boundary", () => {
		expect(pluginSurfaceName("vault", "search")).toBe("vault-search");
		expect(surfaceablePluginVerbsFrom({
			id: "@example/vault",
			capabilities: {
				provides: ["vault:search"],
				subscribes: ["vault:dispatch"],
			},
		})).toMatchObject([
			{
				pluginId: "@example/vault",
				pluginKey: "vault",
				verb: "search",
				target: "vault:search",
				dispatchEvent: "vault:dispatch",
				surfaceName: "vault-search",
			},
		]);
		expect(parseDispatchArgs(["limit=5", "query=soil"])).toEqual({
			args: { limit: 5, query: "soil" },
		});
		expect(typeof mountedHttpHandler).toBe("function");
	});
});
