export const SOURCE_CAPABILITY = "source:v1" as const;

export type SourceKind = "git" | "tarball" | "local";

export type SourceErrorCode =
	| "INVALID_REF"
	| "NOT_MATERIALIZED"
	| "NETWORK"
	| "DIRTY"
	| "UNSUPPORTED_KIND"
	| "UNAVAILABLE"
	| "INTERNAL";

export interface SourceLocation {
	kind: SourceKind;
	host?: string;
	org?: string;
	repo?: string;
	ref?: string;
	path: string;
}

export interface MaterializeOptions {
	cacheRoot?: string;
	staleSeconds?: number;
	filter?: "blob:none" | "tree:0" | "none";
	force?: boolean;
	offline?: boolean;
	ref?: string;
}

export type MaterializeAction =
	| "cloned"
	| "reused"
	| "fetched"
	| "fast-forwarded"
	| "linked"
	| "noop";

export interface MaterializeResult {
	location: SourceLocation;
	action: MaterializeAction;
	head?: string;
	stale: boolean;
}

export interface SourceStatus {
	kind: SourceKind;
	materialized: boolean;
	path?: string;
	stale?: boolean;
	clean?: boolean;
	dirty?: boolean;
	untracked?: boolean;
	untrackedPaths?: string[];
	head?: string;
	lastFetchedAt?: string;
}

/** One source a provider advertises as available to materialize — the unit of
 * DISCOVERY. Before a caller can `materialize(ref)`, it needs to know WHICH refs
 * exist; `discover()` returns these. The `ref` is exactly what `materialize`/`status`
 * accept. NEUTRAL: label/description are free text; the provider decides what a source
 * IS (a git repo, a scraped system, a local dir) — the contract only names it. */
export interface SourceCatalogEntry {
	/** The ref to pass to `materialize`/`status` (e.g. `web:foo`, a git url, …). */
	ref: string;
	/** A human-readable name for the source. */
	label: string;
	/** The source kind (git/tarball/local), if the provider classifies it. */
	kind?: SourceKind;
	/** Optional longer description of what this source is. */
	description?: string;
}

/** The catalog a provider advertises via `discover()` — the sources a caller may
 * then materialize. An EMPTY catalog is a legitimate answer: a ref-open provider
 * (git/local materializes any url/path) has no finite list to advertise, so it
 * honestly returns `{ entries: [] }` rather than inventing one. A ref-closed provider
 * (web fixtures, a scraped-system catalog) returns its real list. */
export interface SourceCatalog {
	entries: SourceCatalogEntry[];
}

/** Proven (./telemetry-shape-proof.ts, `tsc`-enforced) structurally identical to
 * an instantiation of `CapabilityTelemetryEvent<typeof SOURCE_CAPABILITY,
 * "resolve"|"materialize"|"status"|"refresh"|"discover", SourceErrorCode> & {
 * kind?: SourceKind }` from `@refarm.dev/capability-telemetry-v1` — the
 * shared skeleton every `*TelemetryEvent` across
 * enrichment/identity/source/storage/sync-contract-v1 specializes, extended
 * with this contract's own `kind` field. Kept as a literal interface here
 * (not a `type X = Generic<...>` alias) so this contract's declared-field
 * surface stays visible to `scripts/ci/check-contract-reachability.mjs`,
 * which only recognizes a plain `interface X { ... }` / `type X = { ... }`
 * block — an alias or an `extends` clause is invisible to its parser, which
 * would silently drop this type from the gate's tracked field universe. */
export interface SourceTelemetryEvent {
	traceId: string;
	pluginId: string;
	capability: typeof SOURCE_CAPABILITY;
	operation: "resolve" | "materialize" | "status" | "refresh" | "discover";
	kind?: SourceKind;
	durationMs: number;
	ok: boolean;
	errorCode?: SourceErrorCode;
}

export interface SourceProvider {
	readonly pluginId: string;
	readonly capability: typeof SOURCE_CAPABILITY;
	readonly kinds: readonly SourceKind[];
	resolve(ref: string): Promise<SourceLocation>;
	materialize(ref: string, opts?: MaterializeOptions): Promise<MaterializeResult>;
	status(ref: string): Promise<SourceStatus>;
	refresh(ref: string, opts?: MaterializeOptions): Promise<MaterializeResult>;
	/** Advertise the sources this provider offers to materialize — the DISCOVERY step
	 * that precedes `materialize`. Part of the contract: every source:v1 answers "which
	 * sources do you offer?". A ref-open provider (git/local) legitimately returns an
	 * empty catalog (it materializes any ref, it has no finite list); a ref-closed
	 * provider returns its real list. */
	discover(): Promise<SourceCatalog>;
}

export interface SourceConformanceResult {
	pass: boolean;
	total: number;
	failed: number;
	failures: string[];
}
