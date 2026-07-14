import type { KnowledgeRecord } from "@refarm.dev/records-contract-v1";

/**
 * CORPUS HEALTH — cross-record analysis of a vault, the complement to per-note quality gates.
 *
 * A note-level gate ("this note has a tipo, a body, provenance") checks each record in isolation.
 * A vault also has health that only emerges from the WHOLE set: requirements that link to
 * nothing that exists (dangling traceability), requirements no one reaches and that reach no one
 * (orphans), and the same requirement ingested twice (duplicates). These are exactly the defects
 * a requirements analyst hunts, and none is visible one record at a time.
 *
 * Pure and substrate-level: it reads records and returns findings. A consumer (a requirements
 * bench, any vault app) renders them; the analysis is the reusable half.
 */

export type CorpusHealthKind = "dangling-relation" | "orphan" | "duplicate";

export interface CorpusHealthFinding {
	kind: CorpusHealthKind;
	/** The record the finding is about. */
	recordId: string;
	/** A human-readable description of the defect. */
	message: string;
	/** For dangling-relation: the unresolved target. For duplicate: the shared key/title. */
	detail?: string;
}

export interface CorpusHealthReport {
	total: number;
	findings: CorpusHealthFinding[];
	counts: Record<CorpusHealthKind, number>;
	/** True when no findings — the corpus is healthy. */
	healthy: boolean;
}

export interface CorpusHealthOptions {
	/** The fields (in order of preference) that identify a "same requirement" for duplicate
	 * detection. Default: `externalKey` then `title`. A record with none is not deduped. */
	identityFields?: string[];
	/** Relation targets matching this predicate are treated as EXTERNAL (out of corpus) and never
	 * counted as dangling — e.g. a live-parsed link stamped `attrs.external`. Default: any relation
	 * whose `attrs.external === true`. */
	isExternal?: (relation: { target: string; attrs?: Record<string, unknown> }) => boolean;
}

function identityValue(record: KnowledgeRecord, fields: string[]): string | undefined {
	for (const field of fields) {
		const value = record.fields?.[field];
		if (typeof value === "string" && value.trim()) return value.trim();
	}
	return undefined;
}

/**
 * Analyse a set of records for corpus-level health:
 *
 * - **dangling-relation**: a relation whose target is an in-corpus record id that does NOT exist.
 *   Targets flagged external (out of the pulled set) are skipped — they are expected to point out.
 * - **orphan**: a record with no outgoing (in-corpus) relations AND not the target of any — it sits
 *   alone in the traceability graph. (External-only relations do not connect a record in-corpus.)
 * - **duplicate**: two+ records sharing the same identity value (externalKey, then title) — the
 *   same requirement ingested more than once. Every record in a duplicate group is reported.
 *
 * PURE.
 */
export function analyzeCorpusHealth(
	records: readonly KnowledgeRecord[],
	options: CorpusHealthOptions = {},
): CorpusHealthReport {
	const identityFields = options.identityFields ?? ["externalKey", "title"];
	const isExternal =
		options.isExternal ?? ((relation) => relation.attrs?.external === true);
	const ids = new Set(records.map((r) => r.id));
	const findings: CorpusHealthFinding[] = [];

	// Which records are connected in-corpus (either direction) — for orphan detection.
	const connected = new Set<string>();
	for (const record of records) {
		for (const relation of record.relations ?? []) {
			if (isExternal(relation)) continue;
			// A dangling in-corpus target.
			if (!ids.has(relation.target)) {
				findings.push({
					kind: "dangling-relation",
					recordId: record.id,
					message: `relation "${relation.type}" points to a requirement that does not exist`,
					detail: relation.target,
				});
				continue;
			}
			// Both ends are connected.
			connected.add(record.id);
			connected.add(relation.target);
		}
	}

	// Orphans — no in-corpus connection either way. A single-record corpus is not an orphan
	// (nothing to relate to); only flag when there is more than one record.
	if (records.length > 1) {
		for (const record of records) {
			if (!connected.has(record.id)) {
				findings.push({
					kind: "orphan",
					recordId: record.id,
					message: "requirement has no traceability links to or from any other requirement",
				});
			}
		}
	}

	// Duplicates — group by identity value; any group of 2+ is a duplicate set.
	const byIdentity = new Map<string, KnowledgeRecord[]>();
	for (const record of records) {
		const key = identityValue(record, identityFields);
		if (!key) continue;
		const group = byIdentity.get(key) ?? [];
		group.push(record);
		byIdentity.set(key, group);
	}
	for (const [key, group] of byIdentity) {
		if (group.length < 2) continue;
		for (const record of group) {
			findings.push({
				kind: "duplicate",
				recordId: record.id,
				message: `requirement shares an identity with ${group.length - 1} other(s) — a possible duplicate`,
				detail: key,
			});
		}
	}

	const counts: Record<CorpusHealthKind, number> = {
		"dangling-relation": 0,
		orphan: 0,
		duplicate: 0,
	};
	for (const finding of findings) counts[finding.kind] += 1;

	return { total: records.length, findings, counts, healthy: findings.length === 0 };
}
