export const RECORDS_CAPABILITY = "records:v1" as const;
export const RECORDS_MANIFEST_VERSION = 1 as const;
export const CURRENT_RECORD_SCHEMA_VERSION = 1 as const;

export interface RecordRelation {
	type: string;
	target: string;
	attrs?: Record<string, unknown>;
}

export interface RecordSection {
	key: string;
	content: string;
	attrs?: Record<string, unknown>;
}

export interface RecordAttachment {
	id: string;
	ref: string;
	mediaType?: string;
	hash?: string;
}

export interface RecordReview {
	state: string;
	at?: string;
	by?: string;
	notes?: string;
}

export interface KnowledgeRecord {
	id: string;
	schemaVersion: number;
	"@type"?: string | string[];
	"@context"?: string | Record<string, unknown>;
	fields: Record<string, unknown>;
	sections?: RecordSection[];
	relations?: RecordRelation[];
	attachments?: RecordAttachment[];
	sourceRefs?: string[];
	contentHash: string;
	review?: RecordReview;
	[extra: string]: unknown;
}

export interface RecordsManifest {
	manifestVersion: typeof RECORDS_MANIFEST_VERSION;
	records: KnowledgeRecord[];
	[extra: string]: unknown;
}

export interface RecordsValidationFailure {
	id?: string;
	message: string;
	path?: string;
}

export interface RecordsValidationResult {
	ok: boolean;
	failures: RecordsValidationFailure[];
}

export interface RecordsProvider {
	readonly pluginId: string;
	readonly capability: typeof RECORDS_CAPABILITY;
	validate(manifest: RecordsManifest): RecordsValidationResult;
	upcast(record: KnowledgeRecord): KnowledgeRecord;
}

export interface RecordsConformanceResult {
	pass: boolean;
	total: number;
	failed: number;
	failures: string[];
}
