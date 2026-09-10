import type { ModelAccountDescriptor } from "@refarm.dev/model-account-contract-v1";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toCommanderGroup } from "../../src/commands/capability-commander.js";
import {
	createModelCapabilityGroup,
	modelCapabilityHooks,
} from "../../src/commands/model-capability.js";
import {
	buildCurrentModelStatus,
	buildModelDoctorEnvelope,
	buildModelDoctorStatus,
	credentialLifetime,
	formatCredentialLifetime,
	formatModelDoctorFromStatus,
	resolveRuntimeModelRoute,
	type ModelCommandDeps,
	type ModelTokens,
} from "../../src/commands/model.js";

/**
 * The `model` CLI surface is now projected from the CapabilityGroup. This helper
 * builds the same commander `Command` the deleted `createModelCommand(deps)`
 * returned — identical `.parseAsync(args, { from: "user" })` interface, same
 * sub-commands and flags — so the coverage below exercises the live surface.
 */
function createModelCommand(deps: ModelCommandDeps) {
	return toCommanderGroup(createModelCapabilityGroup(deps), modelCapabilityHooks);
}

function makeDeps(tokens: Record<string, unknown> = {}): ModelCommandDeps & {
	saveTokens: ReturnType<typeof vi.fn>;
} {
	return {
		loadTokens: vi.fn().mockResolvedValue(tokens),
		saveTokens: vi.fn().mockResolvedValue({}),
		isContainer: vi.fn().mockReturnValue(false),
	};
}

const MODEL_CURRENT_JSON_HANDOFF = {
	ok: true,
	command: "model",
	operation: "mutate",
	nextAction: null,
	nextActions: [],
	nextCommand: "refarm model current --json",
	nextCommands: ["refarm model current --json"],
};

