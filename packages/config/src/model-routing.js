export const MODEL_SCOPES = ["default", "worker", "monitor"];
export const DEFAULT_MODEL_PROVIDER = "openai";
export const MODEL_PROVIDERS = [
    "openai",
    "anthropic",
    "ollama",
    "groq",
    "mistral",
    "gemini",
    "xai",
    "deepseek",
    "together",
    "openrouter",
];

export function inferProviderFromModelId(modelId) {
    const normalized = modelId.trim().toLowerCase();
    if (normalized.startsWith("gpt-") || normalized.startsWith("o")) return "openai";
    if (normalized.startsWith("claude-")) return "anthropic";
    if (normalized.startsWith("grok-")) return "xai";
    if (normalized.startsWith("gemini-")) return "gemini";
    if (normalized.startsWith("mistral-")) return "mistral";
    if (normalized.startsWith("deepseek-")) return "deepseek";
    return undefined;
}

export function defaultModelForProvider(provider) {
    switch (provider?.trim().toLowerCase()) {
        case "openai":
            return "gpt-5.5";
        case "anthropic":
            return "claude-sonnet-4-6";
        case "groq":
            return "llama-3.3-70b-versatile";
        case "ollama":
            return "llama3.2";
        case "mistral":
            return "mistral-medium-3-5";
        case "gemini":
            return "gemini-3-flash-preview";
        case "xai":
            return "grok-4.3";
        case "deepseek":
            return "deepseek-v4-flash";
        case "together":
            return "meta-llama/Llama-3.3-70B-Instruct-Turbo";
        case "openrouter":
            return "anthropic/claude-sonnet-4.6";
        default:
            return undefined;
    }
}

export function isModelProvider(value) {
    return MODEL_PROVIDERS.includes(value?.trim().toLowerCase());
}

export function defaultModelForScope(provider, scope) {
    const normalized = provider?.trim().toLowerCase();
    if (scope === "worker" && normalized === "openai") {
        return "gpt-5.3-codex-spark";
    }
    return defaultModelForProvider(provider);
}

export function isModelScope(value) {
    return MODEL_SCOPES.includes(value);
}
