import { describe, expect, it, vi } from "vitest";
import {
	createSiloModelEnvInjector,
	type SiloModelTokens,
} from "./silo-model-env.js";

function makeStore(sequence: SiloModelTokens[]) {
	let index = 0;
	return {
		loadTokens: vi.fn(async () => sequence[Math.min(index++, sequence.length - 1)] ?? {}),
		saveTokens: vi.fn(async () => ({})),
	};
}

describe("createSiloModelEnvInjector", () => {
	it("injects Silo API key credentials into an empty env", async () => {
		const env: NodeJS.ProcessEnv = {};
		const store = makeStore([
			{ modelProvider: "openai", modelId: "gpt-5.5", modelApiKey: "sk-test" },
		]);
		const injector = createSiloModelEnvInjector({ store, env });

		await injector.inject();

		expect(env.MODEL_PROVIDER).toBe("openai");
		expect(env.MODEL_ID).toBe("gpt-5.5");
		expect(env.OPENAI_API_KEY).toBe("sk-test");
	});

	it("does not override operator-provided env values", async () => {
		const env: NodeJS.ProcessEnv = {
			MODEL_PROVIDER: "anthropic",
			OPENAI_API_KEY: "external",
		};
		const store = makeStore([
			{ modelProvider: "openai", modelId: "gpt-5.5", modelApiKey: "sk-test" },
		]);
		const injector = createSiloModelEnvInjector({ store, env });

		await injector.inject();

		expect(env.MODEL_PROVIDER).toBe("anthropic");
		expect(env.MODEL_ID).toBeUndefined();
		expect(env.OPENAI_API_KEY).toBe("external");
	});

	it("does not turn a default provider override into a stored explicit provider", async () => {
		const env: NodeJS.ProcessEnv = {
			MODEL_DEFAULT_PROVIDER: "gemini",
		};
		const store = makeStore([
			{ modelProvider: "openai", modelId: "gpt-5.5", modelApiKey: "sk-test" },
		]);
		const injector = createSiloModelEnvInjector({ store, env });

		await injector.inject();

		expect(env.MODEL_DEFAULT_PROVIDER).toBe("gemini");
		expect(env.MODEL_PROVIDER).toBeUndefined();
		expect(env.MODEL_ID).toBeUndefined();
		expect(env.OPENAI_API_KEY).toBeUndefined();
	});

	it("does not inject stored credentials when the operator route override uses another provider", async () => {
		const env: NodeJS.ProcessEnv = {
			MODEL_PROVIDER: "gemini",
		};
		const store = makeStore([
			{ modelProvider: "openai", modelId: "gpt-5.5", modelApiKey: "sk-test" },
		]);
		const injector = createSiloModelEnvInjector({ store, env });

		await injector.inject();

		expect(env.MODEL_PROVIDER).toBe("gemini");
		expect(env.MODEL_ID).toBeUndefined();
		expect(env.OPENAI_API_KEY).toBeUndefined();
	});

	it("keeps a stored model id when the operator override matches the stored provider", async () => {
		const env: NodeJS.ProcessEnv = {
			MODEL_DEFAULT_PROVIDER: "openai",
		};
		const store = makeStore([
			{ modelProvider: "openai", modelId: "gpt-5.5", modelApiKey: "sk-test" },
		]);
		const injector = createSiloModelEnvInjector({ store, env });

		await injector.inject();

		expect(env.MODEL_PROVIDER).toBeUndefined();
		expect(env.MODEL_ID).toBe("gpt-5.5");
	});

	it("injects persisted model base URL", async () => {
		const env: NodeJS.ProcessEnv = {};
		const store = makeStore([
			{
				modelProvider: "vllm",
				modelId: "Qwen3-Coder-480B-A35B-Instruct",
				modelBaseUrl: "http://127.0.0.1:8000",
			},
		]);
		const injector = createSiloModelEnvInjector({ store, env });

		await injector.inject();

		expect(env.MODEL_BASE_URL).toBe("http://127.0.0.1:8000");
	});

	it("does not override operator-provided model base URL", async () => {
		const env: NodeJS.ProcessEnv = {
			MODEL_BASE_URL: "http://operator.local",
		};
		const store = makeStore([
			{
				modelProvider: "vllm",
				modelId: "Qwen3-Coder-480B-A35B-Instruct",
				modelBaseUrl: "http://127.0.0.1:8000",
			},
		]);
		const injector = createSiloModelEnvInjector({ store, env });

		await injector.inject();

		expect(env.MODEL_BASE_URL).toBe("http://operator.local");
	});

	it("does not inject stored model base URL when the operator route override uses another provider", async () => {
		const env: NodeJS.ProcessEnv = {
			MODEL_PROVIDER: "openai",
		};
		const store = makeStore([
			{
				modelProvider: "vllm",
				modelId: "Qwen3-Coder-480B-A35B-Instruct",
				modelBaseUrl: "http://127.0.0.1:8000",
			},
		]);
		const injector = createSiloModelEnvInjector({ store, env });

		await injector.inject();

		expect(env.MODEL_PROVIDER).toBe("openai");
		expect(env.MODEL_BASE_URL).toBeUndefined();
	});

	it("injects persisted fallback model route", async () => {
		const env: NodeJS.ProcessEnv = {};
		const store = makeStore([
			{
				modelProvider: "openai",
				modelId: "gpt-5.5",
				modelFallbackProvider: "ollama",
				modelFallbackModelId: "qwen2.5-coder",
			},
		]);
		const injector = createSiloModelEnvInjector({ store, env });

		await injector.inject();

		expect(env.MODEL_FALLBACK_PROVIDER).toBe("ollama");
		expect(env.MODEL_FALLBACK_MODEL_ID).toBe("qwen2.5-coder");
	});

	it("does not override operator-provided fallback model env", async () => {
		const env: NodeJS.ProcessEnv = {
			MODEL_FALLBACK_PROVIDER: "anthropic",
			MODEL_FALLBACK_MODEL_ID: "claude-sonnet-4-6",
		};
		const store = makeStore([
			{
				modelProvider: "openai",
				modelId: "gpt-5.5",
				modelFallbackProvider: "ollama",
				modelFallbackModelId: "qwen2.5-coder",
			},
		]);
		const injector = createSiloModelEnvInjector({ store, env });

		await injector.inject();

		expect(env.MODEL_FALLBACK_PROVIDER).toBe("anthropic");
		expect(env.MODEL_FALLBACK_MODEL_ID).toBe("claude-sonnet-4-6");
	});

	it("does not pair an operator fallback provider with a stored fallback model from another provider", async () => {
		const env: NodeJS.ProcessEnv = {
			MODEL_FALLBACK_PROVIDER: "anthropic",
		};
		const store = makeStore([
			{
				modelProvider: "openai",
				modelId: "gpt-5.5",
				modelFallbackProvider: "ollama",
				modelFallbackModelId: "qwen2.5-coder",
			},
		]);
		const injector = createSiloModelEnvInjector({ store, env });

		await injector.inject();

		expect(env.MODEL_FALLBACK_PROVIDER).toBe("anthropic");
		expect(env.MODEL_FALLBACK_MODEL_ID).toBeUndefined();
	});

	it("updates env values it previously managed when Silo changes at runtime", async () => {
		const env: NodeJS.ProcessEnv = {};
		const store = makeStore([
			{ modelProvider: "openai", modelApiKey: "old-key" },
			{ modelProvider: "openai", modelApiKey: "new-key" },
		]);
		const injector = createSiloModelEnvInjector({ store, env });

		await injector.inject();
		await injector.inject();

		expect(env.OPENAI_API_KEY).toBe("new-key");
	});

	it("clears env values it previously managed when Silo provider changes", async () => {
		const env: NodeJS.ProcessEnv = {};
		const store = makeStore([
			{ modelProvider: "openai", modelApiKey: "old-key" },
			{ modelProvider: "gemini", modelApiKey: "gemini-key" },
		]);
		const injector = createSiloModelEnvInjector({ store, env });

		await injector.inject();
		await injector.inject();

		expect(env.MODEL_PROVIDER).toBe("gemini");
		expect(env.OPENAI_API_KEY).toBeUndefined();
		expect(env.GEMINI_API_KEY).toBe("gemini-key");
	});

	it("refreshes expired OAuth credentials before injecting them", async () => {
		const env: NodeJS.ProcessEnv = {};
		const store = makeStore([
			{
				modelProvider: "openai",
				oauthProvider: "openai-codex",
				oauthCredentials: {
					"openai-codex": {
						access: "expired",
						refresh: "refresh-token",
						expires: Date.now() - 1,
					},
				},
			},
		]);
		const refreshed = {
			access: "fresh",
			refresh: "next-refresh",
			expires: Date.now() + 60_000,
		};
		const injector = createSiloModelEnvInjector({
			store,
			env,
			refreshOAuthToken: vi.fn(async () => refreshed),
		});

		await injector.inject();

		expect(env.OPENAI_API_KEY).toBe("fresh");
		expect(store.saveTokens).toHaveBeenCalledWith({
			oauthCredentials: {
				"openai-codex": refreshed,
			},
		});
	});
});
