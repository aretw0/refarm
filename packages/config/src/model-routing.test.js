import { describe, expect, it } from "vitest";
import {
    DEFAULT_MODEL_PROVIDER,
    defaultProviderModelId,
    defaultProviderModelRef,
    defaultModelForProvider,
    defaultModelForScope,
    defaultScopedModelRef,
    formatModelRef,
    inferProviderFromModelId,
    isModelProvider,
    isModelScope,
    modelCredentialEnvKey,
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

    it("formats default provider and scoped model refs", () => {
        expect(defaultProviderModelRef("openai")).toBe("openai/gpt-5.5");
        expect(defaultProviderModelId("ollama")).toBe("llama3.2");
        expect(defaultScopedModelRef("worker", "openai")).toBe("openai/gpt-5.3-codex-spark");
        expect(formatModelRef(undefined, undefined)).toBe("<not configured>");
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
        expect(isModelScope("other")).toBe(false);
    });

    it("resolves provider credential env keys", () => {
        expect(modelCredentialEnvKey("openai")).toBe("OPENAI_API_KEY");
        expect(modelCredentialEnvKey("openai-codex")).toBe("OPENAI_API_KEY");
        expect(modelCredentialEnvKey("gemini")).toBe("GEMINI_API_KEY");
        expect(modelCredentialEnvKey("ollama")).toBeUndefined();
        expect(modelCredentialEnvKey("unknown")).toBeUndefined();
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
