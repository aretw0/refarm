export const ENRICHMENT_CAPABILITY = "enrichment:v1" as const;

export type EnrichmentMode = "dry-run" | "apply";

export type EnrichmentErrorCode =
	| "NO_KEY"
	| "NO_MATCH"
	| "UNAVAILABLE"
	| "INVALID_INPUT"
	| "INTERNAL";

export interface EnrichmentInput {
	id: string;
	fields: Record<string, unknown>;
	sourceRef?: string;
}

export interface EnrichmentProvenance {
	providerId: string;
	ruleId?: string;
	key: string;
	sourceRef?: string;
	hash: string;
	at: string;
}

export interface EnrichmentChange {
	field: string;
	before: unknown;
	after: unknown;
	provenance: EnrichmentProvenance;
}

export interface EnrichmentSkipped {
	code: EnrichmentErrorCode;
	message?: string;
}

export interface EnrichmentRecordResult {
	id: string;
	changes: EnrichmentChange[];
	skipped?: EnrichmentSkipped;
}

export interface EnrichmentDiagnostics {
	total: number;
	enriched: number;
	skipped: number;
	byCode: Partial<Record<EnrichmentErrorCode, number>>;
}

export interface EnrichmentResult {
	mode: EnrichmentMode;
	records: EnrichmentRecordResult[];
	diagnostics: EnrichmentDiagnostics;
}

export interface EnrichmentProviderDescription {
	providerId: string;
	needsKeyFrom: string[];
	addsFields: string[];
}

export interface EnrichmentOptions {
	mode?: EnrichmentMode;
	signal?: AbortSignal;
}

/** Proven (./telemetry-shape-proof.ts, `tsc`-enforced) structurally identical to
 * an instantiation of `CapabilityTelemetryEvent<typeof ENRICHMENT_CAPABILITY,
 * "describe"|"select"|"enrich", EnrichmentErrorCode>` from
 * `@refarm.dev/capability-telemetry-v1` — the shared skeleton every
 * `*TelemetryEvent` across enrichment/identity/source/storage/sync-contract-v1
 * specializes. Kept as a literal interface here (not a `type X = Generic<...>`
 * alias) so this contract's declared-field surface stays visible to
 * `scripts/ci/check-contract-reachability.mjs`, which only recognizes a plain
 * `interface X { ... }` / `type X = { ... }` block — an alias or an `extends`
 * clause is invisible to its parser, which would silently drop this type from
 * the gate's tracked field universe. */
export interface EnrichmentTelemetryEvent {
	traceId: string;
	pluginId: string;
	capability: typeof ENRICHMENT_CAPABILITY;
	operation: "describe" | "select" | "enrich";
	durationMs: number;
	ok: boolean;
	errorCode?: EnrichmentErrorCode;
}

export interface EnrichmentProvider {
	readonly pluginId: string;
	readonly capability: typeof ENRICHMENT_CAPABILITY;
	describe(): EnrichmentProviderDescription;
	select(inputs: EnrichmentInput[]): EnrichmentInput[];
	enrich(inputs: EnrichmentInput[], options?: EnrichmentOptions): Promise<EnrichmentResult>;
}

export interface EnrichmentConformanceResult {
	pass: boolean;
	total: number;
	failed: number;
	failures: string[];
}
