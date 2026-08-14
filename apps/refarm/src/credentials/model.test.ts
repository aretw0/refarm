import { ambientActivitySink, type ProcessActivity } from "@refarm.dev/capabilities";
import type { OperatorChannel, SelectPrompt } from "@refarm.dev/prompt-contract-v1";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@refarm.dev/root", () => ({
	isContainer: vi.fn().mockReturnValue(false),
}));

// OAuth flows open browsers — mock them out
vi.mock("./oauth/index.js", () => ({
	// The Copilot provider is a FACTORY, not a singleton — it needs refarm's client id and a fetch.
	// The mock returns a stub with the same shape so the inventory includes `github-copilot`.
	createGitHubCopilotProvider: () => ({
		id: "github-copilot",
		name: "GitHub Copilot",
		usesCallbackServer: false,
		login: vi.fn(),
		refreshToken: vi.fn(),
		getApiKey: vi.fn().mockReturnValue("tok-copilot"),
	}),
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
import { modelCredentialProvider } from "./model.js";
import { anthropicOAuthProvider } from "./oauth/index.js";

const mockOAuthLogin = vi.mocked(anthropicOAuthProvider.login);
const mockIsContainer = vi.mocked(isContainer);

/** Subscribe to the ambient activity sink for the duration of one test, collecting
 * every event. `model.ts` always emits on the ambient sink (no sink injection point
 * in the `CredentialProvider` API), so this is how a caller observes it — the same
 * shape the CLI's own activity subscriber uses in production. */
function collectActivity(): { events: ProcessActivity[]; stop: () => void } {
	const events: ProcessActivity[] = [];
	const unsubscribe = ambientActivitySink.subscribe((e) => events.push(e));
	return { events, stop: unsubscribe };
}

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
			"anthropic",
			"openai",
			"groq",
			"mistral",
			"gemini",
			"xai",
			"deepseek",
			"together",
			"openrouter",
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
		delete process.env["REFARM_DEVCONTAINER"];
		delete process.env["VSCODE_REMOTE_CONTAINERS_SESSION"];
		delete process.env["REMOTE_CONTAINERS"];
		delete process.env["CODESPACES"];
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
			expect(callbacks.onCallbackWait).toBeDefined();
			return { access: "tok", refresh: "ref", expires: Date.now() + 3600_000 };
		});
		await modelCredentialProvider.collectModel(ctx);
	});

	it("uses the callback server when the Refarm devcontainer flag is set", async () => {
		mockIsContainer.mockReturnValue(true);
		process.env["REFARM_DEVCONTAINER"] = "true";
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

	it("emits activity started → progress → finished{ok:true} around the OAuth exchange", async () => {
		mockIsContainer.mockReturnValue(false);
		const activity = collectActivity();
		mockOAuthLogin.mockImplementation(async (callbacks) => {
			callbacks.onProgress?.("Exchanging code for tokens...");
			return { access: "tok", refresh: "ref", expires: Date.now() + 3600_000 };
		});

		await modelCredentialProvider.collectModel(ctx);
		activity.stop();

		expect(activity.events.map((e) => e.phase)).toEqual(["started", "progress", "finished"]);
		expect(activity.events[0]).toMatchObject({ kind: "auth", label: "Signing in to Anthropic" });
		expect(activity.events[1]).toMatchObject({
			phase: "progress",
			note: "Exchanging code for tokens...",
		});
		expect(activity.events[2]).toMatchObject({ phase: "finished", ok: true });
		// Every event of one login correlates to the same unit of work.
		expect(activity.events[0]!.activityRef).toBe(activity.events[2]!.activityRef);
	});

	it("emits finished{ok:false} and rethrows when the OAuth provider login fails", async () => {
		mockIsContainer.mockReturnValue(false);
		const activity = collectActivity();
		const failure = new Error("network unreachable");
		mockOAuthLogin.mockImplementation(async () => {
			throw failure;
		});

		await expect(modelCredentialProvider.collectModel(ctx)).rejects.toThrow(failure);
		activity.stop();

		// The activity must still FINISH on failure — an activity that never finishes
		// leaves every subscriber (CLI spinner, TUI line, a future mesh pill) spinning
		// forever, which is exactly the operator-visible gap this change closes.
		expect(activity.events.map((e) => e.phase)).toEqual(["started", "finished"]);
		expect(activity.events[1]).toMatchObject({ phase: "finished", ok: false });
	});

	it("prints callback wait status so devcontainer login is not silent", async () => {
		mockIsContainer.mockReturnValue(true);
		process.env["VSCODE_REMOTE_CONTAINERS_SESSION"] = "test-session";
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		mockOAuthLogin.mockImplementation(async (callbacks) => {
			callbacks.onCallbackWait?.({
				phase: "callback-waiting",
				message: "Waiting for browser callback for up to 120s.",
				timeoutMs: 120_000,
				callbackUrl: "http://127.0.0.1:1455/auth/callback",
			});
			callbacks.onCallbackWait?.({
				phase: "callback-heartbeat",
				message: "Still waiting for browser callback (15s elapsed of 120s).",
				elapsedMs: 15_000,
				timeoutMs: 120_000,
			});
			callbacks.onCallbackWait?.({
				phase: "callback-timeout",
				message: "No browser callback received after 120s; switching to pasted redirect URL.",
				elapsedMs: 120_000,
				timeoutMs: 120_000,
			});
			return { access: "tok", refresh: "ref", expires: Date.now() + 3600_000 };
		});

		await modelCredentialProvider.collectModel(ctx);

		const output = logSpy.mock.calls.map((call) => String(call[0])).join("\n");
		expect(output).toContain("Waiting for browser callback");
		expect(output).toContain("callback: http://127.0.0.1:1455/auth/callback");
		expect(output).toContain("VS Code/Codespaces must forward");
		expect(output).toContain("15s elapsed");
		expect(output).toContain("switching to pasted redirect URL");
	});
});
