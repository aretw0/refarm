import { defaultModelForScope, type ModelScope } from "@refarm.dev/config";

export type { ModelScope } from "@refarm.dev/config";

export interface ModelRouteTokens {
	modelProvider?: unknown;
	modelId?: unknown;
	model?: unknown;
	modelRoutes?: unknown;
}

export interface ModelRouteOptions {
	env?: NodeJS.ProcessEnv;
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

export function routeForScope(
	tokens: ModelRouteTokens,
	scope: ModelScope,
	options: ModelRouteOptions = {},
): EffectiveModelRoute {
	const env = options.env ?? process.env;
	const envProvider = stringValue(env.MODEL_PROVIDER);
	const envDefaultProvider = stringValue(env.MODEL_DEFAULT_PROVIDER);
	const envModelId = stringValue(env.MODEL_ID);
	const provider = envProvider ?? envDefaultProvider ?? stringValue(tokens.modelProvider);
	const defaultModelId =
		envModelId ?? stringValue(tokens.modelId) ?? stringValue(tokens.model);
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

export interface ModelRouteStore {
	loadTokens(): Promise<ModelRouteTokens>;
}

export function createModelRouteResolver(store: ModelRouteStore): {
	currentTokens(): ModelRouteTokens;
	refreshTokens(): Promise<ModelRouteTokens>;
} {
	let cachedTokens: ModelRouteTokens = {};
	return {
		currentTokens() {
			return cachedTokens;
		},
		async refreshTokens() {
			try {
				cachedTokens = await store.loadTokens();
			} catch {
				// Keep the last known-good routing data if Silo is temporarily unavailable.
			}
			return cachedTokens;
		},
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
