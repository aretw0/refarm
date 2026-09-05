import {
	HttpFetchError,
	htmlToMarkdown,
	type CrawlLink,
	type CrawledPage,
	type WebFetchDriver,
} from "@refarm.dev/source-web";

/**
 * The GENERIC OSLC / IBM Jazz read toolkit — the protocol half of a live pull from an IBM ELM
 * family system (DOORS-Next / RM, EWM / CCM, QM). It speaks the OSLC 2.0 RDF request contract and
 * the RDF/XML wire shape that any Jazz deployment emits; it knows NOTHING about any one vendor's
 * vocabulary (no SERPRO/UST/codar, no project names, no `tipo` taxonomy). The domain layer — which
 * `rdf:type` means "business rule", how a record id is derived, which systems exist — stays with
 * the consumer as matcher-is-data, never in this package (the sovereign boundary).
 *
 * Everything here is pure or dependency-injected (the HTTP is a `fetchImpl`), so it is offline-
 * testable with canned RDF and, in a real deployment, driven by a fetch bound to an authenticated
 * Jazz session. It builds ON `@refarm.dev/source-web` (the substrate that injects the fetch driver,
 * enforces egress/session/cache, and runs the crawl engine); this is the reusable OSLC dialect on top.
 */

// ── OSLC request contract ─────────────────────────────────────────────────────────────────────

/**
 * The OSLC/RDF request headers a Jazz resource GET must send. `Configuration-Context` is per-target
 * — it carries the OSLC configuration (a stream/baseline URI) the artifact must be read under.
 */
export function oslcRequestHeaders(streamUri: string | undefined): Record<string, string> {
	const headers: Record<string, string> = {
		Accept: "application/rdf+xml",
		"OSLC-Core-Version": "2.0",
		"DoorsRP-Request-Type": "private",
	};
	if (streamUri) headers["Configuration-Context"] = streamUri;
	return headers;
}

/**
 * Build the OSLC fetch driver (a `source-web` `WebFetchDriver`). It merges the caller/provider
 * headers with the OSLC contract, pulls `Configuration-Context` from the target's `streamURI`
 * attribute, GETs the resource, and returns the RDF body. A non-OK response becomes an
 * `HttpFetchError` so a 401 stays a recoverable re-auth signal (an expired Jazz session surfaces
 * as a mid-run 401 the host can pause on and re-authenticate).
 */
export function createOslcFetchDriver(options: { fetchImpl?: typeof fetch } = {}): WebFetchDriver {
	const doFetch = options.fetchImpl ?? fetch;
	return async (request) => {
		const streamUri = request.attributes?.streamURI;
		const headers = { ...oslcRequestHeaders(streamUri), ...(request.headers ?? {}) };
		const response = await doFetch(request.url, { method: "GET", headers });
		if (!response.ok) {
			throw new HttpFetchError(response.status, request.url);
		}
		const body = await response.text();
		const mediaType = response.headers.get("content-type") ?? "application/rdf+xml";
		return { body, mediaType };
	};
}

// ── Project crawl — walk a Jazz project's link graph ─────────────────────────────────────────

/** Collect every distinct `rdf:resource="…"` URL referenced in a body (the way Jazz folder
 * listings, query-capability results, and link documents point at children and artifacts).
 * Deduped, order-preserving. PURE. */
export function oslcResourceRefs(body: string): string[] {
	const seen = new Set<string>();
	const re = /rdf:resource="([^"]+)"/g;
	let m: RegExpExecArray | null;
	while ((m = re.exec(body)) !== null) {
		const url = m[1]!;
		if (!seen.has(url)) seen.add(url);
	}
	return [...seen];
}

/** Does this URL look like a Jazz ARTIFACT resource (a leaf to parse) vs a folder/collection (a
 * node to descend)? Artifact URLs live under `/rm/resources/` (or `/ccm/resources/`); folders /
 * queries under `/folders/`, `/views/`, `/query…`. Heuristic + overridable via crawl options. */
export function isOslcArtifactUrl(url: string): boolean {
	return /\/(?:rm|ccm|qm)\/resources\//i.test(url);
}
export function isOslcCollectionUrl(url: string): boolean {
	return /\/(?:folders|views|query|collections)/i.test(url);
}

export interface OslcCrawlOptions {
	/** The Configuration-Context (streamURI) to carry on every discovered request. */
	streamURI?: string;
	/** Override the artifact-URL test (a deployment with a different URL scheme). */
	isArtifact?: (url: string) => boolean;
	/** Override the collection-URL test. */
	isCollection?: (url: string) => boolean;
}

/**
 * Build the OSLC crawl-link extractor: turn a fetched folder/collection body into the next URLs to
 * crawl. From each page it emits every referenced resource (artifacts and collections alike — the
 * crawl engine dedupes and depth-caps). Each link carries the target's `Configuration-Context` so a
 * discovered artifact GET authenticates against the same Jazz configuration. An artifact leaf yields
 * no further links (its body is parsed, not walked); unknown-shaped URLs are still enqueued once
 * (forward-safe) so a deployment whose URL scheme differs is not silently skipped.
 */
