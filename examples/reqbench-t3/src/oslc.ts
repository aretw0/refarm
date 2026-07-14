import type { SourceRecordParser } from "@refarm.dev/capability-host/node";
import { stampProvenance } from "@refarm.dev/provenance-contract-v1";
import { HttpFetchError, htmlToMarkdown, type CrawlLink, type CrawledPage, type WebFetchDriver } from "@refarm.dev/source-web";
import { createHash } from "node:crypto";

/**
 * The analyst's OSLC/Jazz driver — the DOMAIN half of a live requirements pull. The substrate
 * (@refarm.dev/source-web) ships the seams (a fetch driver is injected, a target carries open
 * `attributes`, egress/session/cache are enforced); THIS knows what an IBM Jazz / DOORS-Next
 * RM system speaks: the OSLC RDF request contract and the RDF/XML wire shape. A different
 * analyst's system would ship a different driver. Nothing here is named in refarm.
 *
 * It is intentionally self-contained and testable: the HTTP is injected (`fetchImpl`), so an
 * offline test drives it with a canned RDF response, and a real deployment injects a fetch
 * bound to an authenticated browser/session (login-garantido, block D).
 */

/** The OSLC/RDF request headers a Jazz RM resource GET must send (per the real vault). The
 * `Configuration-Context` is per-target — it comes from the target's `streamURI` attribute. */
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
 * Build the OSLC fetch driver. It merges the caller/provider headers with the OSLC contract,
 * pulling `Configuration-Context` from the target's `streamURI` attribute, GETs the resource,
 * and returns the RDF body. A non-OK response becomes an HttpFetchError so 401 stays a
 * recoverable re-auth signal (the vault treats an expired Jazz session as a mid-run 401).
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

// --- OSLC project discovery — the CrawlLinkExtractor that walks a Jazz RM project ---

/** Collect every distinct `rdf:resource="…"` URL referenced in a body (the way Jazz RM folder
 * listings, query-capability results, and `/rm/links` documents point at children and
 * artifacts). Deduped, order-preserving. */
function resourceRefs(body: string): string[] {
	const seen = new Set<string>();
	const re = /rdf:resource="([^"]+)"/g;
	let m: RegExpExecArray | null;
	while ((m = re.exec(body)) !== null) {
		const url = m[1]!;
		if (!seen.has(url)) seen.add(url);
	}
	return [...seen];
}

/** Does this URL look like a Jazz RM ARTIFACT resource (a leaf to parse) vs a folder/collection
 * (a node to descend)? Jazz artifact URLs live under `/rm/resources/`; folders/queries under
 * `/rm/folders/`, `/rm/views/`, `/rm/query…`. Heuristic + overridable via options. */
function isArtifactUrl(url: string): boolean {
	return /\/rm\/resources\//i.test(url);
}
function isCollectionUrl(url: string): boolean {
	return /\/rm\/(folders|views|query|collections)/i.test(url);
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
 * Build the OSLC `CrawlLinkExtractor` that turns a fetched folder/collection body into the next
 * URLs to crawl — the domain half of a whole-project scrape. From each page it emits every
 * referenced resource: artifact URLs and collection URLs alike are enqueued (the crawl engine
 * dedupes and depth-caps). Each link carries the target's `Configuration-Context` so a
 * discovered artifact GET authenticates against the same Jazz configuration.
 *
 * The engine is domain-blind (it only fetches + dedupes); THIS decides what an ALM project's
 * link graph is. An artifact leaf yields no further links (its body is parsed, not walked); a
 * collection yields its children. Unknown-shaped URLs are still enqueued once (forward-safe) so
 * a deployment whose URL scheme differs is not silently skipped.
 */
export function createOslcCrawlExtractor(options: OslcCrawlOptions = {}) {
	const isArtifact = options.isArtifact ?? isArtifactUrl;
	const isCollection = options.isCollection ?? isCollectionUrl;
	const attributes = options.streamURI ? { streamURI: options.streamURI } : undefined;
	return (page: CrawledPage): CrawlLink[] => {
		// An artifact leaf is parsed for records, not walked for more links.
		if (isArtifact(page.url) && !isCollection(page.url)) return [];
		return resourceRefs(page.body).map((url) => ({
			url,
			...(attributes ? { attributes } : {}),
		}));
	};
}

// --- Attachment coordinate — a Jazz RM artifact that wraps a binary file ---

/** The attachment a Jazz RM artifact wraps, when it is a file artifact: the binary's own URI
 * (to GET the bytes), its declared content type, and a title for the filename/extension. */
export interface OslcAttachmentRef {
	/** The wrapped binary's resource URI — the URL to download the bytes from. */
	wrappedResourceUri: string;
	contentType?: string;
	title?: string;
}

/** Extract the attachment coordinate from an artifact RDF body — a Jazz RM file artifact carries
 * `public_rm_10:wrappedResource` (the binary URI) + `wrappedResourceContentType`. Returns
 * undefined for a plain (text) requirement. Mirrors the operational scraper's field names. */
export function extractAttachmentRef(body: string): OslcAttachmentRef | undefined {
	const wrappedResourceUri = firstMatch(
		/<public_rm_10:wrappedResource\s+rdf:resource="([^"]+)"\s*\/>/,
		body,
	);
	if (!wrappedResourceUri) return undefined;
	const contentType = firstMatch(
		/<public_rm_10:wrappedResourceContentType[^>]*>([^<]+)<\/public_rm_10:wrappedResourceContentType>/,
		body,
	)?.trim();
	const title = firstMatch(/dcterms:title[^>]*>([^<]*)</, body)?.trim();
	return {
		wrappedResourceUri,
		...(contentType ? { contentType } : {}),
		...(title ? { title } : {}),
	};
}

