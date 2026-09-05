import { describe, expect, it, vi } from "vitest";
import { createSiloModelEnvInjector, type SiloModelTokens } from "./silo-model-env.js";

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
		expect(injector.managedEnvKeys()).toEqual(["MODEL_PROVIDER", "MODEL_ID", "OPENAI_API_KEY"]);
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
			accountId: "account-test",
		};
		const injector = createSiloModelEnvInjector({
			store,
			env,
			refreshOAuthToken: vi.fn(async () => refreshed),
		});

		await injector.inject();

		expect(env.MODEL_PROVIDER).toBe("openai-codex");
		expect(env.OPENAI_API_KEY).toBeUndefined();
		expect(env.OPENAI_CODEX_ACCESS_TOKEN).toBe("fresh");
		expect(env.OPENAI_CODEX_ACCOUNT_ID).toBe("account-test");
		expect(store.saveTokens).toHaveBeenCalledWith({
			oauthCredentials: {
				"openai-codex": refreshed,
			},
		});
	});

	it("finds the route's credential even when `oauthProvider` was cleared", async () => {
		// MEASURED ON THE OPERATOR'S NODE, 2026-08-15. `refarm model set` clears `oauthProvider`
		// whenever the provider changes, so after switching back to openai-codex his credential — in
		// the token map the whole time — became unreachable: no credential exported, and nothing said.
		// The pointer duplicated what the credentials already say, and duplicated information can
		// disagree with reality.
		const env: NodeJS.ProcessEnv = {};
		const store = {
			loadTokens: async () => ({
				modelProvider: "openai-codex",
				// oauthProvider deliberately absent, exactly as `model set` leaves it
				oauthCredentials: {
					"openai-codex": { access: "tok", refresh: "r", expires: Date.now() + 60_000 },
				},
			}),
			saveTokens: vi.fn(),
		};
		await createSiloModelEnvInjector({ store, env }).inject();
		expect(env.OPENAI_CODEX_ACCESS_TOKEN).toBe("tok");
	});
});

/**
 * ISS-081 + ISS-140 + ISS-131 tier 3 — provisioning from what the node DECLARED it may spend.
 *
 * Every reader here used to know only the flat token map. `sow` retires that entry when it
 * migrates a credential into Silo's `model` namespace, so on a fully migrated node this injector
 * found nothing to inject and nothing to refresh — while `refarm credential list` named three
 * healthy accounts. The dispatch that still worked was running on a credential injected before the
 * migration and surviving in the daemon's process env.
 */