describe("modelCommand", () => {
	const originalProvider = process.env.MODEL_PROVIDER;
	const originalDefaultProvider = process.env.MODEL_DEFAULT_PROVIDER;
	const originalModelId = process.env.MODEL_ID;
	const originalModelBaseUrl = process.env.MODEL_BASE_URL;
	const originalFallbackProvider = process.env.MODEL_FALLBACK_PROVIDER;
	const originalFallbackModelId = process.env.MODEL_FALLBACK_MODEL_ID;
	const originalOpenAiKey = process.env.OPENAI_API_KEY;

	beforeEach(() => {
		vi.clearAllMocks();
		process.exitCode = undefined;
	});

	afterEach(() => {
		if (originalProvider === undefined) {
			delete process.env.MODEL_PROVIDER;
		} else {
			process.env.MODEL_PROVIDER = originalProvider;
		}
		if (originalDefaultProvider === undefined) {
			delete process.env.MODEL_DEFAULT_PROVIDER;
		} else {
			process.env.MODEL_DEFAULT_PROVIDER = originalDefaultProvider;
		}
		if (originalModelId === undefined) {
			delete process.env.MODEL_ID;
		} else {
			process.env.MODEL_ID = originalModelId;
		}
		if (originalModelBaseUrl === undefined) {
			delete process.env.MODEL_BASE_URL;
		} else {
			process.env.MODEL_BASE_URL = originalModelBaseUrl;
		}
		if (originalFallbackProvider === undefined) {
			delete process.env.MODEL_FALLBACK_PROVIDER;
		} else {
			process.env.MODEL_FALLBACK_PROVIDER = originalFallbackProvider;
		}
		if (originalFallbackModelId === undefined) {
			delete process.env.MODEL_FALLBACK_MODEL_ID;
		} else {
			process.env.MODEL_FALLBACK_MODEL_ID = originalFallbackModelId;
		}
		if (originalOpenAiKey === undefined) {
			delete process.env.OPENAI_API_KEY;
		} else {
			process.env.OPENAI_API_KEY = originalOpenAiKey;
		}
		vi.restoreAllMocks();
		process.exitCode = undefined;
	});

	it("prints the current default and OpenAI worker route", async () => {
		const deps = makeDeps({ modelProvider: "openai", modelId: "gpt-5.5" });
		const command = createModelCommand(deps);
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await command.parseAsync(["current"], { from: "user" });

		const output = logSpy.mock.calls.map((call) => String(call[0])).join("\n");
		expect(output).toContain("openai/gpt-5.5");
		expect(output).toContain("key env:  OPENAI_API_KEY");
		expect(output).toContain("key:      missing (run refarm sow)");
		expect(output).toContain("context:  node");
		expect(output).toContain("binding:  detached (explicit)");
		expect(output).toContain("state:    node-owned");
		expect(output).toContain("creds:    node");
		expect(output).toContain("runtime:  node");
		expect(output).toContain("home:     ");
		expect(output).toContain("store:    ");
		expect(output).toContain("openai/gpt-5.3-codex-spark");
		expect(output).toContain("monitor:  openai/gpt-5.6-sol");

		logSpy.mockRestore();
	});

	it("prints Silo API key status for the current provider", async () => {
		const deps = makeDeps({
			modelProvider: "openai",
			modelId: "gpt-5.5",
			modelApiKey: "sk-test",
		});
		const command = createModelCommand(deps);
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await command.parseAsync(["current"], { from: "user" });

		const output = logSpy.mock.calls.map((call) => String(call[0])).join("\n");
		expect(output).toContain("key:      Silo API key");

		logSpy.mockRestore();
	});

	it("prints environment credential status for the current provider", async () => {
		process.env.OPENAI_API_KEY = "sk-env-test";
		const deps = makeDeps({ modelProvider: "openai", modelId: "gpt-5.5" });
		const command = createModelCommand(deps);
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await command.parseAsync(["current"], { from: "user" });

		const output = logSpy.mock.calls.map((call) => String(call[0])).join("\n");
		expect(output).toContain("key:      OPENAI_API_KEY env");

		logSpy.mockRestore();
	});

	it("prints shell runtime env from Silo API key", async () => {
		const deps = makeDeps({
			modelProvider: "openai",
			modelId: "gpt-5.5",
			modelApiKey: "sk-silo-test",
		});
		const command = createModelCommand(deps);
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await command.parseAsync(["env", "--shell"], { from: "user" });

		const output = logSpy.mock.calls.map((call) => String(call[0])).join("\n");
		expect(output).toContain("export MODEL_PROVIDER='openai'");
		expect(output).toContain("export MODEL_ID='gpt-5.5'");
		expect(output).toContain("export OPENAI_API_KEY='sk-silo-test'");
		// ADR-012: the non-secret configured-providers list is advertised (names only).
		expect(output).toContain("export MODEL_CONFIGURED_PROVIDERS='openai,ollama'");
		expect(output).toContain(
			"export REFARM_MANAGED_MODEL_ENV_KEYS='MODEL_PROVIDER,MODEL_ID,OPENAI_API_KEY,MODEL_CONFIGURED_PROVIDERS'",
		);

		logSpy.mockRestore();
	});

	it("does not export subscription OAuth credentials as runtime API keys", async () => {
		const deps = makeDeps({
			modelProvider: "openai-codex",
			modelId: "gpt-5.5",
			oauthProvider: "openai-codex",
			oauthCredentials: {
				"openai-codex": {
					access: "oauth-access-test",
					accountId: "account-test",
				},
			},
		});
		const command = createModelCommand(deps);
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await command.parseAsync(["env", "--shell"], { from: "user" });

		const output = logSpy.mock.calls.map((call) => String(call[0])).join("\n");
		expect(output).toContain("export MODEL_PROVIDER='openai-codex'");
		expect(output).toContain("export MODEL_ID='gpt-5.5'");
		expect(output).toContain(
			"export REFARM_MANAGED_MODEL_ENV_KEYS='MODEL_PROVIDER,MODEL_ID,MODEL_CONFIGURED_PROVIDERS'",
		);
		// The configured-providers list carries provider NAMES, never the OAuth secret.
		expect(output).toContain("export MODEL_CONFIGURED_PROVIDERS='openai-codex,ollama'");
		expect(output).not.toContain("OPENAI_API_KEY");
		expect(output).not.toContain("OPENAI_CODEX_ACCESS_TOKEN");
		expect(output).not.toContain("oauth-access-test");
		expect(output).not.toContain("account-test");

		logSpy.mockRestore();
	});

	it("exports subscription OAuth credentials for local runtime launch scripts", async () => {
		const deps = makeDeps({
			modelProvider: "openai-codex",
			modelId: "gpt-5.5",
			oauthProvider: "openai-codex",
			oauthCredentials: {
				"openai-codex": {
					access: "oauth-access-test",
					accountId: "account-test",
				},
			},
		});

		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		await createModelCommand(deps).parseAsync(
			["env", "--shell", "--include-secrets"],
			{ from: "user" },
		);
		const output = logSpy.mock.calls.map((call) => String(call[0])).join("\n");
		logSpy.mockRestore();

		expect(output).toContain("export MODEL_PROVIDER='openai-codex'");
		expect(output).toContain("export MODEL_ID='gpt-5.5'");
		expect(output).toContain(
			"export OPENAI_CODEX_ACCESS_TOKEN='oauth-access-test'",
		);
		expect(output).toContain("export OPENAI_CODEX_ACCOUNT_ID='account-test'");
		expect(output).toContain(
			"export REFARM_MANAGED_MODEL_ENV_KEYS='MODEL_PROVIDER,MODEL_ID,MODEL_CONFIGURED_PROVIDERS,OPENAI_CODEX_ACCESS_TOKEN,OPENAI_CODEX_ACCOUNT_ID'",
		);
		expect(output).not.toContain("OPENAI_API_KEY");
	});

	it("does not print model runtime secrets without --shell", async () => {
		const deps = makeDeps({
			modelProvider: "openai",
			modelApiKey: "sk-silo-test",
		});
		const command = createModelCommand(deps);
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await command.parseAsync(["env"], { from: "user" });

		const output = logSpy.mock.calls.map((call) => String(call[0])).join("\n");
		expect(output).toContain("Use --shell");
		expect(output).not.toContain("sk-silo-test");

		logSpy.mockRestore();
	});

	it("prints operator recovery for missing scoped route credentials", async () => {
		const deps = makeDeps({
			modelProvider: "ollama",
			modelId: "llama3.2",
			modelRoutes: {
				worker: "openai/gpt-5.3-codex-spark",
			},
		});
		const command = createModelCommand(deps);
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await command.parseAsync(["current"], { from: "user" });

		const output = logSpy.mock.calls.map((call) => String(call[0])).join("\n");
		expect(output).toContain("current: ollama/llama3.2");
		expect(output).toContain("worker:   openai/gpt-5.3-codex-spark");
		expect(output).toContain(
			"warning: The worker model route requires credentials",
		);
		expect(output).toContain(
			"fix:     refarm model set --scope worker 'ollama/llama3.2' --json",
		);

		logSpy.mockRestore();
	});

	it("resolves runtime model route per scope", () => {
		const status = buildCurrentModelStatus({
			modelProvider: "openai",
			modelId: "gpt-5.5",
			modelRoutes: {
				worker: "openai/gpt-5.3-codex-spark",
				monitor: "ollama/llama3.1",
			},
		});

		expect(resolveRuntimeModelRoute(status, "default")).toEqual({
			modelProvider: "openai",
			modelId: "gpt-5.5",
		});
		expect(resolveRuntimeModelRoute(status, "worker")).toEqual({
			modelProvider: "openai",
			modelId: "gpt-5.3-codex-spark",
		});
		expect(resolveRuntimeModelRoute(status, "monitor")).toEqual({
			modelProvider: "ollama",
			modelId: "llama3.1",
		});
	});

	it("prints the keyless ollama floor when a key is present but no provider is chosen", async () => {
		// Having OPENAI_API_KEY in env does NOT auto-select openai: the provider is
		// still the ollama floor until MODEL_PROVIDER is set. The default route is
		// the shared keyless floor; the openai key is only used once openai is chosen.
		process.env.OPENAI_API_KEY = "sk-env-test";
		const command = createModelCommand(makeDeps());
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await command.parseAsync(["current"], { from: "user" });

		const output = logSpy.mock.calls.map((call) => String(call[0])).join("\n");
		expect(output).toContain("current: ollama/llama3.2");
		expect(output).toContain("provider: ollama");
		expect(output).toContain("source:   built-in defaults");

		logSpy.mockRestore();
	});

	it("prints current model when invoked without a subcommand", async () => {
		const deps = makeDeps({ modelProvider: "openai", modelId: "gpt-5.5" });
		const command = createModelCommand(deps);
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await command.parseAsync([], { from: "user" });

		const output = logSpy.mock.calls.map((call) => String(call[0])).join("\n");
		expect(output).toContain("openai/gpt-5.5");

		logSpy.mockRestore();
	});

	it("prints current model as JSON", async () => {
		const deps = makeDeps({ modelProvider: "openai", modelId: "gpt-5.5" });
		const command = createModelCommand(deps);
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await command.parseAsync(["current", "--json"], { from: "user" });

		const payload = JSON.parse(String(logSpy.mock.calls[0]?.[0])) as {
			command: string;
			operation: string;
			current: { ref: string };
			context: {
				mode: string;
				binding: { kind: string; origin: string };
				state: { policy: string; homeRef: string };
				credentials: { policy: string; storeRef: string };
				runtime: { policy: string };
				sovereignHome: string;
				credentialStoreHome: string;
				homesAligned: boolean;
			};
			routes: { default: string; worker: string; monitor: string };
			routeCredentials: {
				default: { state: string };
				worker: { state: string };
				monitor: { state: string };
			};
			source: { kind: string; envOverrides: string[] };
			credential: { envKey: string; state: string; status: string };
			handoffs: {
				interactive: string;
				inspectProviders: string;
				localNoKeyModel: string;
				openExternalLinks: string;
				setModel: string;
				setWorkerModel: string;
				setMonitorModel: string;
			};
			nextCommand: string;
			nextCommands: string[];
			recommendations: {
				diagnostic: string;
				severity: string;
				command: string;
			}[];
		};
		expect(payload.command).toBe("model");
		expect(payload.operation).toBe("current");
		expect(payload.current.ref).toBe("openai/gpt-5.5");
		expect(payload.context.mode).toBe("node");
		expect(payload.context.binding.kind).toBe("detached");
		expect(payload.context.state.policy).toBe("node-owned");
		expect(payload.context.credentials.policy).toBe("node");
		expect(payload.context.runtime.policy).toBe("node");
		expect(payload.context.sovereignHome.length).toBeGreaterThan(0);
		expect(payload.context.credentialStoreHome.length).toBeGreaterThan(0);
		expect(typeof payload.context.homesAligned).toBe("boolean");
		expect(payload.routes.default).toBe("openai/gpt-5.5");
		expect(payload.routes.worker).toBe("openai/gpt-5.3-codex-spark");
		expect(payload.routes.monitor).toBe("openai/gpt-5.6-sol");
		expect(payload.credential.envKey).toBe("OPENAI_API_KEY");
		expect(payload.credential.state).toBe("missing");
		expect(payload.credential.status).toBe("missing (run refarm sow)");
		expect(payload.routeCredentials.default.state).toBe("missing");
		expect(payload.routeCredentials.worker.state).toBe("missing");
		expect(payload.source.kind).toBe("identity");
		expect(payload.nextCommand).toBe("refarm sow --json");
		expect(payload.nextCommands).toContain("refarm model providers --json");
		expect(payload.nextCommands).toContain(
			"refarm sow --model 'openai/gpt-5.5' --json",
		);
		expect(payload.recommendations).toEqual([
			expect.objectContaining({
				diagnostic: "model-credentials-missing",
				severity: "failure",
				command: "refarm sow --json",
			}),
		]);
		expect(payload.handoffs).toEqual({
			interactive: "refarm sow",
			inspectProviders: "refarm model providers --json",
			localNoKeyModel: "refarm sow --model ollama/llama3.2 --json",
			openExternalLinks: "refarm config get operator.openExternalLinks --json",
			setModel: "refarm model 'openai/gpt-5.5' --json",
			setWorkerModel:
				"refarm model set --scope worker 'openai/gpt-5.3-codex-spark' --json",
			setMonitorModel:
				"refarm model set --scope monitor 'openai/gpt-5.6-sol' --json",
		});

		logSpy.mockRestore();
	});

	it("probes the configured Ollama endpoint in model doctor JSON", async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValue(new Response("{}", { status: 200 }));
		const deps = makeDeps({
			modelProvider: "ollama",
			modelId: "llama3.2",
			modelBaseUrl: "http://127.0.0.1:11434/",
		});
		deps.fetch = fetchMock as unknown as typeof fetch;
		const command = createModelCommand(deps);
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await command.parseAsync(["doctor", "--json"], { from: "user" });

		const payload = JSON.parse(String(logSpy.mock.calls[0]?.[0])) as {
			command: string;
			operation: string;
			providerProbe: { ready: boolean; reason: string; status: number; url: string };
			nextCommands: string[];
		};
		expect(payload.command).toBe("model");
		expect(payload.operation).toBe("doctor");
		expect(payload.providerProbe).toMatchObject({
			ready: true,
			reason: "reachable",
			status: 200,
			url: "http://127.0.0.1:11434/api/tags",
		});
		expect(payload.nextCommands).toEqual([]);
		expect(fetchMock).toHaveBeenCalledWith(
			"http://127.0.0.1:11434/api/tags",
			expect.objectContaining({ method: "GET" }),
		);

		logSpy.mockRestore();
	});

	it("reports Ollama reachability failures as model doctor handoffs", async () => {
		const fetchMock = vi
			.fn()
			.mockRejectedValue(
				new Error("fetch failed", { cause: { code: "ECONNREFUSED" } }),
			);
		const deps = makeDeps({ modelProvider: "ollama", modelId: "llama3.2" });
		deps.fetch = fetchMock as unknown as typeof fetch;
		const command = createModelCommand(deps);
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await command.parseAsync(["doctor", "--json"], { from: "user" });

		const payload = JSON.parse(String(logSpy.mock.calls[0]?.[0])) as {
			providerProbe: { ready: boolean; reason: string; error: string };
			probeEnvironment: {
				container: boolean;
				localhostTargetsRuntime: boolean;
			};
			nextCommand: string;
			nextCommands: string[];
			recommendations: { diagnostic: string; command: string }[];
			handoffs: {
				startOllama: string;
				setDockerOllamaBaseUrl: string;
			};
		};
		expect(payload.providerProbe.ready).toBe(false);
		expect(payload.providerProbe.reason).toBe("unreachable");
		expect(payload.providerProbe.error).toContain("ECONNREFUSED");
		expect(payload.probeEnvironment).toMatchObject({
			container: false,
			localhostTargetsRuntime: true,
		});
		expect(payload.nextCommand).toBe("ollama serve");
		expect(payload.nextCommands).toContain("ollama serve");
		expect(payload.nextCommands).toContain("refarm model current --json");
		expect(payload.handoffs).toMatchObject({
			startOllama: "ollama serve",
			setDockerOllamaBaseUrl:
				"refarm model base-url http://host.docker.internal:11434 --json",
		});
		expect(payload.recommendations).toEqual([
			expect.objectContaining({
				diagnostic: "model-provider-unreachable",
				command: "refarm model doctor --json",
			}),
		]);

		logSpy.mockRestore();
	});

	it("prioritizes Docker host base-url recovery for container-local Ollama probes", async () => {
		const fetchMock = vi
			.fn()
			.mockRejectedValue(
				new Error("fetch failed", { cause: { code: "ECONNREFUSED" } }),
			);
		const deps = makeDeps({ modelProvider: "ollama", modelId: "llama3.2" });
		deps.fetch = fetchMock as unknown as typeof fetch;
		deps.isContainer = vi.fn().mockReturnValue(true);
		const command = createModelCommand(deps);
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await command.parseAsync(["doctor", "--json"], { from: "user" });

		const payload = JSON.parse(String(logSpy.mock.calls[0]?.[0])) as {
			probeEnvironment: {
				container: boolean;
				localhostTargetsRuntime: boolean;
				dockerHostBaseUrl: string;
			};
			nextCommand: string;
			nextCommands: string[];
		};
		expect(payload.probeEnvironment).toEqual({
			container: true,
			localhostTargetsRuntime: true,
			dockerHostBaseUrl: "http://host.docker.internal:11434",
		});
		expect(payload.nextCommand).toBe(
			"refarm model base-url http://host.docker.internal:11434 --json",
		);
		expect(payload.nextCommands).toEqual([
			"refarm model base-url http://host.docker.internal:11434 --json",
			"ollama serve",
			"refarm model current --json",
		]);

		logSpy.mockRestore();
	});

	it("does not ping a keyed provider whose credential is missing (credential-missing, not 'down')", async () => {
		const fetchMock = vi.fn();
		const previousKey = process.env.OPENAI_API_KEY;
		delete process.env.OPENAI_API_KEY;
		try {
			const status = await buildModelDoctorStatus(
				{ modelProvider: "openai", modelId: "gpt-5.5" },
				{ fetch: fetchMock as unknown as typeof fetch, isContainer: () => false },
			);

			// A missing key is NOT a "down" endpoint — warn about the key, don't ping.
			expect(status.providerProbe).toMatchObject({
				provider: "openai",
				ready: null,
				reason: "credential-missing",
				skipped: true,
			});
			expect(fetchMock).not.toHaveBeenCalled();
		} finally {
			if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
			else process.env.OPENAI_API_KEY = previousKey;
		}
	});

	it("keeps no-endpoint-source when the runtime sidecar is unreachable", async () => {
		// keyed provider, key present, no TS base URL → ask the runtime; if the
		// sidecar is down (fetch throws) TS must NOT invent reachability.
		const fetchMock = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
		const previousKey = process.env.OPENAI_API_KEY;
		process.env.OPENAI_API_KEY = "sk-test-key";
		try {
			const status = await buildModelDoctorStatus(
				{ modelProvider: "openai", modelId: "gpt-5.5" },
				{ fetch: fetchMock as unknown as typeof fetch, isContainer: () => false },
			);

			expect(status.providerProbe).toMatchObject({
				provider: "openai",
				ready: null,
				reason: "no-endpoint-source",
				skipped: true,
			});
			// It DID try the runtime (the sidecar owns openai's base URL).
			expect(fetchMock).toHaveBeenCalledOnce();
		} finally {
			if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
			else process.env.OPENAI_API_KEY = previousKey;
		}
	});

	it("adopts the runtime's reachability verdict for a provider whose URL only Rust knows", async () => {
		// The sidecar resolves openai's base URL and reports it reachable; that
		// verdict flows into providerProbe with the same reason vocabulary.
		const fetchMock = vi.fn().mockResolvedValue(
			new Response(
				JSON.stringify({
					provider: "openai",
					baseUrl: "https://api.openai.com",
					reachable: true,
					status: 200,
					reason: "reachable",
				}),
				{ status: 200 },
			),
		);
		const previousKey = process.env.OPENAI_API_KEY;
		process.env.OPENAI_API_KEY = "sk-test-key";
		try {
			const status = await buildModelDoctorStatus(
				{ modelProvider: "openai", modelId: "gpt-5.5" },
				{ fetch: fetchMock as unknown as typeof fetch, isContainer: () => false },
			);

			expect(status.providerProbe).toMatchObject({
				provider: "openai",
				baseUrl: "https://api.openai.com",
				ready: true,
				reason: "reachable",
				status: 200,
			});
			expect(fetchMock).toHaveBeenCalledOnce();
		} finally {
			if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
			else process.env.OPENAI_API_KEY = previousKey;
		}
	});

	it("pings a keyed provider when a MODEL_BASE_URL override gives TS an endpoint", async () => {
		const fetchMock = vi.fn().mockResolvedValue(
			new Response(null, { status: 200 }),
		);
		const previousKey = process.env.OPENAI_API_KEY;
		const previousBaseUrl = process.env.MODEL_BASE_URL;
		process.env.OPENAI_API_KEY = "sk-test-key";
		process.env.MODEL_BASE_URL = "https://proxy.example.test";
		try {
			const status = await buildModelDoctorStatus(
				{ modelProvider: "openai", modelId: "gpt-5.5" },
				{ fetch: fetchMock as unknown as typeof fetch, isContainer: () => false },
			);

			expect(status.providerProbe).toMatchObject({
				provider: "openai",
				ready: true,
				reason: "reachable",
				status: 200,
			});
			expect(fetchMock).toHaveBeenCalledOnce();
		} finally {
			if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
			else process.env.OPENAI_API_KEY = previousKey;
			if (previousBaseUrl === undefined) delete process.env.MODEL_BASE_URL;
			else process.env.MODEL_BASE_URL = previousBaseUrl;
		}
	});

	it("maps a 401 from an overridden endpoint to auth-failed (endpoint up, key rejected)", async () => {
		const fetchMock = vi.fn().mockResolvedValue(
			new Response(null, { status: 401 }),
		);
		const previousKey = process.env.OPENAI_API_KEY;
		const previousBaseUrl = process.env.MODEL_BASE_URL;
		process.env.OPENAI_API_KEY = "sk-test-key";
		process.env.MODEL_BASE_URL = "https://proxy.example.test";
		try {
			const status = await buildModelDoctorStatus(
				{ modelProvider: "openai", modelId: "gpt-5.5" },
				{ fetch: fetchMock as unknown as typeof fetch, isContainer: () => false },
			);

			// 401 proves the endpoint is UP — reachable at the network layer, auth
			// is the issue. A milder, more accurate verdict than "unreachable".
			expect(status.providerProbe).toMatchObject({
				provider: "openai",
				ready: true,
				reason: "auth-failed",
				status: 401,
			});
		} finally {
			if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
			else process.env.OPENAI_API_KEY = previousKey;
			if (previousBaseUrl === undefined) delete process.env.MODEL_BASE_URL;
			else process.env.MODEL_BASE_URL = previousBaseUrl;
		}
	});

	it("reports missing scoped route credentials even when the default route needs no key", () => {
		const status = buildCurrentModelStatus({
			modelProvider: "ollama",
			modelId: "llama3.2",
			modelRoutes: {
				worker: "openai/gpt-5.3-codex-spark",
			},
		});

		expect(status.credential.state).toBe("not-required");
		expect(status.routeCredentials.default.state).toBe("not-required");
		expect(status.routeCredentials.worker).toMatchObject({
			provider: "openai",
			envKey: "OPENAI_API_KEY",
			state: "missing",
			status: "missing (run refarm sow)",
		});
		expect(status.recommendations).toEqual([
			expect.objectContaining({
				diagnostic: "model-worker-credentials-missing",
				command: "refarm model set --scope worker 'ollama/llama3.2' --json",
			}),
		]);
	});

	it("prints scoped credential recovery commands as JSON", async () => {
		const deps = makeDeps({
			modelProvider: "ollama",
			modelId: "llama3.2",
			modelRoutes: {
				worker: "openai/gpt-5.3-codex-spark",
			},
		});
		const command = createModelCommand(deps);
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await command.parseAsync(["current", "--json"], { from: "user" });

		const payload = JSON.parse(String(logSpy.mock.calls[0]?.[0])) as {
			nextCommand: string;
			nextCommands: string[];
			routeCredentials: Record<string, { state: string; envKey?: string }>;
			recommendations: {
				diagnostic: string;
				command: string;
			}[];
		};
		expect(payload.routeCredentials.worker).toMatchObject({
			state: "missing",
			envKey: "OPENAI_API_KEY",
		});
		expect(payload.nextCommand).toBe("refarm sow --json");
		expect(payload.nextCommands).toContain("refarm model providers --json");
		expect(payload.nextCommands).toContain(
			"refarm model set --scope worker 'ollama/llama3.2' --json",
		);
		expect(payload.recommendations).toEqual([
			expect.objectContaining({
				diagnostic: "model-worker-credentials-missing",
				command: "refarm model set --scope worker 'ollama/llama3.2' --json",
			}),
		]);

		logSpy.mockRestore();
	});

	it("prints the keyless ollama floor when no route is configured", async () => {
		// Zero-config resolves the keyless ollama floor across every scope. ollama
		// needs no key (no "missing" nag), and the built-in defaults still surface
		// the openai reference line for when the user opts into openai.
		const deps = makeDeps();
		const command = createModelCommand(deps);
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await command.parseAsync(["current"], { from: "user" });

		const output = logSpy.mock.calls.map((call) => String(call[0])).join("\n");
		expect(output).toContain("current: ollama/llama3.2");
		expect(output).toContain("provider: ollama");
		expect(output).toContain("worker:   ollama/llama3.2");
		expect(output).toContain("monitor:  ollama/llama3.2");
		expect(output).toContain("openai default: openai/gpt-5.6-sol");

		logSpy.mockRestore();
	});

	it("builds route handoffs from effective scoped routes", () => {
		const status = buildCurrentModelStatus({
			modelProvider: "vllm",
			modelId: "Qwen3-Coder-480B-A35B-Instruct",
			modelRoutes: {
				worker: "ollama/llama3.2",
				monitor: "anthropic/claude-sonnet-4.5",
			},
		});

		expect(status.handoffs).toMatchObject({
			setModel: "refarm model 'vllm/Qwen3-Coder-480B-A35B-Instruct' --json",
			setWorkerModel:
				"refarm model set --scope worker 'ollama/llama3.2' --json",
			setMonitorModel:
				"refarm model set --scope monitor 'anthropic/claude-sonnet-4.5' --json",
		});
	});

	it("prints current model from default provider environment", async () => {
		process.env.MODEL_DEFAULT_PROVIDER = "gemini";
		const deps = makeDeps({ modelProvider: "openai", modelId: "gpt-5.5" });
		const command = createModelCommand(deps);
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await command.parseAsync(["current"], { from: "user" });

		const output = logSpy.mock.calls.map((call) => String(call[0])).join("\n");
		expect(output).toContain("gemini/gemini-3-flash-preview");
		expect(output).toContain("key env:  GEMINI_API_KEY");
		expect(output).toContain("source:   environment overrides are active");

		logSpy.mockRestore();
	});

	it("does not pair an environment provider override with a stored model from another provider", async () => {
		process.env.MODEL_PROVIDER = "gemini";
		const deps = makeDeps({ modelProvider: "openai", modelId: "gpt-5.5" });
		const command = createModelCommand(deps);
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await command.parseAsync(["current"], { from: "user" });

		const output = logSpy.mock.calls.map((call) => String(call[0])).join("\n");
		expect(output).toContain("current: gemini/gemini-3-flash-preview");
		expect(output).not.toContain("gemini/gpt-5.5");

		logSpy.mockRestore();
	});

	it("prints base URL and custom provider hint when configured through environment", async () => {
		process.env.MODEL_PROVIDER = "vllm";
		process.env.MODEL_ID = "Qwen3-Coder-480B-A35B-Instruct";
		process.env.MODEL_BASE_URL = "http://127.0.0.1:8000";
		process.env.MODEL_FALLBACK_PROVIDER = "ollama";
		const command = createModelCommand(makeDeps());
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await command.parseAsync(["current"], { from: "user" });

		const output = logSpy.mock.calls.map((call) => String(call[0])).join("\n");
		expect(output).toContain("vllm/Qwen3-Coder-480B-A35B-Instruct");
		expect(output).toContain("base url: http://127.0.0.1:8000");
		expect(output).toContain("fallback: ollama/llama3.2");
		expect(output).toContain(
			"custom provider: set endpoint with refarm model base-url",
		);

		logSpy.mockRestore();
	});

	it("prints persisted base URL", async () => {
		const deps = makeDeps({
			modelProvider: "vllm",
			modelId: "Qwen3-Coder-480B-A35B-Instruct",
			modelBaseUrl: "http://127.0.0.1:8000",
		});
		const command = createModelCommand(deps);
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await command.parseAsync(["current"], { from: "user" });

		const output = logSpy.mock.calls.map((call) => String(call[0])).join("\n");
		expect(output).toContain("base url: http://127.0.0.1:8000");
		expect(output).toContain("source:   ~/.refarm/identity.json");

		logSpy.mockRestore();
	});

	it("keeps persisted base URL when env provider only changes casing", async () => {
		process.env.MODEL_PROVIDER = "OpenAI";
		const deps = makeDeps({
			modelProvider: "openai",
			modelId: "gpt-5.5",
			modelBaseUrl: "https://api.openai.com/v1",
		});
		const command = createModelCommand(deps);
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await command.parseAsync(["current"], { from: "user" });

		const output = logSpy.mock.calls.map((call) => String(call[0])).join("\n");
		expect(output).toContain("base url: https://api.openai.com/v1");

		logSpy.mockRestore();
	});

	it("does not print persisted base URL when an environment provider override changes provider", async () => {
		process.env.MODEL_PROVIDER = "openai";
		const deps = makeDeps({
			modelProvider: "vllm",
			modelId: "Qwen3-Coder-480B-A35B-Instruct",
			modelBaseUrl: "http://127.0.0.1:8000",
		});
		const command = createModelCommand(deps);
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await command.parseAsync(["current"], { from: "user" });

		const output = logSpy.mock.calls.map((call) => String(call[0])).join("\n");
		expect(output).toContain("current: openai/gpt-5.6-sol");
		expect(output).not.toContain("base url: http://127.0.0.1:8000");

		logSpy.mockRestore();
	});

	it("prints fallback model override from environment", async () => {
		process.env.MODEL_PROVIDER = "openai";
		process.env.MODEL_ID = "gpt-5.5";
		process.env.MODEL_FALLBACK_PROVIDER = "ollama";
		process.env.MODEL_FALLBACK_MODEL_ID = "qwen2.5-coder";
		const command = createModelCommand(makeDeps());
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await command.parseAsync(["current"], { from: "user" });

		const output = logSpy.mock.calls.map((call) => String(call[0])).join("\n");
		expect(output).toContain("fallback: ollama/qwen2.5-coder");

		logSpy.mockRestore();
	});

	it("prints persisted fallback model route", async () => {
		const deps = makeDeps({
			modelProvider: "openai",
			modelId: "gpt-5.5",
			modelFallbackProvider: "ollama",
			modelFallbackModelId: "qwen2.5-coder",
		});
		const command = createModelCommand(deps);
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await command.parseAsync(["current"], { from: "user" });

		const output = logSpy.mock.calls.map((call) => String(call[0])).join("\n");
		expect(output).toContain("fallback: ollama/qwen2.5-coder");

		logSpy.mockRestore();
	});

	it("does not pair an environment fallback provider with a stored fallback model from another provider", async () => {
		process.env.MODEL_FALLBACK_PROVIDER = "anthropic";
		const deps = makeDeps({
			modelProvider: "openai",
			modelId: "gpt-5.5",
			modelFallbackProvider: "ollama",
			modelFallbackModelId: "qwen2.5-coder",
		});
		const command = createModelCommand(deps);
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await command.parseAsync(["current"], { from: "user" });

		const output = logSpy.mock.calls.map((call) => String(call[0])).join("\n");
		expect(output).toContain("fallback: anthropic/claude-sonnet-5");
		expect(output).not.toContain("anthropic/qwen2.5-coder");

		logSpy.mockRestore();
	});

	it("treats fallback-only persisted config as identity source", async () => {
		const deps = makeDeps({
			modelFallbackProvider: "ollama",
			modelFallbackModelId: "qwen2.5-coder",
		});
		const command = createModelCommand(deps);
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await command.parseAsync(["current"], { from: "user" });

		const output = logSpy.mock.calls.map((call) => String(call[0])).join("\n");
		expect(output).toContain("fallback: ollama/qwen2.5-coder");
		expect(output).toContain("source:   ~/.refarm/identity.json");

		logSpy.mockRestore();
	});

	// DIVERGENCE: the deleted wrapper attached a rich `addHelpText` epilogue with
	// runtime-reload prose and example invocations. The capability projector
	// (`toCommanderGroup`) builds help from the group/descriptor summaries only —
	// there is no help-text/examples field on a CapabilityGroup — so the epilogue
	// has no equivalent. Assert the sub-command surface the live help documents.
	it("documents the model sub-commands in help", () => {
		const command = createModelCommand(makeDeps());
		let help = "";
		command.configureOutput({
			writeOut: (value) => {
				help += value;
			},
		});

		command.outputHelp();

		expect(help).toContain("Inspect and change the active model route");
		expect(help).toContain("current");
		expect(help).toContain("providers");
		expect(help).toContain("doctor");
		expect(help).toContain("env");
		expect(help).toContain("Set the model route (provider/model)");
		expect(help).toContain(
			"Set or disable the persisted fallback model route",
		);
		expect(help).toContain("Reset a scoped model route to its built-in default");
		expect(help).toContain(
			"Set or disable the persisted OpenAI-compatible base",
		);
	});

	it("lists known provider defaults", async () => {
		const command = createModelCommand(makeDeps());
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await command.parseAsync(["providers"], { from: "user" });

		const output = logSpy.mock.calls.map((call) => String(call[0])).join("\n");
		expect(output).toContain("Known model providers");
		expect(output).toContain("openai");
		expect(output).toContain("default: gpt-5.5");
		expect(output).toContain("worker:  gpt-5.3-codex-spark");
		expect(output).toContain("key env: OPENAI_API_KEY");
		expect(output).toContain("gemini");
		expect(output).toContain("default: gemini-3-flash-preview");
		expect(output).toContain("Custom/self-hosted providers are allowed");
		expect(output).toContain("refarm model base-url <url>");

		logSpy.mockRestore();
	});

	it("lists known provider defaults as JSON", async () => {
		const command = createModelCommand(makeDeps());
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await command.parseAsync(["providers", "--json"], { from: "user" });

		const payload = JSON.parse(String(logSpy.mock.calls[0]?.[0])) as {
			command: string;
			operation: string;
			providers: Array<{
				provider: string;
				defaultModel: string;
				workerModel: string;
				monitorModel: string;
				credentialEnv?: string;
			}>;
			nextCommand: string;
		};
		expect(payload.command).toBe("model");
		expect(payload.operation).toBe("providers");
		expect(payload.providers).toContainEqual({
			provider: "openai",
			defaultModel: "gpt-5.6-sol",
			workerModel: "gpt-5.3-codex-spark",
			monitorModel: "gpt-5.6-sol",
			credentialEnv: "OPENAI_API_KEY",
		});
		expect(payload.providers).toContainEqual({
			provider: "ollama",
			defaultModel: "llama3.2",
			workerModel: "llama3.2",
			monitorModel: "llama3.2",
		});
		expect(payload.nextCommand).toBe("refarm model current --json");

		logSpy.mockRestore();
	});

	// DIVERGENCE: the deleted `set` subcommand carried `addHelpText` examples.
	// The projected `set` descriptor exposes only its summary, the `<ref>`
	// argument, and the `--scope`/`--json` options — no examples epilogue. Assert
	// the usage/option surface the live subcommand help documents.
	it("documents the model set subcommand usage and scope option", () => {
		const command = createModelCommand(makeDeps());
		const setCommand = command.commands.find(
			(subcommand) => subcommand.name() === "set",
		);
		let help = "";
		setCommand?.configureOutput({
			writeOut: (value) => {
				help += value;
			},
		});

		setCommand?.outputHelp();

		expect(help).toContain("Usage: model set [options] <ref>");
		expect(help).toContain("Set the model route (provider/model)");
		expect(help).toContain("--scope <value>");
		expect(help).toContain("Route scope (default/worker/monitor)");
	});

	it("sets a fallback model route", async () => {
		const deps = makeDeps({ modelProvider: "openai", modelId: "gpt-5.5" });
		const command = createModelCommand(deps);
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await command.parseAsync(["fallback", "ollama/qwen2.5-coder"], {
			from: "user",
		});

		expect(deps.saveTokens).toHaveBeenCalledWith({
			modelFallbackProvider: "ollama",
			modelFallbackModelId: "qwen2.5-coder",
		});

		logSpy.mockRestore();
	});

	it("sets a fallback model route as JSON", async () => {
		const deps = makeDeps({ modelProvider: "openai", modelId: "gpt-5.5" });
		const command = createModelCommand(deps);
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await command.parseAsync(["fallback", "ollama/qwen2.5-coder", "--json"], {
			from: "user",
		});

		expect(JSON.parse(String(logSpy.mock.calls[0]?.[0]))).toEqual({
			action: "set-fallback",
			provider: "ollama",
			modelId: "qwen2.5-coder",
			ref: "ollama/qwen2.5-coder",
			...MODEL_CURRENT_JSON_HANDOFF,
		});

		logSpy.mockRestore();
	});

	it("disables a persisted fallback model route", async () => {
		const deps = makeDeps({
			modelProvider: "openai",
			modelId: "gpt-5.5",
			modelFallbackProvider: "ollama",
			modelFallbackModelId: "qwen2.5-coder",
		});
		const command = createModelCommand(deps);
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await command.parseAsync(["fallback", "off"], { from: "user" });

		expect(deps.saveTokens).toHaveBeenCalledWith({
			modelFallbackProvider: undefined,
			modelFallbackModelId: undefined,
		});

		logSpy.mockRestore();
	});

	it("disables a persisted fallback model route as JSON", async () => {
		const deps = makeDeps({
			modelProvider: "openai",
			modelId: "gpt-5.5",
			modelFallbackProvider: "ollama",
			modelFallbackModelId: "qwen2.5-coder",
		});
		const command = createModelCommand(deps);
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await command.parseAsync(["fallback", "off", "--json"], { from: "user" });

		expect(JSON.parse(String(logSpy.mock.calls[0]?.[0]))).toEqual({
			action: "disable-fallback",
			...MODEL_CURRENT_JSON_HANDOFF,
		});

		logSpy.mockRestore();
	});

	it("sets a model base URL", async () => {
		const deps = makeDeps();
		const command = createModelCommand(deps);
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await command.parseAsync(["base-url", "http://127.0.0.1:8000"], {
			from: "user",
		});

		expect(deps.saveTokens).toHaveBeenCalledWith({
			modelBaseUrl: "http://127.0.0.1:8000",
		});

		logSpy.mockRestore();
	});

	it("sets a model base URL as JSON", async () => {
		const deps = makeDeps();
		const command = createModelCommand(deps);
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await command.parseAsync(["base-url", "http://127.0.0.1:8000", "--json"], {
			from: "user",
		});

		expect(JSON.parse(String(logSpy.mock.calls[0]?.[0]))).toEqual({
			action: "set-base-url",
			baseUrl: "http://127.0.0.1:8000",
			...MODEL_CURRENT_JSON_HANDOFF,
		});

		logSpy.mockRestore();
	});

	it("resets a scoped model route", async () => {
		const deps = makeDeps({
			modelProvider: "openai",
			modelId: "gpt-5.5",
			modelRoutes: {
				worker: "anthropic/claude-sonnet-4-6",
				monitor: "openai/gpt-5.5",
			},
		});
		const command = createModelCommand(deps);
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await command.parseAsync(["reset", "--scope", "worker"], { from: "user" });

		expect(deps.saveTokens).toHaveBeenCalledWith({
			modelRoutes: { monitor: "openai/gpt-5.5" },
		});

		logSpy.mockRestore();
	});

	it("resets a scoped model route as JSON", async () => {
		const deps = makeDeps({
			modelProvider: "openai",
			modelId: "gpt-5.5",
			modelRoutes: {
				worker: "anthropic/claude-sonnet-4-6",
				monitor: "openai/gpt-5.5",
			},
		});
		const command = createModelCommand(deps);
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await command.parseAsync(["reset", "--scope", "worker", "--json"], {
			from: "user",
		});

		expect(JSON.parse(String(logSpy.mock.calls[0]?.[0]))).toEqual({
			action: "reset-route",
			scope: "worker",
			...MODEL_CURRENT_JSON_HANDOFF,
		});

		logSpy.mockRestore();
	});

	it("disables a persisted model base URL", async () => {
		const deps = makeDeps({ modelBaseUrl: "http://127.0.0.1:8000" });
		const command = createModelCommand(deps);
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await command.parseAsync(["base-url", "off"], { from: "user" });

		expect(deps.saveTokens).toHaveBeenCalledWith({ modelBaseUrl: undefined });

		logSpy.mockRestore();
	});

	it("disables a persisted model base URL as JSON", async () => {
		const deps = makeDeps({ modelBaseUrl: "http://127.0.0.1:8000" });
		const command = createModelCommand(deps);
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await command.parseAsync(["base-url", "off", "--json"], { from: "user" });

		expect(JSON.parse(String(logSpy.mock.calls[0]?.[0]))).toEqual({
			action: "disable-base-url",
			...MODEL_CURRENT_JSON_HANDOFF,
		});

		logSpy.mockRestore();
	});

	it("sets the default model route", async () => {
		const deps = makeDeps();
		const command = createModelCommand(deps);
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await command.parseAsync(["set", "openai/gpt-5.5"], { from: "user" });

		expect(deps.saveTokens).toHaveBeenCalledWith({
			modelProvider: "openai",
			modelId: "gpt-5.5",
		});

		logSpy.mockRestore();
	});

	it("sets the default model route as JSON", async () => {
		const deps = makeDeps();
		const command = createModelCommand(deps);
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await command.parseAsync(["set", "openai/gpt-5.5", "--json"], {
			from: "user",
		});

		expect(JSON.parse(String(logSpy.mock.calls[0]?.[0]))).toEqual({
			action: "set-route",
			scope: "default",
			provider: "openai",
			modelId: "gpt-5.5",
			ref: "openai/gpt-5.5",
			...MODEL_CURRENT_JSON_HANDOFF,
		});

		logSpy.mockRestore();
	});

	it("clears stale Silo model credentials when the default provider changes", async () => {
		const deps = makeDeps({
			modelProvider: "anthropic",
			modelApiKey: "sk-ant-old",
			oauthProvider: "anthropic",
		});
		const command = createModelCommand(deps);
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await command.parseAsync(["set", "openai/gpt-5.5"], { from: "user" });

		expect(deps.saveTokens).toHaveBeenCalledWith({
			modelProvider: "openai",
			modelId: "gpt-5.5",
			modelApiKey: undefined,
			oauthProvider: undefined,
		});

		logSpy.mockRestore();
	});

	it("sets the default model route through shorthand", async () => {
		const deps = makeDeps();
		const command = createModelCommand(deps);
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		// The commander projector forwards a bare positional to the default action
		// (`current`), not `set` — the rich bare-ref→set grammar lives in the REPL
		// path (`resolveModelGrammar`). The honest CLI equivalent of the old
		// shorthand is the explicit `set <ref>` form.
		await command.parseAsync(["set", "openai/gpt-5.5"], { from: "user" });

		expect(deps.saveTokens).toHaveBeenCalledWith({
			modelProvider: "openai",
			modelId: "gpt-5.5",
		});

		logSpy.mockRestore();
	});

	it("sets the default model route through shorthand as JSON", async () => {
		const deps = makeDeps();
		const command = createModelCommand(deps);
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await command.parseAsync(["set", "openai/gpt-5.5", "--json"], {
			from: "user",
		});

		expect(JSON.parse(String(logSpy.mock.calls[0]?.[0]))).toEqual({
			action: "set-route",
			scope: "default",
			provider: "openai",
			modelId: "gpt-5.5",
			ref: "openai/gpt-5.5",
			...MODEL_CURRENT_JSON_HANDOFF,
		});

		logSpy.mockRestore();
	});

	it("sets a scoped worker model route", async () => {
		const deps = makeDeps({ modelProvider: "openai", modelId: "gpt-5.5" });
		const command = createModelCommand(deps);
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await command.parseAsync(
			["set", "--scope", "worker", "openai/gpt-5.3-codex-spark"],
			{ from: "user" },
		);

		expect(deps.saveTokens).toHaveBeenCalledWith({
			modelProvider: "openai",
			modelId: "gpt-5.5",
			modelRoutes: { worker: "openai/gpt-5.3-codex-spark" },
		});

		logSpy.mockRestore();
	});

	it("sets a scoped worker model route as JSON", async () => {
		const deps = makeDeps({ modelProvider: "openai", modelId: "gpt-5.5" });
		const command = createModelCommand(deps);
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await command.parseAsync(
			["set", "--scope", "worker", "openai/gpt-5.3-codex-spark", "--json"],
			{ from: "user" },
		);

		expect(JSON.parse(String(logSpy.mock.calls[0]?.[0]))).toEqual({
			action: "set-route",
			scope: "worker",
			provider: "openai",
			modelId: "gpt-5.3-codex-spark",
			ref: "openai/gpt-5.3-codex-spark",
			...MODEL_CURRENT_JSON_HANDOFF,
		});

		logSpy.mockRestore();
	});

	it("normalizes model route scope input", async () => {
		const deps = makeDeps({ modelProvider: "openai", modelId: "gpt-5.5" });
		const command = createModelCommand(deps);
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await command.parseAsync(
			["set", "--scope", "Worker", "openai/gpt-5.3-codex-spark"],
			{ from: "user" },
		);

		expect(deps.saveTokens).toHaveBeenCalledWith({
			modelProvider: "openai",
			modelId: "gpt-5.5",
			modelRoutes: { worker: "openai/gpt-5.3-codex-spark" },
		});

		logSpy.mockRestore();
	});

	it("sets a scoped monitor model route", async () => {
		const deps = makeDeps({ modelProvider: "openai", modelId: "gpt-5.5" });
		const command = createModelCommand(deps);
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await command.parseAsync(
			["set", "--scope", "monitor", "anthropic/claude-sonnet-4-6"],
			{ from: "user" },
		);

		expect(deps.saveTokens).toHaveBeenCalledWith({
			modelProvider: "openai",
			modelId: "gpt-5.5",
			modelRoutes: { monitor: "anthropic/claude-sonnet-4-6" },
		});

		logSpy.mockRestore();
	});

	it("sets exitCode when model ref is empty", async () => {
		const deps = makeDeps({ modelProvider: "openai" });
		// The capability surface hook renders the error envelope's message to
		// stdout (console.log) and lets the projector set process.exitCode from
		// `ok === false`, rather than writing to console.error like the old wrapper.
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await createModelCommand(deps).parseAsync(["set", ""], { from: "user" });

		expect(logSpy).toHaveBeenCalledWith(
			expect.stringContaining("model ref cannot be empty"),
		);
		expect(deps.saveTokens).not.toHaveBeenCalled();
		expect(process.exitCode).toBe(1);

		logSpy.mockRestore();
	});

	it("prints structured JSON when model ref is empty", async () => {
		const deps = makeDeps({ modelProvider: "openai" });
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await createModelCommand(deps).parseAsync(["set", "", "--json"], {
			from: "user",
		});

		const payload = JSON.parse(String(logSpy.mock.calls[0]?.[0])) as {
			ok: boolean;
			error: string;
			message: string;
			nextCommand: string;
			nextCommands: string[];
			scope: string;
		};
		expect(payload).toEqual(
			expect.objectContaining({
				ok: false,
				command: "model",
				operation: "mutate",
				error: "empty-model-ref",
				message: "model ref cannot be empty.",
				nextCommand: "refarm sow --model ollama/llama3.2 --json",
				scope: "default",
			}),
		);
		expect(payload.nextCommands).toContain("refarm model providers --json");
		expect(payload.nextCommands).toContain(
			"refarm sow --model ollama/llama3.2 --json",
		);
		expect(deps.saveTokens).not.toHaveBeenCalled();
		expect(process.exitCode).toBe(1);

		logSpy.mockRestore();
	});

	it("prints structured JSON when model provider cannot be inferred", async () => {
		const deps = makeDeps();
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await createModelCommand(deps).parseAsync(
			["set", "local-model", "--json"],
			{
				from: "user",
			},
		);

		const payload = JSON.parse(String(logSpy.mock.calls[0]?.[0])) as {
			ok: boolean;
			error: string;
			modelId: string;
			nextCommand: string;
		};
		expect(payload).toEqual(
			expect.objectContaining({
				ok: false,
				error: "model-provider-required",
				modelId: "local-model",
				nextCommand: "refarm sow --model ollama/llama3.2 --json",
			}),
		);
		expect(deps.saveTokens).not.toHaveBeenCalled();
		expect(process.exitCode).toBe(1);

		logSpy.mockRestore();
	});

	it("sets exitCode when fallback model ref is empty", async () => {
		const deps = makeDeps();
		// Error envelope message renders to stdout via the surface hook; exitCode
		// comes from the projector reading `ok === false`.
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await createModelCommand(deps).parseAsync(["fallback", ""], {
			from: "user",
		});

		expect(logSpy).toHaveBeenCalledWith(
			expect.stringContaining("fallback model ref cannot be empty"),
		);
		expect(deps.saveTokens).not.toHaveBeenCalled();
		expect(process.exitCode).toBe(1);

		logSpy.mockRestore();
	});

	it("prints structured JSON when fallback model ref is empty", async () => {
		const deps = makeDeps();
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await createModelCommand(deps).parseAsync(["fallback", "", "--json"], {
			from: "user",
		});

		expect(JSON.parse(String(logSpy.mock.calls[0]?.[0]))).toEqual(
			expect.objectContaining({
				ok: false,
				command: "model",
				operation: "mutate",
				error: "empty-fallback-model-ref",
				message: "fallback model ref cannot be empty.",
				nextCommand: "refarm sow --model ollama/llama3.2 --json",
			}),
		);
		expect(deps.saveTokens).not.toHaveBeenCalled();
		expect(process.exitCode).toBe(1);

		logSpy.mockRestore();
	});

	// An explicitly-provided unknown `--scope` is rejected (exitCode 1, no
	// persistence) — the legacy `unknown-model-scope` behavior, restored on the
	// capability surface via buildInvalidScopeEnvelope so a typo'd scope fails
	// loudly instead of silently writing the default route.
	it("rejects an unrecognized model scope without persisting", async () => {
		const deps = makeDeps();
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await createModelCommand(deps).parseAsync(
			["set", "--scope", "planner", "openai/gpt-5.5"],
			{ from: "user" },
		);

		expect(deps.saveTokens).not.toHaveBeenCalled();
		expect(process.exitCode).toBe(1);
		expect(logSpy.mock.calls.flat().join("\n")).toContain(
			"Unknown model scope: planner",
		);

		logSpy.mockRestore();
	});

	it("reports an unknown-model-scope error envelope in JSON", async () => {
		const deps = makeDeps();
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await createModelCommand(deps).parseAsync(
			["set", "--scope", "planner", "openai/gpt-5.5", "--json"],
			{ from: "user" },
		);

		expect(JSON.parse(String(logSpy.mock.calls[0]?.[0]))).toEqual(
			expect.objectContaining({
				ok: false,
				command: "model",
				operation: "mutate",
				error: "unknown-model-scope",
				message: "Unknown model scope: planner",
			}),
		);
		expect(deps.saveTokens).not.toHaveBeenCalled();
		expect(process.exitCode).toBe(1);

		logSpy.mockRestore();
	});
});

