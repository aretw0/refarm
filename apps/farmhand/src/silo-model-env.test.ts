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
		expect(env.MODEL_ID).toBe("gpt-5.5");
		expect(env.OPENAI_API_KEY).toBe("external");
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
