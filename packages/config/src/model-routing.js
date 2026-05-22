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

export const MODEL_CREDENTIAL_ENV_KEYS = {
    openai: "OPENAI_API_KEY",
    "openai-codex": "OPENAI_API_KEY",
    anthropic: "ANTHROPIC_API_KEY",
    groq: "GROQ_API_KEY",
    mistral: "MISTRAL_API_KEY",
    gemini: "GEMINI_API_KEY",
    xai: "XAI_API_KEY",
    deepseek: "DEEPSEEK_API_KEY",
    together: "TOGETHER_API_KEY",
    openrouter: "OPENROUTER_API_KEY",
};

export function modelCredentialEnvKey(provider) {
    return MODEL_CREDENTIAL_ENV_KEYS[provider?.trim().toLowerCase()];
}

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

export function defaultProviderModelRef(provider = DEFAULT_MODEL_PROVIDER) {
    return formatModelRef(provider, defaultModelForProvider(provider));
}

export function defaultProviderModelId(provider = DEFAULT_MODEL_PROVIDER) {
    return defaultModelForProvider(provider) ?? provider;
}

export function defaultModelForScope(provider, scope) {
    const normalized = provider?.trim().toLowerCase();
    if (scope === "worker" && normalized === "openai") {
        return "gpt-5.3-codex-spark";
    }
    return defaultModelForProvider(provider);
}

export function defaultScopedModelRef(scope, provider = DEFAULT_MODEL_PROVIDER) {
    return formatModelRef(provider, defaultModelForScope(provider, scope));
}

export function isModelScope(value) {
    return parseModelScope(value) !== null;
}

export function parseModelScope(value) {
    const normalized = value?.trim().toLowerCase();
    return MODEL_SCOPES.includes(normalized) ? normalized : null;
}

export function parseModelRef(value, storedProvider) {
    const ref = value?.trim();
    if (!ref) return null;

    const slash = ref.indexOf("/");
    if (slash > 0 && slash < ref.length - 1) {
        const prefix = ref.slice(0, slash).trim();
        return {
            provider: prefix,
            modelId: ref.slice(slash + 1).trim(),
        };
    }

    return {
        provider: storedProvider ?? inferProviderFromModelId(ref),
        modelId: ref,
    };
}

export function formatModelRef(provider, modelId) {
    const resolvedModel = modelId ?? defaultModelForProvider(provider);
    if (!provider && !resolvedModel) return "<not configured>";
    if (!provider) return resolvedModel ?? "<not configured>";
    if (!resolvedModel) return provider;
    return `${provider}/${resolvedModel}`;
}
