import {
	buildJsonErrorEnvelope,
	buildJsonSuccessEnvelope,
} from "@refarm.dev/capabilities/envelope";
import {
	formatModelRef,
	modelRouteTokenUpdate,
	parseModelRef,
	parseModelScope,
	type ModelScope,
} from "../model-routing.js";
import {
	LOCAL_MODEL_JSON_COMMAND,
	MODEL_CURRENT_JSON_COMMAND,
	MODEL_PROVIDERS_JSON_COMMAND,
	OPENAI_MODEL_JSON_COMMAND,
} from "./credential-handoffs.js";
import type { ModelCommandDeps } from "./model.js";

interface ModelRouteMutationResult {
	action: "set-route";
	scope: ModelScope;
	provider: string;
	modelId: string;
	ref: string;
}

interface ModelFallbackMutationResult {
	action: "set-fallback" | "disable-fallback";
	provider?: string;
	modelId?: string;
	ref?: string;
}

interface ModelBaseUrlMutationResult {
	action: "set-base-url" | "disable-base-url";
	baseUrl?: string;
}

interface ModelResetMutationResult {
	action: "reset-route";
	scope: ModelScope;
}

/** Build the model-mutation error envelope (no I/O) — a projector-friendly
 * error shape so run() can RETURN it. */
export function buildModelValidationErrorEnvelope(input: {
	error: string;
	message: string;
	nextCommand?: string;
	extra?: Record<string, unknown>;
}) {
	const nextCommand = input.nextCommand ?? MODEL_CURRENT_JSON_COMMAND;
	return buildJsonErrorEnvelope({
		command: "model",
		operation: "mutate",
		error: input.error,
		message: input.message,
		nextAction: nextCommand,
		nextCommand,
		nextCommands: [nextCommand, MODEL_PROVIDERS_JSON_COMMAND, LOCAL_MODEL_JSON_COMMAND],
		extra: input.extra,
	});
}

/**
 * Validate an explicitly-provided route scope. Returns an error envelope (to
 * RETURN from a mutator action, matching the legacy `unknown-model-scope`
 * rejection) when `raw` is a non-empty string that is not a known scope, else
 * null. Uses `parseModelScope` so recognition stays case-insensitive (`Worker`
 * → `worker`), exactly like the legacy CLI. A group's `set`/`reset` action calls
 * this BEFORE coercing, so a typo'd `--scope planner` fails loudly instead of
 * silently writing the default route.
 */
export function buildInvalidScopeEnvelope(raw: string | undefined) {
	if (raw === undefined || parseModelScope(raw) != null) {
		return null;
	}
	return buildModelValidationErrorEnvelope({
		error: "unknown-model-scope",
		message: `Unknown model scope: ${raw}`,
	});
}

/** Build the `model set` envelope: validate, persist, and RETURN a success or
 * error envelope — pure of console/exitCode. The CLI/REPL/API projectors render
 * it. */
export async function buildSetModelEnvelope(
	ref: string,
	scope: ModelScope,
	deps: ModelCommandDeps,
) {
	const tokens = await deps.loadTokens();
	const parsed = parseModelRef(ref, tokens.modelProvider);
	if (!parsed) {
		return buildModelValidationErrorEnvelope({
			error: "empty-model-ref",
			message: "model ref cannot be empty.",
			nextCommand: LOCAL_MODEL_JSON_COMMAND,
			extra: { scope },
		});
	}
	if (!parsed.provider) {
		return buildModelValidationErrorEnvelope({
			error: "model-provider-required",
			message: `Could not infer provider for model "${parsed.modelId}".`,
			nextCommand: LOCAL_MODEL_JSON_COMMAND,
			extra: { scope, modelId: parsed.modelId },
		});
	}

	const modelRef = { provider: parsed.provider, modelId: parsed.modelId };
	await deps.saveTokens(modelRouteTokenUpdate(scope, modelRef, tokens));
	const result: ModelRouteMutationResult = {
		action: "set-route",
		scope,
		provider: parsed.provider,
		modelId: parsed.modelId,
		ref: formatModelRef(parsed.provider, parsed.modelId),
	};
	return buildJsonSuccessEnvelope({
		command: "model",
		operation: "mutate",
		extra: result,
		nextCommand: MODEL_CURRENT_JSON_COMMAND,
		nextCommands: [MODEL_CURRENT_JSON_COMMAND],
	});
}

/** Build the `model fallback` envelope: validate, persist (including the
 * off/disable path), and RETURN a success or error envelope — pure of
 * console/exitCode. */
