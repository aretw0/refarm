export const MODEL_SCOPES = ["default", "worker", "monitor"];
export const DEFAULT_MODEL_PROVIDER = "openai";
export const MODEL_PROVIDER_ENV_VAR = "MODEL_PROVIDER";
export const MODEL_DEFAULT_PROVIDER_ENV_VAR = "MODEL_DEFAULT_PROVIDER";
export const MODEL_ID_ENV_VAR = "MODEL_ID";
export const MODEL_BASE_URL_ENV_VAR = "MODEL_BASE_URL";
export const MODEL_FALLBACK_PROVIDER_ENV_VAR = "MODEL_FALLBACK_PROVIDER";
export const MODEL_FALLBACK_MODEL_ID_ENV_VAR = "MODEL_FALLBACK_MODEL_ID";
export const MODEL_ROUTE_ENV_VARS = [
    MODEL_PROVIDER_ENV_VAR,
    MODEL_DEFAULT_PROVIDER_ENV_VAR,
    MODEL_ID_ENV_VAR,
];
export const MODEL_RUNTIME_ENV_VARS = [
    ...MODEL_ROUTE_ENV_VARS,
    MODEL_BASE_URL_ENV_VAR,
    MODEL_FALLBACK_PROVIDER_ENV_VAR,
    MODEL_FALLBACK_MODEL_ID_ENV_VAR,
];
export const MODEL_PROVIDERS = [
    "openai",
    "openai-codex",
    "github-copilot",
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
export const SUBSCRIPTION_MODEL_PROVIDERS = [
    "openai-codex",
    "github-copilot",
];

export const MODEL_CREDENTIAL_ENV_KEYS = {
    openai: "OPENAI_API_KEY",
    "openai-codex": "OPENAI_CODEX_ACCESS_TOKEN",
    "github-copilot": "GITHUB_COPILOT_ACCESS_TOKEN",
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

function stringValue(value) {
    return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function defaultEnv() {
    return typeof process !== "undefined" && process?.env ? process.env : {};
}

function objectValue(value) {
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

export function modelCredentialSource(source = {}) {
    const root = objectValue(source);
    const nested = objectValue(root.tokens);
    const provider =
        stringValue(root.provider) ??
        stringValue(root.default_provider) ??
        stringValue(root.modelProvider) ??
        stringValue(nested.modelProvider);

    return {
        provider,
        tokens: {
            modelProvider: root.modelProvider ?? nested.modelProvider,
            modelApiKey: root.modelApiKey ?? nested.modelApiKey,
            oauthProvider: root.oauthProvider ?? nested.oauthProvider,
            oauthCredentials: root.oauthCredentials ?? nested.oauthCredentials,
        },
    };
}

export function modelOAuthCredential(tokens = {}) {
    const oauthProvider = stringValue(tokens.oauthProvider);
    if (!oauthProvider || !tokens.oauthCredentials || typeof tokens.oauthCredentials !== "object") {
        return undefined;
    }
    return tokens.oauthCredentials[oauthProvider] ? oauthProvider : undefined;
}

export function modelCredentialStatus(provider, tokens = {}, env = defaultEnv()) {
    const credentialEnv = modelCredentialEnvKey(provider);
    if (!credentialEnv) return { state: "not-required" };
    if (stringValue(env?.[credentialEnv])) {
        return { state: "env", envKey: credentialEnv };
    }
    const tokenProvider = stringValue(tokens.modelProvider)?.toLowerCase();
    const normalizedProvider = provider?.trim().toLowerCase();
    if (tokenProvider && tokenProvider !== normalizedProvider) {
        return { state: "missing", envKey: credentialEnv };
    }
    if (stringValue(tokens.modelApiKey)) {
        return { state: "silo-api-key", envKey: credentialEnv };
    }
    const oauthProvider = modelOAuthCredential(tokens);
    if (oauthProvider && (!normalizedProvider || oauthProvider.toLowerCase() === normalizedProvider)) {
        return { state: "silo-oauth", envKey: credentialEnv, oauthProvider };
    }
    return { state: "missing", envKey: credentialEnv };
}

export function hasUsableModelCredential(provider, tokens = {}, env = defaultEnv()) {
    const status = modelCredentialStatus(provider, tokens, env);
    return status.state !== "missing";
}

export function hasUsableModelCredentialSource(source = {}, env = defaultEnv()) {
    const credentialSource = modelCredentialSource(source);
    if (!credentialSource.provider) return false;
    return hasUsableModelCredential(credentialSource.provider, credentialSource.tokens, env);
}

export function inferProviderFromModelId(modelId) {
    const normalized = modelId.trim().toLowerCase();
    if (normalized.includes("codex")) return "openai-codex";
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
        case "openai-codex":
            return "gpt-5.5";
        case "github-copilot":
            return "gpt-4o";
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

export function isSubscriptionModelProvider(value) {
    return SUBSCRIPTION_MODEL_PROVIDERS.includes(value?.trim().toLowerCase());
}

export function defaultProviderModelRef(provider = DEFAULT_MODEL_PROVIDER) {
    return formatModelRef(provider, defaultModelForProvider(provider));
}

export function defaultProviderModelId(provider = DEFAULT_MODEL_PROVIDER) {
    return defaultModelForProvider(provider) ?? provider;
}

export function defaultModelForScope(provider, scope) {
    const normalized = provider?.trim().toLowerCase();
    if (scope === "worker" && (normalized === "openai" || normalized === "openai-codex")) {
        return "gpt-5.3-codex-spark";
    }
    return defaultModelForProvider(provider);
}

export function defaultScopedModelRef(scope, provider = DEFAULT_MODEL_PROVIDER) {
    return formatModelRef(provider, defaultModelForScope(provider, scope));
}

export function modelRouteTokenUpdate(scope, modelRef, tokens = {}) {
    if (scope === "default") {
        const storedProvider = stringValue(tokens.modelProvider)?.toLowerCase();
        const nextProvider = stringValue(modelRef.provider)?.toLowerCase();
        const providerChanged =
            storedProvider !== undefined &&
            nextProvider !== undefined &&
            storedProvider !== nextProvider;
        return {
            modelProvider: modelRef.provider,
            modelId: modelRef.modelId,
            ...(providerChanged ? { modelApiKey: undefined, oauthProvider: undefined } : {}),
        };
    }
    const provider = stringValue(tokens.modelProvider) ?? modelRef.provider;
    return {
        modelProvider: provider,
        modelId: stringValue(tokens.modelId) ?? defaultModelForProvider(provider) ?? modelRef.modelId,
        modelRoutes: {
            ...(objectValue(tokens.modelRoutes)),
            [scope]: formatModelRef(modelRef.provider, modelRef.modelId),
        },
    };
}

function parseRouteRef(value, storedProvider) {
    const ref = stringValue(value);
    if (!ref) return null;
    const inferred = parseModelRef(ref, undefined);
    if (inferred?.provider) return inferred;
    return parseModelRef(ref, storedProvider);
}

export function effectiveModelRouteForScope(tokens = {}, scope, { env = defaultEnv() } = {}) {
    const envProvider = stringValue(env[MODEL_PROVIDER_ENV_VAR]);
    const envDefaultProvider = stringValue(env[MODEL_DEFAULT_PROVIDER_ENV_VAR]);
    const envModelId = stringValue(env[MODEL_ID_ENV_VAR]);
    const storedProvider = stringValue(tokens.modelProvider);
    const provider = envProvider ?? envDefaultProvider ?? storedProvider ?? DEFAULT_MODEL_PROVIDER;
    const sameStoredProvider =
        !provider ||
        !storedProvider ||
        provider.trim().toLowerCase() === storedProvider.trim().toLowerCase();
    const storedModelId =
        sameStoredProvider
            ? stringValue(tokens.modelId) ?? stringValue(tokens.model)
            : undefined;
    const defaultModelId =
        envModelId ?? storedModelId;
    if (envProvider || envDefaultProvider || envModelId) {
        return {
            provider,
            modelId: defaultModelId ?? defaultModelForScope(provider, scope),
        };
    }

    if (scope === "default") {
        return {
            provider,
            modelId: defaultModelId ?? defaultModelForScope(provider, scope),
        };
    }

    const routes = objectValue(tokens.modelRoutes);
    const scoped = parseRouteRef(routes[scope], provider);
    if (scoped) return scoped;

    return {
        provider,
        modelId: defaultModelForScope(provider, scope) ?? defaultModelId,
    };
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
