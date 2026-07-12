import type { MaterializeResult, SourceProvider } from "@refarm.dev/source-contract-v1";

export interface WebSourceSessionEvidence {
	kind: "fixture" | "authenticated";
	authenticated: boolean;
	principal?: string;
	startedAt?: string;
	expiresAt?: string;
	credentialRef?: string;
}

/** What a fetch driver is asked to retrieve: the URL, the session to use, any caller-supplied
 * headers (e.g. an OSLC client passes RDF Accept + Configuration-Context), and the target's
 * open driver `attributes` (e.g. the OSLC `componentURI`/`streamURI` the driver needs). */
export interface WebFetchRequest {
	url: string;
	session: WebSourceSessionEvidence;
	headers?: Record<string, string>;
	attributes?: Record<string, string>;
}

/** What a fetch driver returns: the retrieved body + its media type. A driver MAY throw a
 * `HttpFetchError` (below) so the caller can treat 401 as a recoverable re-auth signal. */
export interface WebFetchResult {
	body: string;
	mediaType: string;
}

/** The injected FETCH driver — how a live URL is actually retrieved (an OSLC/REST client, a
 * light browser driver). The substrate ships the mechanism around it (cache, egress, session);
 * the consumer brings this. Absent = offline fixture replay. */
export type WebFetchDriver = (request: WebFetchRequest) => Promise<WebFetchResult>;

export interface WebSourcePacingPolicy {
	maxRequestsPerMinute: number;
	backoffMs: number;
	userAgent?: string;
}

export interface WebSourceRedactionReport {
	applied: boolean;
	fields: string[];
}

export interface WebSourceEgressPolicy {
	allowedHosts: string[];
	blockPrivateHosts: boolean;
}

export interface WebSourceEgressReport {
	enforced: boolean;
	allowed: boolean;
	refKind: "fixture" | "http";
	host: string | null;
	policy: WebSourceEgressPolicy;
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
	/** OPEN driver coordinates — arbitrary key/values a fetch driver needs to retrieve this
	 * target, that are meaningless to the generic substrate. An OSLC driver reads e.g.
	 * `componentURI` / `streamURI` / `folderId` here; the substrate just carries them through.
	 * This is the generic-vs-specific seam: refarm ships "a target can carry driver attrs";
	 * the domain driver decides what they mean. */
	attributes?: Record<string, string>;
}

export interface WebSourceProvenance {
	session: WebSourceSessionEvidence;
	pacing: WebSourcePacingPolicy;
	cache: WebSourceCacheProvenance;
	redaction: WebSourceRedactionReport;
	egress: WebSourceEgressReport;
}

export interface WebSourceMaterializeResult extends MaterializeResult {
	web: WebSourceProvenance;
}

export interface WebSourceProvider extends SourceProvider {
	snapshotProvenance(ref: string): Promise<WebSourceProvenance | undefined>;
}