export async function buildSetFallbackEnvelope(ref: string, deps: ModelCommandDeps) {
	const tokens = await deps.loadTokens();
	if (ref.trim().toLowerCase() === "off") {
		await deps.saveTokens({
			modelFallbackProvider: undefined,
			modelFallbackModelId: undefined,
		});
		const result: ModelFallbackMutationResult = { action: "disable-fallback" };
		return buildJsonSuccessEnvelope({
			command: "model",
			operation: "mutate",
			extra: result,
			nextCommand: MODEL_CURRENT_JSON_COMMAND,
			nextCommands: [MODEL_CURRENT_JSON_COMMAND],
		});
	}
	const parsed = parseModelRef(ref, tokens.modelFallbackProvider ?? tokens.modelProvider);
	if (!parsed) {
		return buildModelValidationErrorEnvelope({
			error: "empty-fallback-model-ref",
			message: "fallback model ref cannot be empty.",
			nextCommand: LOCAL_MODEL_JSON_COMMAND,
		});
	}
	if (!parsed.provider) {
		return buildModelValidationErrorEnvelope({
			error: "fallback-model-provider-required",
			message: `Could not infer provider for fallback model "${parsed.modelId}".`,
			nextCommand: LOCAL_MODEL_JSON_COMMAND,
			extra: { modelId: parsed.modelId },
		});
	}

	await deps.saveTokens({
		modelFallbackProvider: parsed.provider,
		modelFallbackModelId: parsed.modelId,
	});
	const result: ModelFallbackMutationResult = {
		action: "set-fallback",
		provider: parsed.provider,
		modelId: parsed.modelId,
		ref: formatModelRef(parsed.provider, parsed.modelId),
	};
	return buildJsonSuccessEnvelope({
		command: "model",
		operation: "mutate",
		extra: result,
		nextCommand: MODEL_CURRENT_JSON_COMMAND,
		nextCommands: [MODEL_CURRENT_JSON_COMMAND],
	});
}

/** Build the `model reset` envelope: reject the default scope, otherwise drop
 * the persisted scoped route and RETURN a success or error envelope — pure of
 * console/exitCode. */
export async function buildResetScopedModelEnvelope(scope: ModelScope, deps: ModelCommandDeps) {
	if (scope === "default") {
		return buildModelValidationErrorEnvelope({
			error: "default-route-reset-not-supported",
			message: "Default route reset is explicit: set the desired provider/model.",
			nextCommand: OPENAI_MODEL_JSON_COMMAND,
		});
	}

	const tokens = await deps.loadTokens();
	const routes =
		tokens.modelRoutes &&
		typeof tokens.modelRoutes === "object" &&
		!Array.isArray(tokens.modelRoutes)
			? { ...tokens.modelRoutes }
			: {};
	delete routes[scope];
	await deps.saveTokens({ modelRoutes: routes });
	const result: ModelResetMutationResult = { action: "reset-route", scope };
	return buildJsonSuccessEnvelope({
		command: "model",
		operation: "mutate",
		extra: result,
		nextCommand: MODEL_CURRENT_JSON_COMMAND,
		nextCommands: [MODEL_CURRENT_JSON_COMMAND],
	});
}

/** Build the `model base-url` envelope: handle the off/disable path, reject an
 * empty URL, otherwise persist it and RETURN a success or error envelope — pure
 * of console/exitCode. */
export async function buildSetModelBaseUrlEnvelope(value: string, deps: ModelCommandDeps) {
	const trimmed = value.trim();
	if (trimmed.toLowerCase() === "off") {
		await deps.saveTokens({ modelBaseUrl: undefined });
		const result: ModelBaseUrlMutationResult = { action: "disable-base-url" };
		return buildJsonSuccessEnvelope({
			command: "model",
			operation: "mutate",
			extra: result,
			nextCommand: MODEL_CURRENT_JSON_COMMAND,
			nextCommands: [MODEL_CURRENT_JSON_COMMAND],
		});
	}
	if (!trimmed) {
		return buildModelValidationErrorEnvelope({
			error: "empty-model-base-url",
			message: "base URL cannot be empty.",
			nextCommand: MODEL_CURRENT_JSON_COMMAND,
		});
	}
	await deps.saveTokens({ modelBaseUrl: trimmed });
	const result: ModelBaseUrlMutationResult = {
		action: "set-base-url",
		baseUrl: trimmed,
	};
	return buildJsonSuccessEnvelope({
		command: "model",
		operation: "mutate",
		extra: result,
		nextCommand: MODEL_CURRENT_JSON_COMMAND,
		nextCommands: [MODEL_CURRENT_JSON_COMMAND],
	});
}
