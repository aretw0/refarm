export const SYNC_CAPABILITY = "sync:v1" as const;

export type SyncErrorCode = "CONFLICT" | "NETWORK_ERROR" | "AUTH_FAILED" | "TIMEOUT" | "INTERNAL";

export interface SyncChange {
	id: string;
	timestamp: string;
	author: string;
	operation: "put" | "delete" | "update";
	resourceId: string;
	data?: unknown;
}

export interface SyncSession {
	sessionId: string;
	peerId: string;
	startedAt: string;
}

/** Proven (./telemetry-shape-proof.ts, `tsc`-enforced) structurally identical to
 * an instantiation of `CapabilityTelemetryEvent<typeof SYNC_CAPABILITY,
 * "connect"|"sync"|"disconnect"|"conflict", SyncErrorCode>` from
 * `@refarm.dev/capability-telemetry-v1` — the shared skeleton every
 * `*TelemetryEvent` across enrichment/identity/source/storage/sync-contract-v1
 * specializes. Kept as a literal interface here (not a `type X = Generic<...>`
 * alias) so this contract's declared-field surface stays visible to
 * `scripts/ci/check-contract-reachability.mjs`, which only recognizes a plain
 * `interface X { ... }` / `type X = { ... }` block — an alias or an `extends`
 * clause is invisible to its parser, which would silently drop this type from
 * the gate's tracked field universe. */
export interface SyncTelemetryEvent {
	traceId: string;
	pluginId: string;
	capability: typeof SYNC_CAPABILITY;
	operation: "connect" | "sync" | "disconnect" | "conflict";
	durationMs: number;
	ok: boolean;
	errorCode?: SyncErrorCode;
}

export interface SyncProvider {
	readonly pluginId: string;
	readonly capability: typeof SYNC_CAPABILITY;

	connect(endpoint: string): Promise<SyncSession>;
	push(changes: SyncChange[]): Promise<void>;
	pull(): Promise<SyncChange[]>;
	disconnect(sessionId: string): Promise<void>;
}

export interface SyncAdapter {
	/** Initialize the sync engine and transports. */
	start(): Promise<void>;
	/** Gracefully shutdown. */
	stop(): Promise<void>;
	/** Apply a binary CRDT update (e.g. from a Nostr relay or WebRTC peer). */
	applyUpdate(update: Uint8Array): Promise<void>;
	/** Retrieve the current state as a binary update (delta or full state). */
	getUpdate(): Promise<Uint8Array>;
	/** Subscribe to local updates that need to be broadcast to the network. */
	onUpdate(callback: (update: Uint8Array) => void): () => void;
}

export interface SyncConformanceResult {
	pass: boolean;
	total: number;
	failed: number;
	failures: string[];
}
