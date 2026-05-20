export interface ModelRef {
	provider?: string;
	modelId: string;
}

export type ModelScope = "default" | "worker" | "monitor";

export const MODEL_SCOPES: readonly ModelScope[] = ["default", "worker", "monitor"];

export function inferProviderFromModelId(modelId: string): string | undefined {
	const normalized = modelId.trim().toLowerCase();
	if (normalized.startsWith("gpt-") || normalized.startsWith("o")) return "openai";
	if (normalized.startsWith("claude-")) return "anthropic";
	if (normalized.startsWith("grok-")) return "xai";
	if (normalized.startsWith("gemini-")) return "gemini";
	if (normalized.startsWith("mistral-")) return "mistral";
	if (normalized.startsWith("deepseek-")) return "deepseek";
	return undefined;
}

export function defaultModelForProvider(provider: string | undefined): string | undefined {
	switch (provider?.trim().toLowerCase()) {
		case "openai":
			return "gpt-5.5";
		case "anthropic":
			return "claude-sonnet-4-6";
		case "ollama":
			return "llama3.2";
		case "mistral":
			return "mistral-large-latest";
		case "gemini":
			return "gemini-2.0-flash";
		case "xai":
			return "grok-3";
		case "deepseek":
			return "deepseek-chat";
		default:
			return undefined;
	}
}

export function defaultModelForScope(
	provider: string | undefined,
	scope: ModelScope,
): string | undefined {
	const normalized = provider?.trim().toLowerCase();
	if (scope === "worker" && normalized === "openai") {
		return "gpt-5.3-codex-spark";
	}
	return defaultModelForProvider(provider);
}

export function parseModelRef(
	value: string | undefined,
	storedProvider: string | undefined,
): ModelRef | null {
	const ref = value?.trim();
	if (!ref) return null;

	const slash = ref.indexOf("/");
	if (slash > 0 && slash < ref.length - 1) {
		return {
			provider: ref.slice(0, slash).trim(),
			modelId: ref.slice(slash + 1).trim(),
		};
	}

	return {
		provider: storedProvider ?? inferProviderFromModelId(ref),
		modelId: ref,
	};
}

export function formatModelRef(provider: string | undefined, modelId: string | undefined): string {
	const resolvedModel = modelId ?? defaultModelForProvider(provider);
	if (!provider && !resolvedModel) return "<not configured>";
	if (!provider) return resolvedModel ?? "<not configured>";
	if (!resolvedModel) return provider;
	return `${provider}/${resolvedModel}`;
}

export function isModelScope(value: string | undefined): value is ModelScope {
	return MODEL_SCOPES.includes(value as ModelScope);
}
