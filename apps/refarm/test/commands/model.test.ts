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
		expect(output).toContain("openai/gpt-5.3-codex-spark");
		expect(output).toContain("monitor:  openai/gpt-5.5");

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
		expect(output).toContain("current: <not configured>");
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
		expect(help).toContain("refarm model openai/gpt-5.5");
		expect(help).toContain("openai/gpt-5.3-codex-spark");
		expect(help).toContain("refarm model set --scope monitor openai/gpt-5.5");
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
