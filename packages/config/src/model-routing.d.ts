export type ModelScope = "default" | "worker" | "monitor";

export const MODEL_SCOPES: readonly ModelScope[];
export const DEFAULT_MODEL_PROVIDER: string;
export const MODEL_PROVIDERS: readonly string[];

export function inferProviderFromModelId(modelId: string): string | undefined;
export function isModelProvider(value: string | undefined): boolean;

export function defaultModelForProvider(
    provider: string | undefined,
): string | undefined;

export function defaultModelForScope(
    provider: string | undefined,
    scope: ModelScope,
): string | undefined;

export function isModelScope(value: string | undefined): value is ModelScope;
