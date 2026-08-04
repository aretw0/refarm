export const STORAGE_CAPABILITY = "storage:v1" as const;

export type StorageErrorCode =
	| "NOT_FOUND"
	| "CONFLICT"
	| "INVALID_INPUT"
	| "UNAVAILABLE"
	| "INTERNAL";

export interface StorageRecord {
	id: string;
	type: string;
	payload: string;
	createdAt: string;
	updatedAt: string;
}

export interface StorageQuery {
	type?: string;
	limit?: number;
	offset?: number;
	/** Return only records created after this ISO timestamp. */
	createdAfter?: string;
	/** Return only records created before this ISO timestamp. */
	createdBefore?: string;
}

/** Proven (./telemetry-shape-proof.ts, `tsc`-enforced) structurally identical to
 * an instantiation of `CapabilityTelemetryEvent<typeof STORAGE_CAPABILITY,
 * "get"|"put"|"put_many"|"delete"|"delete_many"|"query", StorageErrorCode>`
 * from `@refarm.dev/capability-telemetry-v1` — the shared skeleton every
 * `*TelemetryEvent` across enrichment/identity/source/storage/sync-contract-v1
 * specializes. Kept as a literal interface here (not a `type X = Generic<...>`
 * alias) so this contract's declared-field surface stays visible to
 * `scripts/ci/check-contract-reachability.mjs`, which only recognizes a plain
 * `interface X { ... }` / `type X = { ... }` block — an alias or an `extends`
 * clause is invisible to its parser, which would silently drop this type from
 * the gate's tracked field universe. */
export interface StorageTelemetryEvent {
	traceId: string;
	pluginId: string;
	capability: typeof STORAGE_CAPABILITY;
	operation: "get" | "put" | "put_many" | "delete" | "delete_many" | "query";
	durationMs: number;
	ok: boolean;
	errorCode?: StorageErrorCode;
}

export interface StorageProvider {
	readonly pluginId: string;
	readonly capability: typeof STORAGE_CAPABILITY;

	get(id: string): Promise<StorageRecord | null>;
	put(record: StorageRecord): Promise<void>;
	putMany(records: StorageRecord[]): Promise<void>;
	delete(id: string): Promise<void>;
	deleteMany(ids: string[]): Promise<void>;
	query(query: StorageQuery): Promise<StorageRecord[]>;
}

export interface StorageAdapter {
	ensureSchema(): Promise<void>;
	storeNode(
		id: string,
		type: string,
		context: string,
		payload: string,
		sourcePlugin: string | null,
	): Promise<void>;
	queryNodes(type: string): Promise<unknown[]>;
	execute(sql: string, args?: unknown): Promise<unknown>;
	query<T = unknown>(sql: string, args?: unknown): Promise<T[]>;
	transaction<T>(fn: () => Promise<T>): Promise<T>;
	close(): Promise<void>;
}

export interface StorageConformanceResult {
	pass: boolean;
	total: number;
	failed: number;
	failures: string[];
}