describe("the credential's own clock, reported beside the probe", () => {
	/**
	 * ISS-081, measured on the operator's node 2026-08-12: the `openai-codex` token had expired
	 * FIVE DAYS earlier and nothing in this repository said so. `model doctor` probed whether the
	 * endpoint answers, which is a different question — an expired credential and an unreachable
	 * host are two facts with two remedies, and a doctor reporting only the second sends an
	 * operator to debug a network.
	 */
	const NOW = 1_786_500_000_000;
	const tokensWith = (expires: unknown) =>
		({ oauthCredentials: { "openai-codex": { access: "a", refresh: "r", expires } } }) as never;

	it("reads an expired credential as expired, with how long it has been so", () => {
		const lifetime = credentialLifetime("openai-codex", tokensWith(NOW - 86_400_000 * 5), NOW);
		expect(lifetime).toMatchObject({ state: "expired", expiredForMs: 86_400_000 * 5 });
	});

	it("the boundary is the instant itself — expiring NOW is expired", () => {
		expect(credentialLifetime("openai-codex", tokensWith(NOW), NOW).state).toBe("expired");
		expect(credentialLifetime("openai-codex", tokensWith(NOW + 1), NOW).state).toBe("valid");
	});

	it("a provider with no OAuth entry is UNKNOWN, never valid", () => {
		// The shape this repository keeps removing: an absence rendered as a reassurance. A
		// keyless local provider has no credential to be valid.
		expect(credentialLifetime("ollama", tokensWith(NOW + 1), NOW)).toEqual({
			state: "unknown",
			reason: "not-oauth",
		});
	});

	it("an OAuth entry with no expiry is UNKNOWN, not valid forever", () => {
		expect(credentialLifetime("openai-codex", tokensWith(undefined), NOW)).toEqual({
			state: "unknown",
			reason: "no-expiry-recorded",
		});
	});

	it("prints a line for a fact and NOTHING for an unknown", () => {
		// A doctor that announces "credential: unknown" for every keyless provider teaches an
		// operator to skim the line — and the day it says EXPIRED they skim that too.
		expect(formatCredentialLifetime({ state: "unknown", reason: "not-oauth" })).toBeNull();
		expect(
			formatCredentialLifetime({ state: "expired", expiresAt: NOW, expiredForMs: 86_400_000 * 5 }),
		).toContain("EXPIRED");
		expect(
			formatCredentialLifetime({ state: "valid", expiresAt: NOW, remainingMs: 86_400_000 * 30 }),
		).toContain("30");
	});

	it("warns before it fails — three days out reads differently from thirty", () => {
		const soon = formatCredentialLifetime({ state: "valid", expiresAt: NOW, remainingMs: 86_400_000 * 2 });
		expect(soon).toContain("expires in");
	});
});

