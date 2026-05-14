import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock inquirer before the module loads so collectModel never blocks on TTY
vi.mock("inquirer", () => {
	class MockSeparator {
		type = "separator" as const;
		separator: string;
		constructor(text: string) {
			this.separator = text;
		}
	}
	const prompt = vi.fn();
	return {
		default: { prompt, Separator: MockSeparator },
	};
});

// secretInput would block on TTY — mock it to resolve immediately
vi.mock("../prompts/secret-input.js", () => ({
	secretInput: vi.fn().mockResolvedValue("sk-test-key"),
}));

// OAuth flows open browsers — mock them out
vi.mock("./oauth/index.js", () => ({
	anthropicOAuthProvider: {
		id: "anthropic",
		name: "Anthropic",
		login: vi.fn(),
		getApiKey: vi.fn().mockReturnValue("tok-oauth"),
	},
	openaiCodexOAuthProvider: {
		id: "openai-codex",
		name: "OpenAI Codex",
		login: vi.fn(),
		getApiKey: vi.fn().mockReturnValue("tok-oauth"),
	},
}));

import inquirer from "inquirer";
import { modelCredentialProvider } from "./model.js";

const mockPrompt = vi.mocked(inquirer.prompt as (...args: unknown[]) => Promise<unknown>);

function capturedPromptConfig() {
	const [[questions]] = mockPrompt.mock.calls as [unknown[]][][];
	return (questions as Array<{ type: string; choices: unknown[] }>)[0];
}

describe("modelCredentialProvider — prompt config", () => {
	const ctx = { tryOpenUrl: vi.fn() };

	beforeEach(() => {
		vi.clearAllMocks();
		// Default: user picks Ollama so we don't need extra mocks
		mockPrompt.mockResolvedValue({ choice: { kind: "ollama" } });
	});

	it("uses type:select (not type:list — inquirer v13 dropped list)", async () => {
		await modelCredentialProvider.collectModel(ctx);
		expect(capturedPromptConfig().type).toBe("select");
	});

	it("includes all API key providers in choices", async () => {
		await modelCredentialProvider.collectModel(ctx);
		const choices = capturedPromptConfig().choices;
		const apiIds = choices
			.filter((c): c is { value: { kind: "api"; id: string } } =>
				typeof c === "object" && c !== null && (c as { value?: { kind?: string } }).value?.kind === "api",
			)
			.map((c) => c.value.id);

		const expectedProviders = [
			"anthropic", "openai", "groq", "mistral",
			"gemini", "xai", "deepseek", "together", "openrouter",
		];
		for (const id of expectedProviders) {
			expect(apiIds, `API provider "${id}" missing from choices`).toContain(id);
		}
	});

	it("includes OAuth providers in choices", async () => {
		await modelCredentialProvider.collectModel(ctx);
		const choices = capturedPromptConfig().choices;
		const oauthIds = choices
			.filter((c): c is { value: { kind: "oauth"; id: string } } =>
				typeof c === "object" && c !== null && (c as { value?: { kind?: string } }).value?.kind === "oauth",
			)
			.map((c) => c.value.id);

		expect(oauthIds).toContain("anthropic");
		expect(oauthIds).toContain("openai-codex");
	});

	it("includes Ollama option", async () => {
		await modelCredentialProvider.collectModel(ctx);
		const choices = capturedPromptConfig().choices;
		const hasOllama = choices.some(
			(c) => typeof c === "object" && c !== null && (c as { value?: { kind?: string } }).value?.kind === "ollama",
		);
		expect(hasOllama).toBe(true);
	});

	it("includes Separator items for visual grouping", async () => {
		await modelCredentialProvider.collectModel(ctx);
		const choices = capturedPromptConfig().choices;
		const separators = choices.filter(
			(c) => typeof c === "object" && c !== null && (c as { type?: string }).type === "separator",
		);
		expect(separators.length).toBeGreaterThanOrEqual(3);
	});
});

describe("modelCredentialProvider — Ollama path", () => {
	const ctx = { tryOpenUrl: vi.fn() };

	beforeEach(() => vi.clearAllMocks());

	it("returns provider:ollama and apiKey:null", async () => {
		mockPrompt.mockResolvedValue({ choice: { kind: "ollama" } });
		const result = await modelCredentialProvider.collectModel(ctx);
		expect(result).toEqual({ provider: "ollama", apiKey: null });
	});
});

describe("modelCredentialProvider — API key path", () => {
	const ctx = { tryOpenUrl: vi.fn() };

	beforeEach(() => vi.clearAllMocks());

	it("returns provider id and the pasted key", async () => {
		mockPrompt.mockResolvedValue({ choice: { kind: "api", id: "openai" } });
		const result = await modelCredentialProvider.collectModel(ctx);
		expect(result.provider).toBe("openai");
		expect(result.apiKey).toBe("sk-test-key");
		expect(result.oauthCredentials).toBeUndefined();
	});
});
