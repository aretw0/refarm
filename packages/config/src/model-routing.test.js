import { describe, expect, it } from "vitest";
import {
    DEFAULT_MODEL_PROVIDER,
    defaultProviderModelId,
    defaultProviderModelRef,
    effectiveModelRouteForScope,
    defaultModelForProvider,
    defaultModelForScope,
    defaultScopedModelRef,
    formatModelRef,
    hasUsableModelCredential,
    hasUsableModelCredentialSource,
    inferProviderFromModelId,
    isModelProvider,
    isModelScope,
    modelCredentialStatus,
    modelCredentialEnvKey,
    modelCredentialSource,
    modelOAuthCredential,
    modelRouteTokenUpdate,
    parseModelScope,
    parseModelRef,
} from "./model-routing.js";

describe("model routing config", () => {
    it("exposes the shared default provider", () => {
        expect(DEFAULT_MODEL_PROVIDER).toBe("openai");
    });

    it("resolves provider defaults used by refarm runtimes", () => {
        expect(defaultModelForProvider("openai")).toBe("gpt-5.5");
        expect(defaultModelForProvider("anthropic")).toBe("claude-sonnet-4-6");
        expect(defaultModelForProvider("groq")).toBe("llama-3.3-70b-versatile");
        expect(defaultModelForProvider("mistral")).toBe("mistral-medium-3-5");
        expect(defaultModelForProvider("gemini")).toBe("gemini-3-flash-preview");
        expect(defaultModelForProvider("xai")).toBe("grok-4.3");
        expect(defaultModelForProvider("deepseek")).toBe("deepseek-v4-flash");
        expect(defaultModelForProvider("together")).toBe("meta-llama/Llama-3.3-70B-Instruct-Turbo");
        expect(defaultModelForProvider("openrouter")).toBe("anthropic/claude-sonnet-4.6");
        expect(defaultModelForProvider("ollama")).toBe("llama3.2");
    });

    it("uses a separate OpenAI worker route", () => {
        expect(defaultModelForScope("openai", "worker")).toBe("gpt-5.3-codex-spark");
        expect(defaultModelForScope("gemini", "worker")).toBe("gemini-3-flash-preview");
    });

    it("resolves effective model routes by scope", () => {
        expect(effectiveModelRouteForScope({ modelProvider: "openai" }, "default", { env: {} })).toEqual({
            provider: "openai",
            modelId: "gpt-5.5",
        });
        expect(effectiveModelRouteForScope({ modelProvider: "openai" }, "worker", { env: {} })).toEqual({
            provider: "openai",
            modelId: "gpt-5.3-codex-spark",
        });
        expect(
            effectiveModelRouteForScope(
                {
                    modelProvider: "openai",
                    modelId: "gpt-5.5",
                    modelRoutes: { worker: "anthropic/claude-sonnet-4-6" },
                },
                "worker",
                { env: {} },
            ),
        ).toEqual({
            provider: "anthropic",
            modelId: "claude-sonnet-4-6",
        });
    });

    it("lets operator env override stored scoped model routes", () => {
        expect(
            effectiveModelRouteForScope(
                {
                    modelProvider: "openai",
                    modelId: "gpt-5.5",
                    modelRoutes: { worker: "openai/gpt-5.3-codex-spark" },
                },
                "worker",
                {
                    env: {
                        MODEL_PROVIDER: "gemini",
                    },
                },
            ),
        ).toEqual({
            provider: "gemini",
            modelId: "gemini-3-flash-preview",
        });
    });

    it("does not reuse a stored model id when an env provider override changes provider", () => {
        expect(
            effectiveModelRouteForScope(
                {
                    modelProvider: "openai",
                    modelId: "gpt-5.5",
                },
                "default",
                {
                    env: {
                        MODEL_PROVIDER: "gemini",
                    },
                },
            ),
        ).toEqual({
            provider: "gemini",
            modelId: "gemini-3-flash-preview",
        });
    });

    it("formats default provider and scoped model refs", () => {
        expect(defaultProviderModelRef("openai")).toBe("openai/gpt-5.5");
        expect(defaultProviderModelId("ollama")).toBe("llama3.2");
        expect(defaultScopedModelRef("worker", "openai")).toBe("openai/gpt-5.3-codex-spark");
        expect(formatModelRef(undefined, undefined)).toBe("<not configured>");
    });

    it("builds default model route token updates", () => {
        expect(
            modelRouteTokenUpdate("default", { provider: "openai", modelId: "gpt-5.5" }, {}),
        ).toEqual({
            modelProvider: "openai",
            modelId: "gpt-5.5",
        });
        expect(
            modelRouteTokenUpdate(
                "default",
                { provider: "openai", modelId: "gpt-5.5" },
                {
                    modelProvider: "anthropic",
                    modelApiKey: "sk-old",
                    oauthProvider: "anthropic",
                },
            ),
        ).toEqual({
            modelProvider: "openai",
            modelId: "gpt-5.5",
            modelApiKey: undefined,
            oauthProvider: undefined,
        });
    });

    it("builds scoped model route token updates", () => {
        expect(
            modelRouteTokenUpdate(
                "worker",
                { provider: "openai", modelId: "gpt-5.3-codex-spark" },
                { modelProvider: "openai", modelId: "gpt-5.5" },
            ),
        ).toEqual({
            modelProvider: "openai",
            modelId: "gpt-5.5",
            modelRoutes: { worker: "openai/gpt-5.3-codex-spark" },
        });
        expect(
            modelRouteTokenUpdate(
                "monitor",
                { provider: "anthropic", modelId: "claude-sonnet-4-6" },
                { modelProvider: "openai", modelId: "gpt-5.5", modelRoutes: { worker: "openai/gpt-5.3-codex-spark" } },
            ),
        ).toEqual({
            modelProvider: "openai",
            modelId: "gpt-5.5",
            modelRoutes: {
                worker: "openai/gpt-5.3-codex-spark",
                monitor: "anthropic/claude-sonnet-4-6",
            },
        });
    });

    it("infers providers from known model prefixes", () => {
        expect(inferProviderFromModelId("gpt-5.5")).toBe("openai");
        expect(inferProviderFromModelId("claude-sonnet-4-6")).toBe("anthropic");
        expect(inferProviderFromModelId("gemini-3-flash-preview")).toBe("gemini");
        expect(inferProviderFromModelId("grok-4.3")).toBe("xai");
        expect(inferProviderFromModelId("deepseek-v4-flash")).toBe("deepseek");
    });

    it("validates known provider route prefixes", () => {
        expect(isModelProvider("openai")).toBe(true);
        expect(isModelProvider("together")).toBe(true);
        expect(isModelProvider("meta-llama")).toBe(false);
    });

    it("validates known model route scopes", () => {
        expect(isModelScope("default")).toBe(true);
        expect(isModelScope("worker")).toBe(true);
        expect(isModelScope("monitor")).toBe(true);
        expect(isModelScope(" Worker ")).toBe(true);
        expect(parseModelScope(" Monitor ")).toBe("monitor");
        expect(isModelScope("other")).toBe(false);
        expect(parseModelScope("other")).toBeNull();
    });

    it("resolves provider credential env keys", () => {
        expect(modelCredentialEnvKey("openai")).toBe("OPENAI_API_KEY");
        expect(modelCredentialEnvKey("openai-codex")).toBe("OPENAI_API_KEY");
        expect(modelCredentialEnvKey("gemini")).toBe("GEMINI_API_KEY");
        expect(modelCredentialEnvKey("ollama")).toBeUndefined();
        expect(modelCredentialEnvKey("unknown")).toBeUndefined();
    });

    it("reports model credential status", () => {
        expect(
            modelCredentialStatus("openai", {}, { OPENAI_API_KEY: "sk-env" }),
        ).toEqual({ state: "env", envKey: "OPENAI_API_KEY" });
        expect(
            modelCredentialStatus("openai", { modelApiKey: "sk-silo" }, {}),
        ).toEqual({ state: "silo-api-key", envKey: "OPENAI_API_KEY" });
        expect(
            modelCredentialStatus(
                "openai",
                {
                    oauthProvider: "openai-codex",
                    oauthCredentials: { "openai-codex": { access: "token" } },
                },
                {},
            ),
        ).toEqual({
            state: "silo-oauth",
            envKey: "OPENAI_API_KEY",
            oauthProvider: "openai-codex",
        });
        expect(modelCredentialStatus("openai", {}, {})).toEqual({
            state: "missing",
            envKey: "OPENAI_API_KEY",
        });
        expect(modelCredentialStatus("ollama", {}, {})).toEqual({ state: "not-required" });
    });

    it("checks usable model credentials", () => {
        expect(hasUsableModelCredential("openai", {}, {})).toBe(false);
        expect(hasUsableModelCredential("openai", {}, { OPENAI_API_KEY: "sk-env" })).toBe(true);
        expect(hasUsableModelCredential("ollama", {}, {})).toBe(true);
        expect(
            modelOAuthCredential({
                oauthProvider: "openai-codex",
                oauthCredentials: { "openai-codex": { access: "token" } },
            }),
        ).toBe("openai-codex");
    });

    it("does not treat stored credentials as usable for another provider", () => {
        expect(
            modelCredentialStatus(
                "gemini",
                { modelProvider: "openai", modelApiKey: "sk-openai" },
                {},
            ),
        ).toEqual({ state: "missing", envKey: "GEMINI_API_KEY" });
        expect(
            hasUsableModelCredential(
                "gemini",
                { modelProvider: "openai", modelApiKey: "sk-openai" },
                {},
            ),
        ).toBe(false);
    });

    it("normalizes model credential sources with nested tokens", () => {
        expect(
            modelCredentialSource({
                provider: "gemini",
                tokens: { modelProvider: "openai", modelApiKey: "sk-openai" },
            }),
        ).toEqual({
            provider: "gemini",
            tokens: {
                modelProvider: "openai",
                modelApiKey: "sk-openai",
                oauthProvider: undefined,
                oauthCredentials: undefined,
            },
        });
        expect(
            modelCredentialSource({
                tokens: { modelProvider: "openai", modelApiKey: "sk-openai" },
            }),
        ).toEqual({
            provider: "openai",
            tokens: {
                modelProvider: "openai",
                modelApiKey: "sk-openai",
                oauthProvider: undefined,
                oauthCredentials: undefined,
            },
        });
    });

    it("checks usable model credential sources without leaking credentials across providers", () => {
        expect(
            hasUsableModelCredentialSource({
                provider: "gemini",
                tokens: { modelProvider: "openai", modelApiKey: "sk-openai" },
            }, {}),
        ).toBe(false);
        expect(
            hasUsableModelCredentialSource({
                default_provider: "openai",
                modelApiKey: "sk-openai",
            }, {}),
        ).toBe(true);
        expect(
            hasUsableModelCredentialSource({
                tokens: { modelProvider: "ollama" },
            }, {}),
        ).toBe(true);
    });

    it("can evaluate credential status without a Node process global", () => {
        const originalProcess = globalThis.process;
        try {
            Reflect.deleteProperty(globalThis, "process");
            expect(modelCredentialStatus("openai", {}, {})).toEqual({
                state: "missing",
                envKey: "OPENAI_API_KEY",
            });
            expect(hasUsableModelCredential("ollama")).toBe(true);
        } finally {
            globalThis.process = originalProcess;
        }
    });

    it("parses known provider/model refs with nested model ids", () => {
        expect(
            parseModelRef("together/meta-llama/Llama-3.3-70B-Instruct-Turbo", undefined),
        ).toEqual({
            provider: "together",
            modelId: "meta-llama/Llama-3.3-70B-Instruct-Turbo",
        });
        expect(
            parseModelRef("openrouter/anthropic/claude-sonnet-4.6", undefined),
        ).toEqual({
            provider: "openrouter",
            modelId: "anthropic/claude-sonnet-4.6",
        });
    });

    it("treats any explicit slash as provider/model for custom providers", () => {
        expect(
            parseModelRef("vllm/Qwen3-Coder-480B-A35B-Instruct", "openai"),
        ).toEqual({
            provider: "vllm",
            modelId: "Qwen3-Coder-480B-A35B-Instruct",
        });
    });
});
