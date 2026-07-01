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

export interface SourceTelemetryEvent {
	traceId: string;
	pluginId: string;
	capability: typeof SOURCE_CAPABILITY;
	operation: "resolve" | "materialize" | "status" | "refresh";
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
}

export interface SourceConformanceResult {
	pass: boolean;
	total: number;
	failed: number;
	failures: string[];
}