// --- RDF/XML → requirement records (mirrors the vault's parseArtifactRdf, by regex) ---

function firstMatch(re: RegExp, text: string): string | undefined {
	const m = re.exec(text);
	return m?.[1];
}

/**
 * The source SYSTEM a requirement belongs to, derived from its ingest ref (e.g. `web:efd` → `EFD`,
 * `web:nfe` → `NFE`). Stamped as `fields.sistema` so the analyst's taxonomy can route/group a
 * multi-source vault by system (the second axis, otherwise inert because nothing wrote the field).
 * The identity segment after the transport prefix, upper-cased. PURE.
 */
export function sistemaFromRef(ref: string): string {
	const identity = ref.includes(":") ? ref.slice(ref.indexOf(":") + 1) : ref;
	return identity.toUpperCase();
}

/** Map an RDF `rdf:type` (or a Jazz artifact-format hint) to the analyst's `tipo` vocabulary
 * (regra-de-negocio / caso-de-uso / funcional …). Kept small and explicit — the taxonomy is
 * the analyst's, not the substrate's. */
function tipoFromRdf(block: string): string {
	const typeUri = firstMatch(/rdf:type\s+rdf:resource="([^"]+)"/, block) ?? "";
	const hint = `${typeUri} ${firstMatch(/dcterms:type>([^<]*)</, block) ?? ""}`.toLowerCase();
	if (/regra|business.?rule|\brn\b/.test(hint)) return "regra-de-negocio";
	if (/use.?case|caso.?de.?uso|\bcdu\b|\buc\b/.test(hint)) return "caso-de-uso";
	if (/funcional|functional|\bfun\b/.test(hint)) return "funcional";
	if (/nao.?funcional|non.?functional/.test(hint)) return "nao-funcional";
	return "unspecified";
}

/** Render a jazz_rm:primaryText XHTML blob into Markdown — an ALM primaryText carries the
 * requirement's rich body (tables of acceptance criteria, links to related requirements), so
 * the substrate's htmlToMarkdown preserves that structure instead of the old flat tag-strip. */
function textFromPrimary(block: string): string {
	const primary = firstMatch(/jazz_rm:primaryText[^>]*>([\s\S]*?)<\/jazz_rm:primaryText>/, block);
	if (!primary) return "";
	return htmlToMarkdown(primary);
}

/** The record id derivation from an ALM requirement key — the SINGLE source of truth so a
 * relation target resolves to the exact id its target record is created with. */
function recordIdFromKey(key: string): string {
	return `record:req-${key.toLowerCase().replace(/[^a-z0-9]+/g, "")}`;
}

/**
 * OSLC-RM (and common Jazz) link predicates → the analyst's relation vocabulary. Traceability is
 * the heart of requirements management ("deriva de / satisfaz / decompõe / referencia"); these are
 * the canonical predicates a Jazz RM system emits between artifacts. The local name (after `:` or
 * `#`) is matched, so both `oslc_rm:elaboratedBy` and a fully-qualified form resolve. Data, not
 * code — an analyst extends the map for their ALM's dialect.
 */
