import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock @inquirer/prompts — the select call blocks on TTY without this
vi.mock("@inquirer/prompts", () => {
	class MockSeparator {
		type = "separator" as const;
		separator: string;
		constructor(text: string) {
			this.separator = text;
		}
	}
	return {
		select: vi.fn(),
		Separator: MockSeparator,
	};
});

// inquirer is still used for the OAuth code prompt — keep it mockable
vi.mock("inquirer", () => ({
	default: { prompt: vi.fn() },
}));

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

import { select } from "@inquirer/prompts";
import { modelCredentialProvider } from "./model.js";

const mockSelect = vi.mocked(select<unknown>);

function capturedChoices(): readonly unknown[] {
	const config = mockSelect.mock.calls[0]?.[0] as unknown as { choices: readonly unknown[] };
	return config.choices;
}

describe("modelCredentialProvider — prompt config", () => {
	const ctx = { tryOpenUrl: vi.fn() };

	beforeEach(() => {
		vi.clearAllMocks();
		// Default: user picks Ollama so we don't need extra mocks
		mockSelect.mockResolvedValue({ kind: "ollama" });
	});

	it("calls @inquirer/prompts select directly (not classic inquirer.prompt wrapper)", async () => {
		await modelCredentialProvider.collectModel(ctx);
		expect(mockSelect).toHaveBeenCalledOnce();
	});

	it("includes all API key providers in choices", async () => {
		await modelCredentialProvider.collectModel(ctx);
		const choices = capturedChoices();
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
		const choices = capturedChoices();
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
		const choices = capturedChoices();
		const hasOllama = choices.some(
			(c) => typeof c === "object" && c !== null && (c as { value?: { kind?: string } }).value?.kind === "ollama",
		);
		expect(hasOllama).toBe(true);
	});

	it("includes Separator items for visual grouping", async () => {
		await modelCredentialProvider.collectModel(ctx);
		const choices = capturedChoices();
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
		mockSelect.mockResolvedValue({ kind: "ollama" });
		const result = await modelCredentialProvider.collectModel(ctx);
		expect(result).toEqual({ provider: "ollama", apiKey: null });
	});
});

describe("modelCredentialProvider — API key path", () => {
	const ctx = { tryOpenUrl: vi.fn() };

	beforeEach(() => vi.clearAllMocks());

	it("returns provider id and the pasted key", async () => {
		mockSelect.mockResolvedValue({ kind: "api", id: "openai" });
		const result = await modelCredentialProvider.collectModel(ctx);
		expect(result.provider).toBe("openai");
		expect(result.apiKey).toBe("sk-test-key");
		expect(result.oauthCredentials).toBeUndefined();
	});
});