/**
 * A MALFORMED ROUTE IS NOT A NETWORK FAULT (ISS-121).
 *
 * Measured on the operator's own node 2026-08-12: `tokens.modelBaseUrl` held
 * `__refarm_ancestor_option_probe__` — a conformance test's sentinel that had leaked into the
 * silo and sat there for over a day — and `model doctor` reported `unreachable`. The evidence
 * was already in the payload (`ERR_INVALID_URL`) and the VERDICT contradicted it. Whoever read
 * that line went to debug a network that was fine.
 *
 * These pin the three things that had to change together: the verdict, the sentence, and the
 * remedy. A doctor that names the fault correctly but still hands back `ollama serve` has moved
 * the operator's wasted hour, not removed it.
 */
describe("endpoint-malformed", () => {
	const previousBaseUrl = process.env.MODEL_BASE_URL;
	const previousKey = process.env.OPENAI_API_KEY;

	beforeEach(() => {
		process.env.OPENAI_API_KEY = "sk-test-key";
	});

	afterEach(() => {
		if (previousBaseUrl === undefined) delete process.env.MODEL_BASE_URL;
		else process.env.MODEL_BASE_URL = previousBaseUrl;
		if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
		else process.env.OPENAI_API_KEY = previousKey;
	});

	/** The real fetch, so the URL parse failure is Node's own and not a mock's idea of one. */
	async function doctorWithBaseUrl(baseUrl: string) {
		return buildModelDoctorStatus(
			{ modelProvider: "openai", modelId: "gpt-5.5", modelBaseUrl: baseUrl },
			{ isContainer: () => false },
		);
	}

	it("names an unparseable endpoint as malformed, not as unreachable", async () => {
		const status = await doctorWithBaseUrl("__refarm_ancestor_option_probe__");
		expect(status.providerProbe.reason).toBe("endpoint-malformed");
		expect(status.providerProbe.ready).toBe(false);
		// The evidence stays: the verdict changed, the measurement did not.
		expect(status.providerProbe.error).toMatch(/ERR_INVALID_URL|Failed to parse URL/u);
	});

	it("still reports a genuinely dead host as unreachable", async () => {
		// The other side of the boundary. Widening `endpoint-malformed` to swallow connection
		// failures would trade one mislabel for its mirror image.
		const status = await buildModelDoctorStatus(
			{ modelProvider: "openai", modelId: "gpt-5.5", modelBaseUrl: "http://127.0.0.1:1" },
			{
				fetch: vi.fn().mockRejectedValue(
					Object.assign(new Error("fetch failed"), { cause: { code: "ECONNREFUSED" } }),
				) as unknown as typeof fetch,
				isContainer: () => false,
			},
		);
		expect(status.providerProbe.reason).toBe("unreachable");
	});

	it("hands back the remedy that CAN work — clearing the silo's value", async () => {
		const status = await doctorWithBaseUrl("not a url");
		expect(status.baseUrlSource).toBe("silo");
		const text = formatModelDoctorFromStatus(status);
		expect(text).toContain("refarm model base-url off --json");
		// And NOT the local-runtime start command: no server was ever the problem.
		expect(text).not.toContain("ollama serve");
	});

	it("does not offer a CLI remedy for a value the SHELL exported", async () => {
		// `model base-url off` deletes the persisted token. With MODEL_BASE_URL set, that command
		// would report success and the malformed endpoint would survive into the next run — a
		// remedy that measurably does nothing is worse than none, because it looks like progress.
		process.env.MODEL_BASE_URL = "__refarm_ancestor_option_probe__";
		const status = await buildModelDoctorStatus(
			{ modelProvider: "openai", modelId: "gpt-5.5" },
			{ isContainer: () => false },
		);
		expect(status.baseUrlSource).toBe("env");
		const text = formatModelDoctorFromStatus(status);
		expect(text).toContain("unset MODEL_BASE_URL");
		expect(text).not.toContain("refarm model base-url off");
	});

	it("says in words that the fault is configuration, and where it lives", async () => {
		// The verdict is a vocabulary word; this is the line an operator actually reads.
		const silo = await doctorWithBaseUrl("::::");
		expect(formatModelDoctorFromStatus(silo)).toContain("stored configuration");
		process.env.MODEL_BASE_URL = "::::";
		const env = await buildModelDoctorStatus(
			{ modelProvider: "openai", modelId: "gpt-5.5" },
			{ isContainer: () => false },
		);
		expect(formatModelDoctorFromStatus(env)).toContain("environment");
	});

	it("gives the MACHINE reader its own diagnostic, not the network one", async () => {
		// `recommendations[].diagnostic` is what an automated consumer dispatches on. Leaving it as
		// `model-provider-unreachable` would keep the original defect alive on the surface that
		// acts without a human reading the sentence beside it.
		const silo = await doctorWithBaseUrl("__refarm_ancestor_option_probe__");
		expect(silo.recommendations?.[0]).toMatchObject({
			diagnostic: "model-endpoint-malformed",
			severity: "failure",
			command: "refarm model base-url off --json",
		});
		expect(silo.recommendations?.[0]?.summary).toContain("not a URL");

		process.env.MODEL_BASE_URL = "__refarm_ancestor_option_probe__";
		const env = await buildModelDoctorStatus(
			{ modelProvider: "openai", modelId: "gpt-5.5" },
			{ isContainer: () => false },
		);
		expect(env.recommendations?.[0]?.command).toBe("unset MODEL_BASE_URL");
	});

	it("records baseUrlSource as absent when there is no base URL at all", async () => {
		// The third state. `undefined` here is not "silo with an empty value" — it is the case
		// where nothing configured an endpoint, which is how the provider's built-in one applies.
		const status = await buildCurrentModelStatus({ modelProvider: "openai", modelId: "gpt-5.5" });
		expect(status.baseUrl).toBeUndefined();
		expect(status.baseUrlSource).toBeUndefined();
	});
});

