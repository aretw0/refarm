import { computeRecordContentHash, type KnowledgeRecord } from "@refarm.dev/records-contract-v1";
import { describe, expect, it } from "vitest";

import { preserveCuration } from "./persona.js";

/**
 * The curation-revert guard: a routine re-pull refreshes a requirement's CONTENT but must never
 * revert the human curation layered on top of it — the review state a human set, or the RDF-derived
 * relations the HTML pull doesn't even parse. Before this, a pull re-declared review:draft and the
 * merge replaced the whole record, so a review silently reverted and the traceability graph
 * dropped to zero on the next HTML refresh.
 */
function rec(id: string, extra: Partial<KnowledgeRecord>): KnowledgeRecord {
	return {
		id,
		schemaVersion: 1,
		"@type": ["KnowledgeRecord", "Requirement"],
		fields: { title: "req", tipo: "regra-de-negocio" },
		sections: [{ key: "conteudo", content: "corpo" }],
		contentHash: "x",
		...extra,
	} as KnowledgeRecord;
}

describe("preserveCuration — a re-pull refreshes content without reverting human curation", () => {
	it("keeps the existing review when the pulled record declares none", () => {
		const existing = rec("record:req-1", {
			review: { state: "reviewed", at: "2026-07-10T00:00:00Z" },
			fields: { title: "antigo", tipo: "regra-de-negocio" },
		});
		const incoming = rec("record:req-1", { fields: { title: "atualizado", tipo: "regra-de-negocio" } });

		const merged = preserveCuration(existing, incoming);

		// Review survived the pull …
		expect(merged.review).toEqual({ state: "reviewed", at: "2026-07-10T00:00:00Z" });
		// … but the content was refreshed.
		expect(merged.fields.title).toBe("atualizado");
	});

	it("recomputes the content hash when curation is carried (no stale hash → no phantom revision)", () => {
		// review is an input to the content hash; a parser computes the incoming hash review-less.
		// Carrying review must RECOMPUTE the hash — else the record ships a hash that neither validates
		// nor dedups, and appendRevision records a phantom 'pull' revision on an unchanged re-pull.
		const existing = rec("record:req-1", { review: { state: "reviewed", at: "2026-07-10T00:00:00Z" } });
		const incoming = rec("record:req-1", {}); // a pull declares no review

		const merged = preserveCuration(existing, incoming);

		// The hash is CONSISTENT with the merged content (not the stale "x" fixture value).
		expect(merged.contentHash).toBe(computeRecordContentHash(merged));
		expect(merged.contentHash).not.toBe("x");
	});

	it("keeps existing relations when the pulled record has none (an HTML pull never parses them)", () => {
		const existing = rec("record:req-1", {
			relations: [{ type: "elaborates", target: "record:req-2", attrs: { direction: "outgoing" } }],
		});
		const incoming = rec("record:req-1", {}); // HTML pull: no relations

		const merged = preserveCuration(existing, incoming);

		expect(merged.relations).toHaveLength(1);
		expect(merged.relations?.[0]?.target).toBe("record:req-2");
	});

	it("lets the pulled record win when it DOES declare review/relations (RDF pull is authoritative)", () => {
		const existing = rec("record:req-1", {
			review: { state: "reviewed" },
			relations: [{ type: "old", target: "record:req-x" }],
		});
		const incoming = rec("record:req-1", {
			review: { state: "draft" },
			relations: [{ type: "refines", target: "record:req-y" }],
		});

		const merged = preserveCuration(existing, incoming);

		expect(merged.review).toEqual({ state: "draft" });
		expect(merged.relations?.[0]?.type).toBe("refines");
	});
});