export function createOslcCrawlExtractor(options: OslcCrawlOptions = {}): (page: CrawledPage) => CrawlLink[] {
	const isArtifact = options.isArtifact ?? isOslcArtifactUrl;
	const isCollection = options.isCollection ?? isOslcCollectionUrl;
	const attributes = options.streamURI ? { streamURI: options.streamURI } : undefined;
	return (page: CrawledPage): CrawlLink[] => {
		if (isArtifact(page.url) && !isCollection(page.url)) return [];
		return oslcResourceRefs(page.body).map((url) => ({
			url,
			...(attributes ? { attributes } : {}),
		}));
	};
}

// ── Generic RDF/XML parsing helpers ──────────────────────────────────────────────────────────

/** First capture group of `re` in `text`, or undefined. PURE. */
export function firstRdfMatch(re: RegExp, text: string): string | undefined {
	const m = re.exec(text);
	return m?.[1];
}

/** Split an RDF/XML document into per-resource blocks on `rdf:Description` / `oslc_*:*` resource
 * boundaries, so each artifact can be parsed independently. PURE. The `boundaryTags` default covers
 * the common Jazz shapes; a consumer can pass its own for a dialect. */
export function splitOslcResourceBlocks(
	body: string,
	boundaryTags: readonly string[] = ["rdf:Description", "oslc_rm:Requirement", "oslc_cm:ChangeRequest"],
): string[] {
	const alternation = boundaryTags.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
	const re = new RegExp(`(?=<(?:${alternation})\\b)`);
	return body.split(re);
}

/** Render a Jazz `jazz_rm:primaryText` (or any XHTML blob under `tag`) into Markdown, preserving
 * the rich body (acceptance-criteria tables, embedded links) via source-web's htmlToMarkdown. PURE. */
export function oslcPrimaryTextToMarkdown(block: string, tag = "jazz_rm:primaryText"): string {
	const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const primary = firstRdfMatch(new RegExp(`<${escaped}[^>]*>([\\s\\S]*?)</${escaped}>`), block);
	if (!primary) return "";
	return htmlToMarkdown(primary);
}

// ── Attachment coordinate — a Jazz file artifact wrapping a binary ─────────────────────────────

/** The attachment a Jazz artifact wraps when it is a file artifact: the binary's own URI (to GET
 * the bytes), its declared content type, and a title for the filename/extension. */
export interface OslcAttachmentRef {
	wrappedResourceUri: string;
	contentType?: string;
	title?: string;
}

/** Extract the attachment coordinate from an artifact RDF body — a Jazz file artifact carries
 * `public_rm_10:wrappedResource` (the binary URI) + `wrappedResourceContentType`. Returns undefined
 * for a plain (text) artifact. PURE. */
export function extractOslcAttachmentRef(body: string): OslcAttachmentRef | undefined {
	const wrappedResourceUri = firstRdfMatch(
		/<public_rm_10:wrappedResource\s+rdf:resource="([^"]+)"\s*\/>/,
		body,
	);
	if (!wrappedResourceUri) return undefined;
	const contentType = firstRdfMatch(
		/<public_rm_10:wrappedResourceContentType[^>]*>([^<]+)<\/public_rm_10:wrappedResourceContentType>/,
		body,
	)?.trim();
	const title = firstRdfMatch(/<dcterms:title[^>]*>([^<]*)</, body)?.trim();
	return {
		wrappedResourceUri,
		...(contentType ? { contentType } : {}),
		...(title ? { title } : {}),
	};
}

// ── OSLC traceability links ────────────────────────────────────────────────────────────────

/**
 * OSLC (and common Jazz) link predicates → a neutral relation vocabulary. Traceability is the heart
 * of ALM ("derives / satisfies / decomposes / references"); these are the canonical predicates a
 * Jazz system emits between artifacts. Matched on the local name (after `:` or `#`). Data, not code
 * — a consumer extends the map for their ALM's dialect. */
export const OSLC_RELATION_PREDICATES: Record<string, string> = {
	elaboratedby: "elaborates",
	elaborates: "elaborates",
	decomposedby: "decomposes",
	decomposes: "decomposes",
	satisfiedby: "satisfies",
	satisfies: "satisfies",
	trackedby: "tracked-by",
	affectedby: "affected-by",
	constrainedby: "constrained-by",
	references: "references",
	validatedby: "validated-by",
};

/** One traceability link parsed from a block: the mapped relation type + the target artifact URI. */
export interface OslcRelationLink {
	type: string;
	targetUri: string;
}

/**
 * Extract the OSLC traceability links from one RDF block — every `<ns:predicate rdf:resource="URI"/>`
 * whose predicate local-name is in `predicates` (defaults to `OSLC_RELATION_PREDICATES`). The
 * artifact's own type/about triples are not links. PURE. */
export function extractOslcRelationLinks(
	block: string,
	predicates: Record<string, string> = OSLC_RELATION_PREDICATES,
): OslcRelationLink[] {
	const links: OslcRelationLink[] = [];
	const re = /<[a-zA-Z0-9_]+:([a-zA-Z0-9_]+)\b[^>]*\brdf:resource="([^"]+)"[^>]*\/?>/g;
	let m: RegExpExecArray | null;
	while ((m = re.exec(block)) !== null) {
		const localName = (m[1] ?? "").toLowerCase();
		const targetUri = m[2] ?? "";
		const type = predicates[localName];
		if (type && targetUri) links.push({ type, targetUri });
	}
	return links;
}
