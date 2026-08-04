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
