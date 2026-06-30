import type {
	MaterializeResult,
	SourceProvider,
} from "@refarm.dev/source-contract-v1";

export interface WebSourceSessionEvidence {
	kind: "fixture" | "authenticated";
	authenticated: boolean;
	principal?: string;
	startedAt?: string;
	expiresAt?: string;
	credentialRef?: string;
}

export interface WebSourcePacingPolicy {
	maxRequestsPerMinute: number;
	backoffMs: number;
	userAgent?: string;
}

export interface WebSourceRedactionReport {
	applied: boolean;
	fields: string[];
}

export interface WebSourceCacheProvenance {
	identity: string;
	ref: string;
	capturedAt: string;
	hash: string;
	offlineReplay: boolean;
}

export interface WebSourceSnapshot {
	identity: string;
	url: string;
	mediaType: string;
	body: string;
	session: WebSourceSessionEvidence;
	pacing: WebSourcePacingPolicy;
	redaction: WebSourceRedactionReport;
	capturedAt: string;
}

export interface WebSourceProvenance {
	session: WebSourceSessionEvidence;
	pacing: WebSourcePacingPolicy;
	cache: WebSourceCacheProvenance;
	redaction: WebSourceRedactionReport;
}

export interface WebSourceMaterializeResult extends MaterializeResult {
	web: WebSourceProvenance;
}

export interface WebSourceProvider extends SourceProvider {
	snapshotProvenance(ref: string): Promise<WebSourceProvenance | undefined>;
}
