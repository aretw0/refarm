import {
	effectiveModelRouteForScope,
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
		if (key === "MODEL_PROVIDER" || key === "MODEL_ID") {
			delete routeEnv[key];
		}
	}
	return routeEnv;
}

export function scopeForEffortSource(source: string | undefined): ModelScope {
	if (source === "refarm-ask" || source === "refarm-chat") return "default";
	if (source === "refarm-monitor") return "monitor";
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
): Promise<T> {
	const previousProvider = process.env.MODEL_PROVIDER;
	const previousModel = process.env.MODEL_ID;
	if (route.provider) {
		process.env.MODEL_PROVIDER = route.provider;
	} else {
		delete process.env.MODEL_PROVIDER;
	}
	if (route.modelId) {
		process.env.MODEL_ID = route.modelId;
	} else {
		delete process.env.MODEL_ID;
	}

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
