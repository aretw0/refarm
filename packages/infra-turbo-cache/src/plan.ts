import type {
	ManagedResourceRequirement,
	ManagedServicePlan,
} from "@refarm.dev/infra-contract-v1";
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

/**
 * Retention policy for artifact storage.
 * Applies to any storage-backed service — not turbo-cache-specific.
 * The provider (e.g. Cloudflare) translates this into its native mechanism
 * (Cron Trigger + R2 list/delete, S3 lifecycle rules, etc.).
 */
export interface RetentionPolicy {
	/** Maximum age of an artifact in seconds before it is eligible for deletion.
	 *  0 means retain forever (disables cleanup). Default: 2592000 (30 days). */
	readonly ttlSeconds: number;
	/** Maximum size of a single artifact in bytes. Uploads exceeding this are rejected.
	 *  Default: 52428800 (50 MB). */
	readonly maxArtifactBytes: number;
	/** When true, the cleanup scheduler logs what would be deleted without deleting.
	 *  Useful for validating the policy before enforcing it. Default: false. */
	readonly dryRun: boolean;
}

export const DEFAULT_RETENTION_POLICY: RetentionPolicy = {
	ttlSeconds: 2_592_000,   // 30 days
	maxArtifactBytes: 52_428_800, // 50 MB
	dryRun: false,
};

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