const OSLC_RELATION_PREDICATES: Record<string, string> = {
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

/** One raw link parsed from a block: the OSLC predicate's mapped relation type + the target
 * artifact URI (resolved to a record id in a second pass, once all keys are known). */
interface RawRdfLink {
	type: string;
	targetUri: string;
}

/**
 * Extract the OSLC-RM traceability links from one RDF block — every `<ns:predicate
 * rdf:resource="URI"/>` whose predicate local-name is a known relation predicate. The
 * requirement's OWN type/about triples are not links (they're captured elsewhere), so only the
 * mapped predicates yield relations. PURE.
 */
function extractRdfLinks(block: string): RawRdfLink[] {
	const links: RawRdfLink[] = [];
	// Match `<prefix:localName ... rdf:resource="URI" ... />` — capture the local name + URI.
	const re = /<[a-zA-Z0-9_]+:([a-zA-Z0-9_]+)\b[^>]*\brdf:resource="([^"]+)"[^>]*\/?>/g;
	let m: RegExpExecArray | null;
	while ((m = re.exec(block)) !== null) {
		const localName = (m[1] ?? "").toLowerCase();
		const targetUri = m[2] ?? "";
		const type = OSLC_RELATION_PREDICATES[localName];
		if (type && targetUri) links.push({ type, targetUri });
	}
	return links;
}

/**
 * Parse a Jazz RM RDF/XML document into requirement records. Each `oslc_rm:Requirement` (or
 * `rdf:Description` carrying a dcterms:identifier) becomes a record with the same shape the
 * HTML parser produces, so the rest of the bench (MOC, relations, enrichment) is identical
 * whether the body came from the offline fixture or a live OSLC fetch.
 */
export const parseRequirementsFromRdf: SourceRecordParser = (body, context) => {
	const contentSha256 = createHash("sha256").update(body).digest("hex");
	const collectedAt = new Date().toISOString();
	// Split into per-resource blocks on rdf:Description / oslc_rm:Requirement boundaries.
	const blocks = body.split(/(?=<(?:rdf:Description|oslc_rm:Requirement)\b)/);

	// PASS 1 — parse each requirement + its raw links, and map every artifact URI to the record id
	// it becomes, so PASS 2 can resolve a link's target URI to a concrete record id.
	interface Parsed {
		record: ReturnType<SourceRecordParser>[number];
		links: RawRdfLink[];
	}
	const parsed: Parsed[] = [];
	const idByUri = new Map<string, string>();
	for (const block of blocks) {
		const key = firstMatch(/dcterms:identifier>([^<]+)</, block);
		if (!key) continue; // not a requirement resource
		const title = firstMatch(/dcterms:title[^>]*>([^<]*)</, block)?.trim() ?? key;
		const artifactUri = firstMatch(/rdf:about="([^"]+)"/, block);
		const tipo = tipoFromRdf(block);
		const text = textFromPrimary(block);
		const id = recordIdFromKey(key);
		if (artifactUri) idByUri.set(artifactUri, id);
		parsed.push({
			links: extractRdfLinks(block),
			record: {
				id,
				schemaVersion: 1,
				"@type": ["KnowledgeRecord", "Requirement"],
				"@context": "https://refarm.dev/contexts/records/v1",
				// Provenance (provenance:v1): a LIVE pull's origin link is the artifact's own
				// Jazz/ALM URI — the exact coordinate to re-fetch it, fingerprinted and timed.
				fields: stampProvenance(
					{
						title,
						tipo,
						status: "draft",
						externalKey: key,
						body: text,
						// The source SYSTEM (from the ingest ref) — powers the taxonomy's `sistema` axis
						// so a multi-source vault routes/groups by system.
						sistema: sistemaFromRef(context.ref),
						// The Jazz coordinate, preserved on the record (the vault's alm_artifact_uri).
						...(artifactUri ? { artifactUri } : {}),
					},
					{
						channel: "requirements-pull",
						originLink: artifactUri ?? context.ref,
						sourcePath: context.location,
						...(context.mediaType ? { mediaType: context.mediaType } : {}),
						collectedAt,
						contentSha256,
					},
				),
				sections: [{ key: "conteudo", content: text }],
				sourceRefs: [context.ref],
				review: { state: "draft" },
			},
		});
	}

	// PASS 2 — resolve each raw link to a RecordRelation. A link whose target artifact is in THIS
	// document resolves to that record's id (an in-corpus edge the graph/MOC draw); a link to an
	// artifact outside the document keeps its URI as the target (a dangling edge a health check can
	// surface), stamped so the analyst sees it points outside the pulled set.
	for (const { record, links } of parsed) {
		if (links.length === 0) continue;
		const relations = links.map((link) => {
			const resolved = idByUri.get(link.targetUri);
			return resolved
				? { type: link.type, target: resolved, attrs: { direction: "outgoing" as const } }
				: { type: link.type, target: link.targetUri, attrs: { direction: "outgoing" as const, external: true } };
		});
		record.relations = relations;
	}

	return parsed.map((p) => p.record);
};
