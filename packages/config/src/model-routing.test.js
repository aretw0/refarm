import { describe, expect, it } from "vitest";
import {
    defaultModelForProvider,
    defaultModelForScope,
    inferProviderFromModelId,
    isModelScope,
} from "./model-routing.js";

describe("model routing config", () => {
    it("resolves provider defaults used by refarm runtimes", () => {
        expect(defaultModelForProvider("openai")).toBe("gpt-5.5");
        expect(defaultModelForProvider("anthropic")).toBe("claude-sonnet-4-20250514");
        expect(defaultModelForProvider("mistral")).toBe("mistral-medium-3-5");
        expect(defaultModelForProvider("gemini")).toBe("gemini-3-flash-preview");
        expect(defaultModelForProvider("xai")).toBe("grok-4.3");
        expect(defaultModelForProvider("deepseek")).toBe("deepseek-v4-flash");
        expect(defaultModelForProvider("ollama")).toBe("llama3.2");
    });

    it("uses a separate OpenAI worker route", () => {
        expect(defaultModelForScope("openai", "worker")).toBe("gpt-5.3-codex-spark");
        expect(defaultModelForScope("gemini", "worker")).toBe("gemini-3-flash-preview");
    });

    it("infers providers from known model prefixes", () => {
        expect(inferProviderFromModelId("gpt-5.5")).toBe("openai");
        expect(inferProviderFromModelId("claude-sonnet-4-20250514")).toBe("anthropic");
        expect(inferProviderFromModelId("gemini-3-flash-preview")).toBe("gemini");
        expect(inferProviderFromModelId("grok-4.3")).toBe("xai");
        expect(inferProviderFromModelId("deepseek-v4-flash")).toBe("deepseek");
    });

    it("validates known model route scopes", () => {
        expect(isModelScope("default")).toBe(true);
        expect(isModelScope("worker")).toBe(true);
        expect(isModelScope("monitor")).toBe(true);
        expect(isModelScope("other")).toBe(false);
    });
});
