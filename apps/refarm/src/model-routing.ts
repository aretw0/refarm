export {
	defaultModelForProvider,
	defaultModelForScope,
	inferProviderFromModelId,
	isModelScope,
	MODEL_SCOPES,
	type ModelScope,
} from "@refarm.dev/config";
import {
	defaultModelForProvider,
	inferProviderFromModelId,
} from "@refarm.dev/config";

export interface ModelRef {
	provider?: string;
	modelId: string;
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
