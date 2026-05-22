import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createModelCommand, type ModelCommandDeps } from "../../src/commands/model.js";

function makeDeps(tokens: Record<string, unknown> = {}): ModelCommandDeps & {
	saveTokens: ReturnType<typeof vi.fn>;
} {
	return {
		loadTokens: vi.fn().mockResolvedValue(tokens),
		saveTokens: vi.fn().mockResolvedValue({}),
	};
}

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
		expect(help).toContain("MODEL_FALLBACK_PROVIDER");
		expect(help).toContain("MODEL_FALLBACK_MODEL_ID");
		expect(help).toContain("refarm model providers");
		expect(help).toContain("refarm model openai/gpt-5.5");
		expect(help).toContain("openai/gpt-5.3-codex-spark");
		expect(help).toContain("refarm model base-url http://127.0.0.1:8000");
		expect(help).toContain("refarm model fallback ollama/llama3.2");
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

	it("disables a persisted model base URL", async () => {
		const deps = makeDeps({ modelBaseUrl: "http://127.0.0.1:8000" });
		const command = createModelCommand(deps);
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await command.parseAsync(["base-url", "off"], { from: "user" });

		expect(deps.saveTokens).toHaveBeenCalledWith({ modelBaseUrl: undefined });

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
});
