import { createHash } from "node:crypto";

import type { SourceRecordParser } from "@refarm.dev/capability-host/node";
import { stampProvenance } from "@refarm.dev/provenance-contract-v1";
import {
	createOslcCrawlExtractor,
	createOslcFetchDriver,
	extractOslcAttachmentRef,
	extractOslcRelationLinks,
	firstRdfMatch,
	oslcPrimaryTextToMarkdown,
	oslcRequestHeaders,
	splitOslcResourceBlocks,
	type OslcAttachmentRef,
	type OslcCrawlOptions,
	type OslcRelationLink,
} from "@refarm.dev/source-oslc";

/**
 * The RM / requirements DOMAIN layer of a live OSLC pull — the analyst's taxonomy on top of the
 * generic protocol. The protocol half (OSLC request contract, fetch driver, project crawl, RDF
 * parsing, traceability links, attachments) now lives in `@refarm.dev/source-oslc` — a refarm SDK
 * block. THIS keeps only what is genuinely the analyst's: which `rdf:type` maps to which `tipo`, the
 * record-id scheme, the `sistema` axis, and how a requirement record is shaped. That split IS the
 * sovereign boundary in practice: refarm owns the generic OSLC dialect, the vault owns the vocabulary.
 */

// Re-export the generic toolkit under the names this bench already uses, so nothing downstream
// changes — the bench imports the OSLC protocol from here, and here just forwards refarm's SDK block.
export { createOslcCrawlExtractor, createOslcFetchDriver, oslcRequestHeaders };
export type { OslcAttachmentRef, OslcCrawlOptions };
/** Kept as an alias for existing importers; prefer `extractOslcAttachmentRef` from the package. */
export const extractAttachmentRef = extractOslcAttachmentRef;

// ── RM taxonomy (the analyst's, not the substrate's) ─────────────────────────────────────────

/**
 * The source SYSTEM a requirement belongs to, derived from its ingest ref (e.g. `web:efd` → `EFD`).
 * Stamped as `fields.sistema` so the analyst's taxonomy can route/group a multi-source vault by
 * system. The identity segment after the transport prefix, upper-cased. PURE.
 */
export function sistemaFromRef(ref: string): string {
	const identity = ref.includes(":") ? ref.slice(ref.indexOf(":") + 1) : ref;
	return identity.toUpperCase();
}

/** Map an RDF `rdf:type` (or a Jazz artifact-format hint) to the analyst's `tipo` vocabulary
 * (regra-de-negocio / caso-de-uso / funcional …). The taxonomy is the analyst's, not the substrate's. */
function tipoFromRdf(block: string): string {
	const typeUri = firstRdfMatch(/rdf:type\s+rdf:resource="([^"]+)"/, block) ?? "";
	const hint = `${typeUri} ${firstRdfMatch(/dcterms:type>([^<]*)</, block) ?? ""}`.toLowerCase();
	if (/regra|business.?rule|\brn\b/.test(hint)) return "regra-de-negocio";
	if (/use.?case|caso.?de.?uso|\bcdu\b|\buc\b/.test(hint)) return "caso-de-uso";
	if (/funcional|functional|\bfun\b/.test(hint)) return "funcional";
	if (/nao.?funcional|non.?functional/.test(hint)) return "nao-funcional";
	return "unspecified";
}

/** The record id derivation from an ALM requirement key — the SINGLE source of truth so a relation
 * target resolves to the exact id its target record is created with. */
function recordIdFromKey(key: string): string {
	return `record:req-${key.toLowerCase().replace(/[^a-z0-9]+/g, "")}`;
}

/**
 * Parse a Jazz RM RDF/XML document into requirement records. Each `oslc_rm:Requirement` (or
 * `rdf:Description` carrying a dcterms:identifier) becomes a record with the same shape the HTML
 * parser produces, so the rest of the bench (MOC, relations, enrichment) is identical whether the
 * body came from the offline fixture or a live OSLC fetch. Uses the generic RDF machinery from
 * `@refarm.dev/source-oslc`; applies only the analyst's taxonomy here.
 */
export const parseRequirementsFromRdf: SourceRecordParser = (body, context) => {
	const contentSha256 = createHash("sha256").update(body).digest("hex");
	const collectedAt = new Date().toISOString();
	const blocks = splitOslcResourceBlocks(body);

	interface Parsed {
		record: ReturnType<SourceRecordParser>[number];
		links: OslcRelationLink[];
	}
	const parsed: Parsed[] = [];
	const idByUri = new Map<string, string>();
	for (const block of blocks) {
		const key = firstRdfMatch(/<dcterms:identifier[^>]*>([^<]+)</, block);
		if (!key) continue; // not a requirement resource
		const title = firstRdfMatch(/<dcterms:title[^>]*>([^<]*)</, block)?.trim() ?? key;
		const artifactUri = firstRdfMatch(/rdf:about="([^"]+)"/, block);
		const tipo = tipoFromRdf(block);
		const text = oslcPrimaryTextToMarkdown(block);
		const id = recordIdFromKey(key);
		if (artifactUri) idByUri.set(artifactUri, id);
		parsed.push({
			links: extractOslcRelationLinks(block),
			record: {
				id,
				schemaVersion: 1,
				"@type": ["KnowledgeRecord", "Requirement"],
				"@context": "https://refarm.dev/contexts/records/v1",
				fields: stampProvenance(
					{
						title,
						tipo,
						status: "draft",
						externalKey: key,
						body: text,
						sistema: sistemaFromRef(context.ref),
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
			},
		});
	}

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
