import {
	buildBaseSurfaceModel,
	type BaseSurfaceModel,
	type BaseSurfaceModelInput,
} from "./base-surface-model.js";
import { runHealthAudit } from "./health.js";
import { buildCurrentModelEnvelope, defaultModelDeps } from "./model.js";
import {
	buildRuntimeJsonPayload,
	runtimeStatusPayload,
} from "./runtime-status.js";
import { defaultRuntimeCommandDeps } from "./runtime.js";

export interface BaseSurfaceStatusDeps {
	resolveRuntime?: () => Promise<BaseSurfaceModelInput["runtime"]>;
	resolveModel?: () => Promise<BaseSurfaceModelInput["model"]>;
	resolveHealth?: () => Promise<BaseSurfaceModelInput["health"]>;
}

export async function resolveBaseSurfaceStatus(
	deps: BaseSurfaceStatusDeps = {},
): Promise<BaseSurfaceModel> {
	const runtime = await (deps.resolveRuntime ?? resolveRuntimeBaseInput)();
	const model = await (deps.resolveModel ?? resolveModelBaseInput)();
	const health = await (deps.resolveHealth ?? resolveHealthBaseInput)();
	return buildBaseSurfaceModel({ runtime, model, health });
}

async function resolveRuntimeBaseInput(): Promise<
	BaseSurfaceModelInput["runtime"]
> {
	const payload = await runtimeStatusPayload(defaultRuntimeCommandDeps());
	return buildRuntimeJsonPayload(payload);
}

async function resolveModelBaseInput(): Promise<BaseSurfaceModelInput["model"]> {
	const tokens = await defaultModelDeps().loadTokens();
	return buildCurrentModelEnvelope(tokens);
}

async function resolveHealthBaseInput(): Promise<BaseSurfaceModelInput["health"]> {
	return runHealthAudit();
}
