import { afterEach, describe, expect, it, vi } from "vitest";
import { printCurrentModel, printCurrentModelJson } from "./model.js";

function captureCurrentModel(tokens = {}): string {
	const lines: string[] = [];
	const log = vi.spyOn(console, "log").mockImplementation((line = "") => {
		lines.push(String(line));
	});
	try {
		printCurrentModel(tokens);
		return lines.join("\n");
	} finally {
		log.mockRestore();
	}
}

function captureCurrentModelJson(tokens = {}): Record<string, unknown> {
	const lines: string[] = [];
	const log = vi.spyOn(console, "log").mockImplementation((line = "") => {
		lines.push(String(line));
	});
	try {
		printCurrentModelJson(tokens);
		return JSON.parse(lines.join("\n")) as Record<string, unknown>;
	} finally {
		log.mockRestore();
	}
}

describe("printCurrentModel", () => {
	afterEach(() => {
		delete process.env.MODEL_PROVIDER;
		delete process.env.MODEL_DEFAULT_PROVIDER;
		delete process.env.MODEL_ID;
		delete process.env.MODEL_BASE_URL;
		delete process.env.MODEL_FALLBACK_PROVIDER;
		delete process.env.MODEL_FALLBACK_MODEL_ID;
		delete process.env.OPENAI_API_KEY;
		delete process.env.OPENAI_CODEX_ACCESS_TOKEN;
		delete process.env.GITHUB_COPILOT_ACCESS_TOKEN;
	});

	it("shows the effective default route even when credentials are missing", () => {
		const output = captureCurrentModel();

		expect(output).toContain("current: openai/gpt-5.5");
		expect(output).toContain("provider: openai");
		expect(output).toContain("key env:  OPENAI_API_KEY");
		expect(output).toContain("key:      missing (run refarm sow)");
		expect(output).toContain("source:   built-in defaults");
		expect(output).toContain("login:          refarm sow");
	});

	it("prints credential recovery actions in JSON when credentials are missing", () => {
		const payload = captureCurrentModelJson() as {
			ok: boolean;
			nextAction: string;
			nextActions: string[];
			nextCommand: string;
			nextCommands: string[];
		};

		expect(payload.ok).toBe(true);
		expect(payload.nextAction).toBe("refarm sow --json");
		expect(payload.nextActions).toContain("refarm model providers --json");
		expect(payload.nextCommand).toBe("refarm sow --json");
		expect(payload.nextCommands).toContain("refarm model providers --json");
	});

	it("shows supported subscription OAuth without runtime unsupported warning", () => {
		const output = captureCurrentModel({
			modelProvider: "openai-codex",
			modelId: "gpt-5.5",
			oauthProvider: "openai-codex",
			oauthCredentials: {
				"openai-codex": { access: "oauth-access-test" },
			},
		});

		expect(output).toContain("key:      Silo OAuth (openai-codex)");
		expect(output).not.toContain("not a runtime API credential yet");
		expect(output).not.toContain("fix:     refarm sow --json");
	});

	it("prints no runtime unsupported recovery actions for supported subscription OAuth", () => {
		const payload = captureCurrentModelJson({
			modelProvider: "openai-codex",
			modelId: "gpt-5.5",
			oauthProvider: "openai-codex",
			oauthCredentials: {
				"openai-codex": { access: "oauth-access-test" },
			},
		}) as {
			ok: boolean;
			nextActions: string[];
			nextCommands: string[];
			recommendations?: Array<{ diagnostic: string; severity: string }>;
		};

		expect(payload.ok).toBe(true);
		expect(payload.nextActions).toEqual([]);
		expect(payload.nextCommands).toEqual([]);
		expect(payload.recommendations ?? []).not.toContainEqual(
			expect.objectContaining({
				diagnostic: "model-subscription-runtime-unsupported",
			}),
		);
	});

	it("warns when an unsupported subscription provider token comes from the environment", () => {
		process.env.MODEL_PROVIDER = "github-copilot";
		process.env.MODEL_ID = "gpt-4o";
		process.env.GITHUB_COPILOT_ACCESS_TOKEN = "copilot-access-test";

		const output = captureCurrentModel();

		expect(output).toContain("current: github-copilot/gpt-4o");
		expect(output).toContain("key env:  GITHUB_COPILOT_ACCESS_TOKEN");
		expect(output).toContain("key:      GITHUB_COPILOT_ACCESS_TOKEN env");
		expect(output).toContain("subscription OAuth");
		expect(output).toContain("not a runtime API credential yet");
	});

	it("prints unsupported subscription env recovery actions in JSON", () => {
		process.env.MODEL_PROVIDER = "github-copilot";
		process.env.MODEL_ID = "gpt-4o";
		process.env.GITHUB_COPILOT_ACCESS_TOKEN = "copilot-access-test";

		const payload = captureCurrentModelJson() as {
			ok: boolean;
			nextActions: string[];
			nextCommands: string[];
			recommendations: Array<{ diagnostic: string; severity: string }>;
		};

		expect(payload.ok).toBe(true);
		expect(payload.nextActions).toContain("refarm sow --json");
		expect(payload.nextCommands.some((command) =>
			command.includes("refarm sow --model") && command.includes("github-copilot/gpt-4o")
		)).toBe(true);
		expect(payload.recommendations).toContainEqual(
			expect.objectContaining({
				diagnostic: "model-subscription-runtime-unsupported",
				severity: "warning",
			}),
		);
	});

	it("marks environment overrides as the active source", () => {
		process.env.MODEL_PROVIDER = "gemini";

		const output = captureCurrentModel();

		expect(output).toContain("current: gemini/gemini-3-flash-preview");
		expect(output).toContain("key env:  GEMINI_API_KEY");
		expect(output).toContain("source:   environment overrides are active");
		expect(output).toContain("env:      MODEL_PROVIDER");
	});

	it("lists all active model route environment overrides", () => {
		process.env.MODEL_PROVIDER = "vllm";
		process.env.MODEL_ID = "Qwen3-Coder-480B-A35B-Instruct";
		process.env.MODEL_BASE_URL = "http://127.0.0.1:8000";

		const output = captureCurrentModel();

		expect(output).toContain("source:   environment overrides are active");
		expect(output).toContain("env:      MODEL_PROVIDER, MODEL_ID, MODEL_BASE_URL");
	});

	it("marks persisted scoped routes as identity source", () => {
		const output = captureCurrentModel({
			modelRoutes: { worker: "anthropic/claude-sonnet-4-6" },
		});

		expect(output).toContain("worker:   anthropic/claude-sonnet-4-6");
		expect(output).toContain("source:   ~/.refarm/identity.json");
		expect(output).not.toContain("source:   built-in defaults");
	});
});
