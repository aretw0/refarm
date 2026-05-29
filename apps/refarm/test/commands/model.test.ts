import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	buildCurrentModelStatus,
	createModelCommand,
	type ModelCommandDeps,
} from "../../src/commands/model.js";

function makeDeps(tokens: Record<string, unknown> = {}): ModelCommandDeps & {
	saveTokens: ReturnType<typeof vi.fn>;
} {
	return {
		loadTokens: vi.fn().mockResolvedValue(tokens),
		saveTokens: vi.fn().mockResolvedValue({}),
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
		expect(output).toContain("openai/gpt-5.3-codex-spark");
		expect(output).toContain("monitor:  openai/gpt-5.5");

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
		expect(output).toContain("warning: The worker model route requires credentials");
		expect(output).toContain("fix:     refarm model set --scope worker 'ollama/llama3.2' --json");

		logSpy.mockRestore();
	});

	it("prints the default route when only the default provider key env is set", async () => {
		process.env.OPENAI_API_KEY = "sk-env-test";
		const command = createModelCommand(makeDeps());
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await command.parseAsync(["current"], { from: "user" });

		const output = logSpy.mock.calls.map((call) => String(call[0])).join("\n");
		expect(output).toContain("current: openai/gpt-5.5");
		expect(output).toContain("key:      OPENAI_API_KEY env");
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
		expect(payload.routes.default).toBe("openai/gpt-5.5");
		expect(payload.routes.worker).toBe("openai/gpt-5.3-codex-spark");
		expect(payload.routes.monitor).toBe("openai/gpt-5.5");
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
			setWorkerModel: "refarm model set --scope worker 'openai/gpt-5.3-codex-spark' --json",
			setMonitorModel: "refarm model set --scope monitor 'openai/gpt-5.5' --json",
		});

		logSpy.mockRestore();
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

	it("prints built-in OpenAI defaults when no route is configured", async () => {
		const deps = makeDeps();
		const command = createModelCommand(deps);
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await command.parseAsync(["current"], { from: "user" });

		const output = logSpy.mock.calls.map((call) => String(call[0])).join("\n");
		expect(output).toContain("current: openai/gpt-5.5");
		expect(output).toContain("key:      missing (run refarm sow)");
		expect(output).toContain("openai default: openai/gpt-5.5");
		expect(output).toContain("openai worker:  openai/gpt-5.3-codex-spark");
		expect(output).toContain("openai monitor: openai/gpt-5.5");
		expect(output).toContain("login:          refarm sow");

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
			setWorkerModel: "refarm model set --scope worker 'ollama/llama3.2' --json",
			setMonitorModel: "refarm model set --scope monitor 'anthropic/claude-sonnet-4.5' --json",
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
		expect(output).toContain("custom provider: set endpoint with refarm model base-url");

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
		expect(output).toContain("current: openai/gpt-5.5");
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
		expect(output).toContain("fallback: anthropic/claude-sonnet-4-6");
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

	it("documents runtime reload behavior in help", () => {
		const command = createModelCommand(makeDeps());
		let help = "";
		command.configureOutput({
			writeOut: (value) => {
				help += value;
			},
		});

		command.outputHelp();

		expect(help).toContain("The Refarm runtime reloads");
		expect(help).toContain("MODEL_PROVIDER, MODEL_ID, and MODEL_BASE_URL");
		expect(help).toContain("MODEL_FALLBACK_PROVIDER");
		expect(help).toContain("MODEL_FALLBACK_MODEL_ID");
		expect(help).toContain("refarm model providers");
		expect(help).toContain("refarm model openai/gpt-5.5");
		expect(help).toContain("openai/gpt-5.3-codex-spark");
		expect(help).toContain("refarm model base-url http://127.0.0.1:8000");
		expect(help).toContain("refarm model fallback ollama/llama3.2");
		expect(help).toContain("refarm model reset --scope worker");
		expect(help).toContain("refarm model set --scope monitor openai/gpt-5.5");
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
			defaultModel: "gpt-5.5",
			workerModel: "gpt-5.3-codex-spark",
			monitorModel: "gpt-5.5",
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

	it("documents model set examples in subcommand help", () => {
		const command = createModelCommand(makeDeps());
		const setCommand = command.commands.find((subcommand) => subcommand.name() === "set");
		let help = "";
		setCommand?.configureOutput({
			writeOut: (value) => {
				help += value;
			},
		});

		setCommand?.outputHelp();

		expect(help).toContain("refarm model set openai/gpt-5.5");
		expect(help).toContain("refarm model set --scope worker openai/gpt-5.3-codex-spark");
		expect(help).toContain("provider-specific model id");
	});

	it("sets a fallback model route", async () => {
		const deps = makeDeps({ modelProvider: "openai", modelId: "gpt-5.5" });
		const command = createModelCommand(deps);
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await command.parseAsync(["fallback", "ollama/qwen2.5-coder"], { from: "user" });

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

		await command.parseAsync(["base-url", "http://127.0.0.1:8000"], { from: "user" });

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

		await command.parseAsync(["openai/gpt-5.5"], { from: "user" });

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

		await command.parseAsync(["openai/gpt-5.5", "--json"], { from: "user" });

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
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		await createModelCommand(deps).parseAsync(["set", ""], { from: "user" });

		expect(errorSpy).toHaveBeenCalledWith(
			expect.stringContaining("model ref cannot be empty"),
		);
		expect(deps.saveTokens).not.toHaveBeenCalled();
		expect(process.exitCode).toBe(1);
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
		expect(payload.nextCommands).toContain("refarm sow --model ollama/llama3.2 --json");
		expect(deps.saveTokens).not.toHaveBeenCalled();
		expect(process.exitCode).toBe(1);

		logSpy.mockRestore();
	});

	it("prints structured JSON when model provider cannot be inferred", async () => {
		const deps = makeDeps();
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await createModelCommand(deps).parseAsync(["set", "local-model", "--json"], {
			from: "user",
		});

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
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		await createModelCommand(deps).parseAsync(["fallback", ""], {
			from: "user",
		});

		expect(errorSpy).toHaveBeenCalledWith(
			expect.stringContaining("fallback model ref cannot be empty"),
		);
		expect(deps.saveTokens).not.toHaveBeenCalled();
		expect(process.exitCode).toBe(1);
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

	it("sets exitCode when model scope is invalid", async () => {
		const deps = makeDeps();
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		await createModelCommand(deps).parseAsync(
			["set", "--scope", "planner", "openai/gpt-5.5"],
			{ from: "user" },
		);

		expect(errorSpy).toHaveBeenCalledWith(
			expect.stringContaining("Unknown model scope"),
		);
		expect(deps.saveTokens).not.toHaveBeenCalled();
		expect(process.exitCode).toBe(1);
	});

	it("prints structured JSON when model scope is invalid", async () => {
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
				scope: "planner",
				allowedScopes: ["default", "worker", "monitor"],
				nextCommand: "refarm model current --json",
			}),
		);
		expect(deps.saveTokens).not.toHaveBeenCalled();
		expect(process.exitCode).toBe(1);

		logSpy.mockRestore();
	});
});
