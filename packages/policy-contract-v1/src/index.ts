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
	ttlSeconds: 2_592_000,    // 30 days
	maxAssetBytes: 52_428_800, // 50 MB
	dryRun: false,
};
