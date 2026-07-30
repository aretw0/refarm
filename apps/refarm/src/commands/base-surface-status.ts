import {
	buildBaseSurfaceModel,
	buildOperatorAttentionSurfaceUnit,
	type BaseSurfaceModel,
	type BaseSurfaceModelInput,
	type BaseSurfaceUnit,
	type OperatorAttentionGateStatus,
} from "@refarm.dev/operator-state";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runHealthAudit } from "./health.js";
import { buildCurrentModelEnvelope, defaultModelDeps } from "./model.js";
import { buildRuntimeJsonPayload, runtimeStatusPayload } from "./runtime-status.js";
import { defaultRuntimeCommandDeps } from "./runtime.js";

export interface BaseSurfaceStatusDeps {
	resolveRuntime?: () => Promise<BaseSurfaceModelInput["runtime"]>;
	resolveModel?: () => Promise<BaseSurfaceModelInput["model"]>;
	resolveHealth?: () => Promise<BaseSurfaceModelInput["health"]>;
	resolveOperatorAttention?: (
		options: BaseSurfaceStatusOptions,
	) => Promise<OperatorAttentionGateStatus | null>;
}

export interface BaseSurfaceStatusOptions {
	operatorAttentionScope?: string;
	operatorAttentionWindowMs?: number;
	operatorAttentionProfile?: string;
}

const OPERATOR_ATTENTION_PROFILES: Record<string, { scope: string; windowMs: number }> = {
	"cross-device-handoff": {
		scope: "attention:cross-device-handoff",
		windowMs: 120000,
	},
	"mobile-ready": {
		scope: "attention:mobile-ready",
		windowMs: 90000,
	},
	"operator-sync": {
		scope: "attention:operator-sync",
		windowMs: 300000,
	},
};

export async function resolveBaseSurfaceStatus(
	deps: BaseSurfaceStatusDeps = {},
	options: BaseSurfaceStatusOptions = {},
): Promise<BaseSurfaceModel> {
	const runtime = await (deps.resolveRuntime ?? resolveRuntimeBaseInput)();
	const model = await (deps.resolveModel ?? resolveModelBaseInput)();
	const health = await (deps.resolveHealth ?? resolveHealthBaseInput)();
	const operatorAttention = await (
		deps.resolveOperatorAttention ?? resolveOperatorAttentionBaseInput
	)(options);
	const units: BaseSurfaceUnit[] = [];
	if (operatorAttention) {
		units.push(
			buildOperatorAttentionSurfaceUnit({
				owner: "apps/refarm",
				status: operatorAttention,
			}),
		);
	}
	return buildBaseSurfaceModel({ runtime, model, health, units }, { owner: "apps/refarm" });
}

async function resolveRuntimeBaseInput(): Promise<BaseSurfaceModelInput["runtime"]> {
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

async function resolveOperatorAttentionBaseInput(
	options: BaseSurfaceStatusOptions,
): Promise<OperatorAttentionGateStatus | null> {
	const profile = resolveOperatorAttentionProfile(options.operatorAttentionProfile);
	const scope =
		options.operatorAttentionScope?.trim() ||
		profile?.scope ||
		process.env.REFARM_OPERATOR_ATTENTION_SCOPE?.trim();
	if (!scope) return null;

	const defaultWindowMs =
		options.operatorAttentionWindowMs ??
		profile?.windowMs ??
		Number(process.env.REFARM_OPERATOR_ATTENTION_WINDOW_MS ?? 5 * 60 * 1000);
	const filePath = operatorAttentionStatePath(scope);
	const state = readJson(filePath);
	const armedAt = Number(state.armedAt ?? 0);
	const windowMs = Number(state.windowMs ?? defaultWindowMs);
	const now = Date.now();
	const ageMs = now - armedAt;
	const armed = Number.isFinite(armedAt) && armedAt > 0 && ageMs >= 0 && ageMs <= windowMs;

	return {
		scope,
		armed,
		windowMs,
		expiresAt: armed ? new Date(armedAt + windowMs).toISOString() : null,
	};
}

function operatorAttentionStatePath(scope: string): string {
	const refarmHome = resolveRefarmHome();
	const safeScope = scope.replace(/[^a-zA-Z0-9._:-]/g, "_");
	return path.join(refarmHome, "operator-attention", `${safeScope}.json`);
}

function resolveRefarmHome(): string {
	const envHome = process.env.REFARM_HOME?.trim();
	if (envHome) return envHome;

	const cwdRefarm = path.join(process.cwd(), ".refarm");
	if (fs.existsSync(cwdRefarm)) return cwdRefarm;

	return path.join(os.homedir(), ".refarm");
}

function readJson(filePath: string): Record<string, unknown> {
	try {
		const raw = fs.readFileSync(filePath, "utf8");
		return JSON.parse(raw);
	} catch {
		return {};
	}
}

function resolveOperatorAttentionProfile(
	profileName?: string,
): { scope: string; windowMs: number } | null {
	const name = profileName?.trim();
	if (!name) return null;
	const profile = OPERATOR_ATTENTION_PROFILES[name];
	if (!profile) {
		const available = Object.keys(OPERATOR_ATTENTION_PROFILES).join(", ");
		throw new Error(
			`Unknown --attention-profile '${name}'. Available profiles: ${available}.`,
		);
	}
	return profile;
}