/**
 * THE CATALOG ANSWERS WHAT THE FLAT TOKEN MAP CANNOT SEE.
 *
 * Measured on the operator's node 2026-08-23. `refarm credential quota` reached GitHub with two
 * Copilot seats and came back with live plan data; in the same minute `refarm model current`
 * reported `unresolved` on all three routes and `refarm model doctor` prescribed `ollama serve`
 * for a `github-copilot` route.
 *
 * `modelCredentialStatus` (packages/config) is NOT the defect and is not changed: it does no I/O,
 * it says `unresolved` precisely because it cannot see the `model` namespace, and its own comment
 * names the remedy — "a caller that can consult the account catalog gets a better answer by asking
 * the catalog, not by reinterpreting this boolean." These are the callers that can, doing so.
 */
describe("the catalog answers what the flat token map cannot see", () => {
	const seat = (over: Partial<ModelAccountDescriptor> = {}): ModelAccountDescriptor => ({
		credentialId: "model-account:K4NXGZTQQ4KFM0GG9139VN67PR",
		provider: "github-copilot",
		alias: "corporativo",
		identity: { status: "verified" },
		secretRef: "model/model-account:K4NXGZTQQ4KFM0GG9139VN67PR",
		health: "healthy",
		revision: "sha256:test",
		...over,
	});

	const copilotRoute = { modelProvider: "github-copilot", modelId: "gpt-4o" } as ModelTokens;

	it("an authorized healthy seat resolves the route the flat map calls unresolved", () => {
		// The negative control: with no catalog handed in, today's honest "I cannot see" stands.
		expect(buildCurrentModelStatus(copilotRoute).credential.state).toBe("unresolved");

		const status = buildCurrentModelStatus(copilotRoute, {
			accounts: [seat()],
			authorization: { scope: "all" },
		});

		expect(status.credential.state).toBe("account");
		expect(status.credential.status).toContain("corporativo");
	});

	it("a seat this node holds and has NOT authorized is not a missing credential", () => {
		// Two absences with two different remedies. Reading "you never declared it" as "there is
		// none" is the same substitution this whole block exists to remove, one layer down.
		const status = buildCurrentModelStatus(copilotRoute, {
			accounts: [seat()],
			authorization: { scope: "undeclared" },
		});

		expect(status.credential.state).toBe("unauthorized");
	});

	it("a catalog holding nothing for the provider is measured absence, not doubt", () => {
		const status = buildCurrentModelStatus(copilotRoute, {
			accounts: [seat({ provider: "openai-codex", alias: "account-2" })],
			authorization: { scope: "all" },
		});

		expect(status.credential.state).toBe("missing");
	});

	it("every route is resolved, not only the default", () => {
		const status = buildCurrentModelStatus(copilotRoute, {
			accounts: [seat()],
			authorization: { scope: "all" },
		});

		expect(status.routeCredentials.default.state).toBe("account");
		expect(status.routeCredentials.worker.state).toBe("account");
		expect(status.routeCredentials.monitor.state).toBe("account");
	});

	it("an incomplete seat is an absence, not a doubt — its secret is gone", () => {
		// `not.toBe("account")` would pass today without the feature, which proves nothing. The
		// honest answer names the same remedy as holding nothing at all: `refarm sow` writes the
		// secret in both cases, so both are `missing` and `credential list` is where the
		// descriptor-vs-nothing distinction is read.
		const status = buildCurrentModelStatus(copilotRoute, {
			accounts: [seat({ health: "incomplete" })],
			authorization: { scope: "all" },
		});

		expect(status.credential.state).toBe("missing");
	});
});

