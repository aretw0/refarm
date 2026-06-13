import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { OperatorChannel, SelectPrompt } from "@refarm.dev/prompt-contract-v1";

vi.mock("@refarm.dev/root", () => ({
	isContainer: vi.fn().mockReturnValue(false),
}));

// OAuth flows open browsers — mock them out
vi.mock("./oauth/index.js", () => ({
	anthropicOAuthProvider: {
		id: "anthropic",
		name: "Anthropic",
		usesCallbackServer: true,
		login: vi.fn(),
		getApiKey: vi.fn().mockReturnValue("tok-oauth"),
	},
	openaiCodexOAuthProvider: {
		id: "openai-codex",
		name: "OpenAI Codex",
		usesCallbackServer: true,
		login: vi.fn(),
		getApiKey: vi.fn().mockReturnValue("tok-oauth"),
	},
}));

import { isContainer } from "@refarm.dev/root";
import { anthropicOAuthProvider } from "./oauth/index.js";
import { modelCredentialProvider } from "./model.js";

const mockOAuthLogin = vi.mocked(anthropicOAuthProvider.login);
const mockIsContainer = vi.mocked(isContainer);

function makeCtx(answers: string[]) {
	const queue = [...answers];
	const ask = vi.fn(async (_prompt: unknown) => {
		const answer = queue.shift();
		if (answer === undefined) throw new Error("test operator answer queue exhausted");
		return answer;
	});
	return {
		tryOpenUrl: vi.fn(),
		operator: { ask } as unknown as OperatorChannel,
		ask,
	};
}

function capturedSelectPrompt(ctx: ReturnType<typeof makeCtx>): SelectPrompt {
	return ctx.ask.mock.calls[0]?.[0] as unknown as SelectPrompt;
}

describe("modelCredentialProvider — prompt config", () => {
	let ctx: ReturnType<typeof makeCtx>;

	beforeEach(() => {
		vi.clearAllMocks();
		ctx = makeCtx(["local:ollama"]);
	});

	it("asks through the operator channel", async () => {
		await modelCredentialProvider.collectModel(ctx);
		expect(ctx.ask).toHaveBeenCalledOnce();
		expect(capturedSelectPrompt(ctx).type).toBe("select");
	});

	it("includes all API key providers in choices", async () => {
		await modelCredentialProvider.collectModel(ctx);
		const choices = capturedSelectPrompt(ctx).options;
		const apiIds = choices
			.map((c) => c.value)
			.filter((value) => value.startsWith("api:"))
			.map((value) => value.slice("api:".length));

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
		const choices = capturedSelectPrompt(ctx).options;
		const oauthIds = choices
			.map((c) => c.value)
			.filter((value) => value.startsWith("oauth:"))
			.map((value) => value.slice("oauth:".length));

		expect(oauthIds).toContain("anthropic");
		expect(oauthIds).toContain("openai-codex");
	});

	it("offers OpenAI Codex before other subscription providers", async () => {
		await modelCredentialProvider.collectModel(ctx);
		const choices = capturedSelectPrompt(ctx).options;
		const oauthIds = choices
			.map((c) => c.value)
			.filter((value) => value.startsWith("oauth:"))
			.map((value) => value.slice("oauth:".length));

		expect(oauthIds[0]).toBe("openai-codex");
	});

	it("offers OpenAI API key before other API key providers", async () => {
		await modelCredentialProvider.collectModel(ctx);
		const choices = capturedSelectPrompt(ctx).options;
		const apiIds = choices
			.map((c) => c.value)
			.filter((value) => value.startsWith("api:"))
			.map((value) => value.slice("api:".length));

		expect(apiIds[0]).toBe("openai");
	});

	it("includes Ollama option", async () => {
		await modelCredentialProvider.collectModel(ctx);
		const choices = capturedSelectPrompt(ctx).options;
		const hasOllama = choices.some((c) => c.value === "local:ollama");
		expect(hasOllama).toBe(true);
	});

	it("labels choices by credential tier", async () => {
		await modelCredentialProvider.collectModel(ctx);
		const choices = capturedSelectPrompt(ctx).options;
		expect(choices.some((c) => c.label.startsWith("Subscription - "))).toBe(true);
		expect(choices.some((c) => c.label.startsWith("API key - "))).toBe(true);
		expect(choices.some((c) => c.label.startsWith("Local - "))).toBe(true);
	});
});

describe("modelCredentialProvider — Ollama path", () => {
	let ctx: ReturnType<typeof makeCtx>;

	beforeEach(() => {
		vi.clearAllMocks();
		ctx = makeCtx(["local:ollama"]);
	});

	it("returns provider:ollama and apiKey:null", async () => {
		const result = await modelCredentialProvider.collectModel(ctx);
		expect(result).toEqual({ provider: "ollama", apiKey: null });
	});
});

describe("modelCredentialProvider — API key path", () => {
	let ctx: ReturnType<typeof makeCtx>;

	beforeEach(() => {
		vi.clearAllMocks();
		ctx = makeCtx(["api:openai", "sk-test-key"]);
	});

	it("returns provider id and the pasted key", async () => {
		const result = await modelCredentialProvider.collectModel(ctx);
		expect(result.provider).toBe("openai");
		expect(result.apiKey).toBe("sk-test-key");
		expect(result.oauthCredentials).toBeUndefined();
	});
});

describe("modelCredentialProvider — OAuth container environment", () => {
	const originalEnv = process.env;
	let ctx: ReturnType<typeof makeCtx>;

	beforeEach(() => {
		vi.clearAllMocks();
		process.env = { ...originalEnv };
		ctx = makeCtx(["oauth:anthropic"]);
	});

	afterEach(() => {
		process.env = originalEnv;
		vi.clearAllMocks();
	});

	it("provides onManualCodeInput when provider uses callback server in a container", async () => {
		mockIsContainer.mockReturnValue(true);
		mockOAuthLogin.mockImplementation(async (callbacks) => {
			expect(callbacks.onManualCodeInput).toBeDefined();
			ctx.ask.mockResolvedValueOnce("auth-code-123");
			const code = await callbacks.onManualCodeInput!();
			expect(code).toBe("auth-code-123");
			return { access: "tok", refresh: "ref", expires: Date.now() + 3600_000 };
		});
		await modelCredentialProvider.collectModel(ctx);
	});

	it("uses the callback server with a timeout in a VS Code devcontainer", async () => {
		mockIsContainer.mockReturnValue(true);
		process.env["VSCODE_REMOTE_CONTAINERS_SESSION"] = "test-session";
		mockOAuthLogin.mockImplementation(async (callbacks) => {
			expect(callbacks.skipCallbackServer).toBeUndefined();
			expect(callbacks.onManualCodeInput).toBeUndefined();
			expect(callbacks.callbackTimeoutMs).toBeGreaterThan(0);
			return { access: "tok", refresh: "ref", expires: Date.now() + 3600_000 };
		});
		await modelCredentialProvider.collectModel(ctx);
	});

	it("does not provide onManualCodeInput outside a container", async () => {
		mockIsContainer.mockReturnValue(false);
		mockOAuthLogin.mockImplementation(async (callbacks) => {
			expect(callbacks.onManualCodeInput).toBeUndefined();
			return { access: "tok", refresh: "ref", expires: Date.now() + 3600_000 };
		});
		await modelCredentialProvider.collectModel(ctx);
	});
});
