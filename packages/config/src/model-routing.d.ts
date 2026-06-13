export type ModelScope = "default" | "worker" | "monitor";

export const MODEL_SCOPES: readonly ModelScope[];
export const DEFAULT_MODEL_PROVIDER: string;
export const MODEL_PROVIDER_ENV_VAR: "MODEL_PROVIDER";
export const MODEL_DEFAULT_PROVIDER_ENV_VAR: "MODEL_DEFAULT_PROVIDER";
export const MODEL_ID_ENV_VAR: "MODEL_ID";
export const MODEL_BASE_URL_ENV_VAR: "MODEL_BASE_URL";
export const MODEL_FALLBACK_PROVIDER_ENV_VAR: "MODEL_FALLBACK_PROVIDER";
export const MODEL_FALLBACK_MODEL_ID_ENV_VAR: "MODEL_FALLBACK_MODEL_ID";
export const MODEL_ROUTE_ENV_VARS: readonly [
    typeof MODEL_PROVIDER_ENV_VAR,
    typeof MODEL_DEFAULT_PROVIDER_ENV_VAR,
    typeof MODEL_ID_ENV_VAR,
];
export const MODEL_RUNTIME_ENV_VARS: readonly [
    typeof MODEL_PROVIDER_ENV_VAR,
    typeof MODEL_DEFAULT_PROVIDER_ENV_VAR,
    typeof MODEL_ID_ENV_VAR,
    typeof MODEL_BASE_URL_ENV_VAR,
    typeof MODEL_FALLBACK_PROVIDER_ENV_VAR,
    typeof MODEL_FALLBACK_MODEL_ID_ENV_VAR,
];
export const MODEL_PROVIDERS: readonly string[];
export const MODEL_CREDENTIAL_ENV_KEYS: Readonly<Record<string, string>>;

export interface ModelRef {
    provider?: string;
    modelId: string;
}

export interface ResolvedModelRef {
    provider: string;
    modelId: string;
}

export interface ModelCredentialTokens {
    modelProvider?: unknown;
    modelApiKey?: unknown;
    oauthProvider?: unknown;
    oauthCredentials?: unknown;
}

export interface ModelRouteTokens extends ModelCredentialTokens {
    modelId?: unknown;
    model?: unknown;
    modelRoutes?: unknown;
}

export interface EffectiveModelRoute {
    provider?: string;
    modelId?: string;
}

export interface ModelCredentialSource {
    provider?: string;
    tokens: ModelCredentialTokens;
}

export type ModelCredentialStatus =
    | { state: "not-required" }
    | { state: "env"; envKey: string }
    | { state: "silo-api-key"; envKey: string }
    | { state: "silo-oauth"; envKey: string; oauthProvider: string }
    | { state: "missing"; envKey: string };

export function inferProviderFromModelId(modelId: string): string | undefined;
export function isModelProvider(value: string | undefined): boolean;
export function modelCredentialEnvKey(provider: string | undefined): string | undefined;
export function modelCredentialSource(source?: Record<string, unknown>): ModelCredentialSource;
export function modelOAuthCredential(tokens?: ModelCredentialTokens): string | undefined;
export function modelCredentialStatus(
    provider: string | undefined,
    tokens?: ModelCredentialTokens,
    env?: Record<string, string | undefined>,
): ModelCredentialStatus;
export function hasUsableModelCredential(
    provider: string | undefined,
    tokens?: ModelCredentialTokens,
    env?: Record<string, string | undefined>,
): boolean;
export function hasUsableModelCredentialSource(
    source?: Record<string, unknown>,
    env?: Record<string, string | undefined>,
): boolean;
export function defaultProviderModelRef(provider?: string): string;
export function defaultProviderModelId(provider?: string): string;

export function defaultModelForProvider(
    provider: string | undefined,
): string | undefined;

export function defaultModelForScope(
    provider: string | undefined,
    scope: ModelScope,
): string | undefined;

export function defaultScopedModelRef(
    scope: ModelScope,
    provider?: string,
): string;

export function modelRouteTokenUpdate(
    scope: ModelScope,
    modelRef: ResolvedModelRef,
    tokens?: ModelRouteTokens,
): Record<string, unknown>;

export function effectiveModelRouteForScope(
    tokens: ModelRouteTokens | undefined,
    scope: ModelScope,
    options?: { env?: Record<string, string | undefined> },
): EffectiveModelRoute;

export function isModelScope(value: string | undefined): value is ModelScope;
export function parseModelScope(value: string | undefined): ModelScope | null;

export function parseModelRef(
    value: string | undefined,
    storedProvider: string | undefined,
): ModelRef | null;

export function formatModelRef(
    provider: string | undefined,
    modelId: string | undefined,
): string;
