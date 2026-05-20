export const POLICY_CAPABILITY = "policy:v1" as const;

/**
 * Retention policy for any asset store (artifacts, sessions, files, logs).
 *
 * The *declaration* is provider-neutral. Each provider translates it into its
 * native enforcement mechanism — Cloudflare Cron Trigger + R2 list/delete,
 * S3 lifecycle rules, SQLite cron job, etc.
 */
export interface RetentionPolicy {
	/** Maximum age of an asset in seconds before it is eligible for deletion.
	 *  0 means retain forever (disables cleanup). */
	readonly ttlSeconds: number;
	/** Maximum size of a single asset in bytes. Uploads exceeding this are rejected.
	 *  0 means no limit. */
	readonly maxAssetBytes: number;
	/** When true, the enforcer logs what would be deleted without deleting.
	 *  Useful for validating the policy before enforcing it. */
	readonly dryRun: boolean;
}

export const DEFAULT_RETENTION_POLICY: RetentionPolicy = {
	ttlSeconds: 2_592_000,     // 30 days
	maxAssetBytes: 52_428_800, // 50 MB
	dryRun: false,
};

/**
 * Quota policy caps the total storage consumed by a scope (bucket, prefix, user).
 * When the quota is exceeded the enforcer runs the eviction policy.
 */
export interface QuotaPolicy {
	/** Maximum total bytes across all assets in the scope. 0 = no limit. */
	readonly maxTotalBytes: number;
	/** Maximum number of assets in the scope. 0 = no limit. */
	readonly maxAssetCount: number;
	/** When true, reject new writes that would exceed the quota instead of evicting. */
	readonly hardLimit: boolean;
}

export const DEFAULT_QUOTA_POLICY: QuotaPolicy = {
	maxTotalBytes: 0,
	maxAssetCount: 0,
	hardLimit: false,
};

/** Determines which assets to remove first when quota is exceeded. */
export type EvictionStrategy =
	| "lru"      // Least Recently Used — remove the oldest-accessed asset
	| "lfu"      // Least Frequently Used — remove the least-accessed asset
	| "oldest"   // Remove the oldest uploaded asset (insertion order)
	| "largest"; // Remove the largest asset first (frees most space fastest)

/**
 * Eviction policy defines what the enforcer does when QuotaPolicy limits are hit.
 */
export interface EvictionPolicy {
	readonly strategy: EvictionStrategy;
	/** Minimum age in seconds before an asset is eligible for eviction.
	 *  Prevents newly uploaded assets from being evicted immediately. 0 = any age. */
	readonly minAgeSeconds: number;
	/** When true, log eviction candidates without removing them. */
	readonly dryRun: boolean;
}

export const DEFAULT_EVICTION_POLICY: EvictionPolicy = {
	strategy: "lru",
	minAgeSeconds: 300, // 5 minutes — never evict something just uploaded
	dryRun: false,
};

/** Target storage tier for archival. */
export type ArchivalTier =
	| "cold"     // Provider cold/infrequent-access tier (e.g. R2 Infrequent Access, S3 Glacier)
	| "archive"  // Deepest, cheapest tier — high retrieval latency
	| "offsite"; // Export to a different provider entirely (e.g. backup to B2)

/**
 * Archival policy moves assets to a cheaper storage tier instead of deleting them.
 * Applied *before* RetentionPolicy deletion — assets are archived first, deleted later.
 */
export interface ArchivalPolicy {
	/** Move assets older than this to the archival tier. 0 = disabled. */
	readonly archiveAfterSeconds: number;
	readonly targetTier: ArchivalTier;
	/** When true, log archival candidates without moving them. */
	readonly dryRun: boolean;
}

export const DEFAULT_ARCHIVAL_POLICY: ArchivalPolicy = {
	archiveAfterSeconds: 0,
	targetTier: "cold",
	dryRun: false,
};

/** Composite policy applied to a named asset scope. */
export interface AssetPolicy {
	readonly name: string;
	readonly description?: string;
	readonly retention: RetentionPolicy;
	readonly quota?: QuotaPolicy;
	readonly eviction?: EvictionPolicy;
	readonly archival?: ArchivalPolicy;
}
