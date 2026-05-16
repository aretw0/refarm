import type {
	ManagedResourceRequirement,
	ManagedServicePlan,
} from "@refarm.dev/infra-contract-v1";
import {
	DEFAULT_RETENTION_POLICY,
	type RetentionPolicy,
} from "@refarm.dev/policy-contract-v1";
import { turboCacheManifest } from "./manifest.js";

export type TurboCacheRequirementKind =
	| "artifact-storage"
	| "http-endpoint"
	| "bearer-auth";

export interface TurboCacheRequirement
	extends ManagedResourceRequirement<TurboCacheRequirementKind> {}

export interface TurboCacheServicePlan
	extends ManagedServicePlan<
		"turbo-cache",
		TurboCacheRequirement,
		(typeof turboCacheManifest.ciSecrets)[number]
	> {
	readonly team: string;
	readonly retention: RetentionPolicy;
	readonly ciSecrets: typeof turboCacheManifest.ciSecrets;
}

export { DEFAULT_RETENTION_POLICY, type RetentionPolicy };

export interface TurboCacheServicePlanInput {
	readonly team?: string;
	readonly retention?: Partial<RetentionPolicy>;
}

export function createTurboCacheServicePlan(
	input: TurboCacheServicePlanInput = {},
): TurboCacheServicePlan {
	const team = input.team ?? "refarm";
	const retention: RetentionPolicy = {
		...DEFAULT_RETENTION_POLICY,
		...input.retention,
	};

	return {
		serviceId: turboCacheManifest.id,
		displayName: turboCacheManifest.displayName,
		team,
		retention,
		requirements: [
			{
				kind: "artifact-storage",
				name: "artifact-store",
				description: `Durable artifact storage scoped for team "${team}"`,
			},
			{
				kind: "http-endpoint",
				name: "cache-api",
				description: "HTTP endpoint implementing Turborepo Remote Cache API v8",
			},
			{
				kind: "bearer-auth",
				name: "cache-auth-token",
				description:
					"Bearer token required by CI clients that read/write cache artifacts",
				secret: true,
			},
		],
		ciSecrets: turboCacheManifest.ciSecrets,
	};
}
