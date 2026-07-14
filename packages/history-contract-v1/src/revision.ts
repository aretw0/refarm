import type { KnowledgeRecord } from "@refarm.dev/records-contract-v1";

import type { RecordHistoryStore, RecordRevision } from "./types.js";

/** The latest revision recorded for a record, or undefined if none. PURE. */
export function latestRevision(history: RecordHistoryStore, recordId: string): RecordRevision | undefined {
	let latest: RecordRevision | undefined;
	for (const rev of history) {
		if (rev.recordId === recordId && (!latest || rev.seq > latest.seq)) latest = rev;
	}
	return latest;
}

/** Build the next revision of a record given its previous revision (if any). PURE. */
export function makeRevision(
	prev: RecordRevision | undefined,
	record: KnowledgeRecord,
	now: () => string,
	origin?: string,
): RecordRevision {
	return {
		recordId: record.id,
		revisionId: `${record.id}@${record.contentHash}`,
		seq: (prev?.seq ?? 0) + 1,
		contentHash: record.contentHash,
		...(prev ? { parentHash: prev.contentHash } : {}),
		recordedAt: now(),
		...(origin ? { origin } : {}),
		snapshot: record,
	};
}

/**
 * Append a revision for `record` — UNLESS its content is identical to the latest revision (a
 * re-pull/re-save of an unchanged record does not create a version — the dedup-by-hash lesson the
 * cache teaches). Returns a NEW store (does not mutate). PURE.
 */
export function appendRevision(
	history: RecordHistoryStore,
	record: KnowledgeRecord,
	now: () => string,
	origin?: string,
): RecordHistoryStore {
	const prev = latestRevision(history, record.id);
	if (prev && prev.contentHash === record.contentHash) return history; // unchanged → no new version
	return [...history, makeRevision(prev, record, now, origin)];
}

/** The full timeline of a record's revisions, oldest → newest. PURE. */
export function timeline(history: RecordHistoryStore, recordId: string): RecordRevision[] {
	return history.filter((r) => r.recordId === recordId).sort((a, b) => a.seq - b.seq);
}

/** The revision of a record at a given contentHash, or undefined. PURE. */
export function revisionAt(
	history: RecordHistoryStore,
	recordId: string,
	contentHash: string,
): RecordRevision | undefined {
	return history.find((r) => r.recordId === recordId && r.contentHash === contentHash);
}