describe("provisioning declared accounts", () => {
	const account = (
		alias: string,
		provider: string,
		health: "healthy" | "incomplete" = "healthy",
	) => ({
		credentialId: `model-account:${alias.toUpperCase().padEnd(26, "X")}`,
		provider,
		alias,
		identity: { status: "verified" as const, subject: alias },
		secretRef: `model/model-account:${alias.toUpperCase().padEnd(26, "X")}`,
		health,
		revision: "sha256:r",
	});

	const CORP = account("corporativo", "github-copilot");
	const PESSOAL = account("pessoal", "github-copilot");
	const CODEX = account("account-2", "openai-codex");

	function secretStore(entries: Record<string, unknown>) {
		const saved: { namespace: string; id: string; value: string }[] = [];
		return {
			saved,
			load: vi.fn(async (_ns: string, id: string) => entries[id]),
			save: vi.fn(async (namespace: string, id: string, value: string) => {
				saved.push({ namespace, id, value });
				return undefined;
			}),
		};
	}

	const live = (over: Record<string, unknown> = {}) => ({
		access: "TOKEN-LIVE",
		refresh: "ghu_r",
		expires: Date.now() + 3_600_000,
		...over,
	});

	it("injects a NAMESPACED credential the flat map no longer holds", async () => {
		const env: NodeJS.ProcessEnv = {};
		const store = makeStore([{ oauthCredentials: {} }]);
		const secrets = secretStore({ [CODEX.credentialId]: JSON.stringify(live({ accountId: "acc-1" })) });
		const injector = createSiloModelEnvInjector({
			store,
			env,
			secrets,
			accounts: async () => ({ catalog: [CODEX], authorization: { scope: "all" } }),
		});

		await injector.inject();

		expect(env.OPENAI_CODEX_ACCESS_TOKEN).toBe("TOKEN-LIVE");
		expect(env.OPENAI_CODEX_ACCOUNT_ID).toBe("acc-1");
	});

	it("injects NOTHING when the node has declared nothing, which is exactly today's behaviour", async () => {
		// Adoption must be additive: a node that has said nothing keeps its previous provisioning.
		const env: NodeJS.ProcessEnv = {};
		const store = makeStore([{ oauthCredentials: {} }]);
		const secrets = secretStore({ [CODEX.credentialId]: JSON.stringify(live()) });
		const injector = createSiloModelEnvInjector({
			store,
			env,
			secrets,
			accounts: async () => ({ catalog: [CODEX], authorization: { scope: "undeclared" } }),
		});

		await injector.inject();

		expect(env.OPENAI_CODEX_ACCESS_TOKEN).toBeUndefined();
	});

	it("REFUSES a provider with two authorised accounts, and says which collided", async () => {
		// One credential env var per provider is what the host reads. Choosing silently would spend
		// an account the operator did not pick while the record named the other.
		const env: NodeJS.ProcessEnv = {};
		const warnings: string[] = [];
		const store = makeStore([{ oauthCredentials: {} }]);
		const secrets = secretStore({
			[CORP.credentialId]: JSON.stringify(live()),
			[PESSOAL.credentialId]: JSON.stringify(live()),
		});
		const injector = createSiloModelEnvInjector({
			store,
			env,
			secrets,
			warn: (m) => void warnings.push(m),
			accounts: async () => ({ catalog: [CORP, PESSOAL], authorization: { scope: "all" } }),
		});

		await injector.inject();

		expect(env.GITHUB_COPILOT_ACCESS_TOKEN).toBeUndefined();
		expect(warnings.join(" ")).toMatch(/corporativo/u);
		expect(warnings.join(" ")).toMatch(/pessoal/u);
	});

	it("provisions BOTH providers when exactly one account of each is authorised", async () => {
		// The declaration is what resolves the ambiguity: naming one account per provider is what
		// makes a node with several accounts serviceable before the host scopes routes per task.
		const env: NodeJS.ProcessEnv = {};
		const store = makeStore([{ oauthCredentials: {} }]);
		const secrets = secretStore({
			[CORP.credentialId]: JSON.stringify(live({ access: "COPILOT" })),
			[CODEX.credentialId]: JSON.stringify(live({ access: "CODEX" })),
		});
		const injector = createSiloModelEnvInjector({
			store,
			env,
			secrets,
			accounts: async () => ({
				catalog: [CORP, PESSOAL, CODEX],
				authorization: { scope: "declared", accounts: [CORP.credentialId, CODEX.credentialId] },
			}),
		});

		await injector.inject();

		expect(env.GITHUB_COPILOT_ACCESS_TOKEN).toBe("COPILOT");
		expect(env.OPENAI_CODEX_ACCESS_TOKEN).toBe("CODEX");
	});

	it("RENEWS an expired namespaced credential and writes it back where it came from", async () => {
		// ISS-081. The refresh has existed for a year; it could not find the credential to refresh.
		const env: NodeJS.ProcessEnv = {};
		const store = makeStore([{ oauthCredentials: {} }]);
		const secrets = secretStore({
			[CODEX.credentialId]: JSON.stringify({ access: "STALE", refresh: "r", expires: 1 }),
		});
		const refreshed = { access: "FRESH", refresh: "r2", expires: Date.now() + 3_600_000 };
		const injector = createSiloModelEnvInjector({
			store,
			env,
			secrets,
			refreshOAuthToken: vi.fn(async () => refreshed),
			accounts: async () => ({ catalog: [CODEX], authorization: { scope: "all" } }),
		});

		await injector.inject();

		expect(env.OPENAI_CODEX_ACCESS_TOKEN).toBe("FRESH");
		// Back to the NAMESPACED store, never to the flat map — a second copy of a secret the
		// catalog does not describe is exactly what the old code refused to create.
		expect(secrets.saved).toHaveLength(1);
		expect(secrets.saved[0]).toMatchObject({ namespace: "model", id: CODEX.credentialId });
		expect(store.saveTokens).not.toHaveBeenCalled();
	});

	it("does not inject an account whose secret this node cannot read", async () => {
		const env: NodeJS.ProcessEnv = {};
		const store = makeStore([{ oauthCredentials: {} }]);
		const secrets = secretStore({});
		const injector = createSiloModelEnvInjector({
			store,
			env,
			secrets,
			accounts: async () => ({ catalog: [CODEX], authorization: { scope: "all" } }),
		});

		await injector.inject();

		expect(env.OPENAI_CODEX_ACCESS_TOKEN).toBeUndefined();
	});
});
