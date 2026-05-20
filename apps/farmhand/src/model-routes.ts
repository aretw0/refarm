export type ModelScope = "default" | "worker" | "monitor";

export interface ModelRouteTokens {
	modelProvider?: unknown;
	modelId?: unknown;
	model?: unknown;
	modelRoutes?: unknown;
}

export interface EffectiveModelRoute {
	provider?: string;
	modelId?: string;
}

function stringValue(value: unknown): string | undefined {
	return typeof value === "string" && value.trim().length > 0
		? value.trim()
		: undefined;
}

function parseRouteRef(value: unknown): EffectiveModelRoute | null {
	const ref = stringValue(value);
	if (!ref) return null;
	const slash = ref.indexOf("/");
	if (slash <= 0 || slash >= ref.length - 1) return null;
	return {
		provider: ref.slice(0, slash).trim(),
		modelId: ref.slice(slash + 1).trim(),
	};
}

export function defaultModelForScope(
	provider: string | undefined,
	scope: ModelScope,
): string | undefined {
	const normalized = provider?.trim().toLowerCase();
	if (scope === "worker" && normalized === "openai") {
		return "gpt-5.3-codex-spark";
	}
	switch (normalized) {
		case "openai":
			return "gpt-5.5";
		case "anthropic":
			return "claude-sonnet-4-6";
		case "ollama":
			return "llama3.2";
		default:
			return undefined;
	}
}

export function routeForScope(
	tokens: ModelRouteTokens,
	scope: ModelScope,
): EffectiveModelRoute {
	const provider = stringValue(tokens.modelProvider);
	const defaultModelId = stringValue(tokens.modelId) ?? stringValue(tokens.model);
	if (scope === "default") {
		return {
			provider,
			modelId: defaultModelId ?? defaultModelForScope(provider, scope),
		};
	}

	const routes =
		tokens.modelRoutes && typeof tokens.modelRoutes === "object"
			? (tokens.modelRoutes as Record<string, unknown>)
			: {};
	const scoped = parseRouteRef(routes[scope]);
	if (scoped) return scoped;

	return {
		provider,
		modelId: defaultModelForScope(provider, scope) ?? defaultModelId,
	};
}

export function withModelRouteEnv<T>(
	route: EffectiveModelRoute,
	fn: () => Promise<T>,
): Promise<T> {
	const previousProvider = process.env.MODEL_PROVIDER;
	const previousModel = process.env.MODEL_ID;
	if (route.provider) process.env.MODEL_PROVIDER = route.provider;
	if (route.modelId) process.env.MODEL_ID = route.modelId;

	return fn().finally(() => {
		if (previousProvider === undefined) {
			delete process.env.MODEL_PROVIDER;
		} else {
			process.env.MODEL_PROVIDER = previousProvider;
		}
		if (previousModel === undefined) {
			delete process.env.MODEL_ID;
		} else {
			process.env.MODEL_ID = previousModel;
		}
	});
}
