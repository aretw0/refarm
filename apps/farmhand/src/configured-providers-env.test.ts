import { describe, expect, it } from "vitest";

import {
	buildConfiguredProvidersEnv,
	configuredProviders,
	injectConfiguredProvidersEnv,
	MODEL_CONFIGURED_PROVIDERS_ENV_VAR,
} from "./configured-providers-env.js";

describe("configuredProviders — derive the set from credential env vars", () => {
	it("lists a provider when its credential env var is present and non-empty", () => {
		const env = {
			ANTHROPIC_API_KEY: "sk-ant-xxx",
			GROQ_API_KEY: "gsk_yyy",
		} as NodeJS.ProcessEnv;
		expect(configuredProviders(env)).toEqual(["anthropic", "groq"]);
	});

	it("ignores empty / whitespace-only credential values", () => {
		const env = {
			ANTHROPIC_API_KEY: "  ",
			OPENAI_API_KEY: "",
			GEMINI_API_KEY: "AIza-real",
		} as NodeJS.ProcessEnv;
		expect(configuredProviders(env)).toEqual(["gemini"]);
	});

	it("returns an empty list when nothing is configured", () => {
		expect(configuredProviders({} as NodeJS.ProcessEnv)).toEqual([]);
	});
});

describe("buildConfiguredProvidersEnv — the guest-facing list value", () => {
	it("is a comma-separated list of names, never the keys", () => {
		const env = {
			OPENAI_API_KEY: "sk-openai",
			OPENROUTER_API_KEY: "sk-or",
		} as NodeJS.ProcessEnv;
		const value = buildConfiguredProvidersEnv(env);
		expect(value).toBe("openai,openrouter");
		// The value carries names only — no secret material leaks into it.
		expect(value).not.toContain("sk-openai");
		expect(value).not.toContain("sk-or");
	});

	it("is the empty string when nothing is configured", () => {
		expect(buildConfiguredProvidersEnv({} as NodeJS.ProcessEnv)).toBe("");
	});
});

describe("injectConfiguredProvidersEnv — sets MODEL_CONFIGURED_PROVIDERS", () => {
	it("injects the list and reports the count", () => {
		const env = {
			ANTHROPIC_API_KEY: "sk-ant",
			XAI_API_KEY: "xai-key",
		} as NodeJS.ProcessEnv;
		const result = injectConfiguredProvidersEnv(env);
		expect(result.count).toBe(2);
		expect(env[MODEL_CONFIGURED_PROVIDERS_ENV_VAR]).toBe("anthropic,xai");
	});

	it("is a no-op when no provider is configured (guest keeps the ollama floor)", () => {
		const env = {} as NodeJS.ProcessEnv;
		const result = injectConfiguredProvidersEnv(env);
		expect(result.count).toBe(0);
		expect(env[MODEL_CONFIGURED_PROVIDERS_ENV_VAR]).toBeUndefined();
	});
});
