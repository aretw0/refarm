export type ModelScope = "default" | "worker" | "monitor";

export const MODEL_SCOPES: readonly ModelScope[];
export const DEFAULT_MODEL_PROVIDER: string;
export const MODEL_PROVIDERS: readonly string[];
export const MODEL_CREDENTIAL_ENV_KEYS: Readonly<Record<string, string>>;

export interface ModelRef {
    provider?: string;
    modelId: string;
}

export function inferProviderFromModelId(modelId: string): string | undefined;
export function isModelProvider(value: string | undefined): boolean;
export function modelCredentialEnvKey(provider: string | undefined): string | undefined;
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
