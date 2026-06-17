import {
	effectiveModelRouteForScope,
	MODEL_BASE_URL_ENV_VAR,
	MODEL_ID_ENV_VAR,
	MODEL_PROVIDER_ENV_VAR,
	type EffectiveModelRoute,
	type ModelScope,
} from "@refarm.dev/config";

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

export function routeResolutionEnv(
	env: NodeJS.ProcessEnv,
	managedKeys: string[],
): NodeJS.ProcessEnv {
	const routeEnv = { ...env };
	for (const key of managedKeys) {
		if (key === MODEL_PROVIDER_ENV_VAR || key === MODEL_ID_ENV_VAR) {
			delete routeEnv[key];
		}
	}
	return routeEnv;
}

export function scopeForEffortSource(source: string | undefined): ModelScope {
	if (source === "refarm-ask" || source === "refarm-chat") return "default";
	if (source === "refarm-monitor") return "monitor";
	if (source?.startsWith("channel:")) return "worker";
	return "worker";
}

export function routeForScope(
	tokens: ModelRouteTokens,
	scope: ModelScope,
	options: ModelRouteOptions = {},
): EffectiveModelRoute {
	return effectiveModelRouteForScope(tokens, scope, {
		env: options.env ?? process.env,
	});
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
	options: { managedEnvKeys?: string[] } = {},
): Promise<T> {
	const previousProvider = process.env[MODEL_PROVIDER_ENV_VAR];
	const previousModel = process.env[MODEL_ID_ENV_VAR];
	const previousBaseUrl = process.env[MODEL_BASE_URL_ENV_VAR];
	const managedKeys = new Set(options.managedEnvKeys ?? []);
	const previousProviderManaged = managedKeys.has(MODEL_PROVIDER_ENV_VAR);
	const baseUrlManaged = managedKeys.has(MODEL_BASE_URL_ENV_VAR);
	const routeProviderDiffersFromManagedDefault =
		previousProviderManaged &&
		previousProvider !== undefined &&
		route.provider !== undefined &&
		route.provider.trim().toLowerCase() !==
			previousProvider.trim().toLowerCase();
	if (route.provider) {
		process.env[MODEL_PROVIDER_ENV_VAR] = route.provider;
	} else {
		delete process.env[MODEL_PROVIDER_ENV_VAR];
	}
	if (route.modelId) {
		process.env[MODEL_ID_ENV_VAR] = route.modelId;
	} else {
		delete process.env[MODEL_ID_ENV_VAR];
	}
	if (baseUrlManaged && routeProviderDiffersFromManagedDefault) {
		delete process.env[MODEL_BASE_URL_ENV_VAR];
	}

	return fn().finally(() => {
		if (previousProvider === undefined) {
			delete process.env[MODEL_PROVIDER_ENV_VAR];
		} else {
			process.env[MODEL_PROVIDER_ENV_VAR] = previousProvider;
		}
		if (previousModel === undefined) {
			delete process.env[MODEL_ID_ENV_VAR];
		} else {
			process.env[MODEL_ID_ENV_VAR] = previousModel;
		}
		if (previousBaseUrl === undefined) {
			delete process.env[MODEL_BASE_URL_ENV_VAR];
		} else {
			process.env[MODEL_BASE_URL_ENV_VAR] = previousBaseUrl;
		}
	});
}