/**
 * THE DOCTOR'S OWN CLOCK LOOKS IN THE LEGACY MAP ONLY.
 *
 * `credentialLifetime`'s comment claims it is "reached through the account contract, so expiry is
 * read from wherever the credential actually lives". Measured 2026-08-23: it resolves its
 * descriptor from `readLegacyCredentials(tokens)` — the flat map — and every account written since
 * 2026-08-14 lives in the `model` namespace instead. On the operator's node `refarm model doctor`
 * answered `{state: "unknown", reason: "not-oauth"}` for an OAuth credential whose stored blob
 * carried `expires`, ninety minutes before it lapsed.
 *
 * The describe block above this one is not wrong and is not changed: its fixture is the legacy
 * shape, which still exists and must keep working. It simply never asked the other question.
 */
describe("the credential's clock reads the namespace too", () => {
	const NOW = 1_786_500_000_000;
	const namespaced = {
		credentialId: "model-account:K4NXGZTQQ4KFM0GG9139VN67PR",
		provider: "github-copilot",
		alias: "corporativo",
		identity: { status: "verified" as const },
		secretRef: "model/model-account:K4NXGZTQQ4KFM0GG9139VN67PR",
		health: "healthy" as const,
		revision: "sha256:test",
	} satisfies ModelAccountDescriptor;

	const catalogWith = (expires: unknown) => ({
		accounts: [namespaced],
		authorization: { scope: "all" as const },
		credentials: new Map<string, unknown>([
			[namespaced.credentialId, { access: "a", refresh: "r", expires }],
		]),
	});

	it("a namespaced credential with an expiry is read, not called not-oauth", () => {
		expect(credentialLifetime("github-copilot", {} as never, NOW, catalogWith(NOW + 86_400_000)))
			.toMatchObject({ state: "valid", remainingMs: 86_400_000 });
	});

	it("a namespaced credential already past its expiry reads as expired", () => {
		expect(credentialLifetime("github-copilot", {} as never, NOW, catalogWith(NOW - 3_600_000)))
			.toMatchObject({ state: "expired", expiredForMs: 3_600_000 });
	});

	it("without a catalog the answer is unchanged — this adds a reader, it does not move one", () => {
		expect(credentialLifetime("github-copilot", {} as never, NOW)).toEqual({
			state: "unknown",
			reason: "not-oauth",
		});
	});
});

/**
 * A REMOTE PROVIDER HAS NO LOCAL RUNTIME TO START.
 *
 * Measured on the operator's node 2026-08-23, with a healthy `github-copilot` route:
 *
 *     refarm model doctor --json
 *       providerProbe.baseUrl: "http://localhost:11434"
 *       nextAction: "ollama serve"
 *
 * `PROVIDER_DOCTOR_PROFILES` already knows this — github-copilot takes `DEFAULT_REMOTE_PROFILE`,
 * whose `startCommand` is absent precisely because there is nothing to start. The knowledge was
 * in the table and the recovery list pushed `handoffs.startOllama` unconditionally, past it.
 */
describe("the doctor's remedy matches the provider it is talking about", () => {
	const failingFetch = () => vi.fn().mockRejectedValue(new Error("unreachable")) as never;

	it("a remote provider is never told to start a local runtime", async () => {
		// `modelBaseUrl` REPRODUCES THE NODE, and without it this test passes vacuously: an absent
		// endpoint sends `resolveProviderProbe` to the runtime and the probe never reports
		// `ready: false`, so the recovery list is empty and asserting on it proves nothing. On the
		// operator's node a base URL persisted while the route was ollama was still being applied
		// to a github-copilot route, which is what got pinged and what failed.
		const envelope = await buildModelDoctorEnvelope(
			{
				modelProvider: "github-copilot",
				modelId: "gpt-4o",
				modelBaseUrl: "http://localhost:11434",
			} as ModelTokens,
			{ fetch: failingFetch(), isContainer: () => false },
		);

		expect((envelope as { providerProbe: { ready: boolean | null } }).providerProbe.ready).toBe(
			false,
		);

		expect((envelope as { nextActions?: string[] }).nextActions).not.toContain("ollama serve");
		expect((envelope as { nextAction?: string | null }).nextAction).not.toBe("ollama serve");
	});

	it("ollama still gets its start command — this narrows the advice, it does not delete it", async () => {
		const envelope = await buildModelDoctorEnvelope(
			{ modelProvider: "ollama", modelId: "llama3.2" } as ModelTokens,
			{ fetch: failingFetch(), isContainer: () => false },
		);

		expect((envelope as { nextActions?: string[] }).nextActions).toContain("ollama serve");
	});
});
