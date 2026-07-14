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

/** Options for appending a revision. */
export interface AppendRevisionOptions {
	/** What produced this revision (the verb). */
	origin?: string;
	/** Keep at most this many revisions PER RECORD — the root (seq 1) plus the newest ones, so the
	 * chain stays anchored and recent history is intact. Absent/≤0 → unbounded. Each revision holds
	 * a full snapshot, so an uncapped store grows without limit under frequent changes; a cap trades
	 * old middle versions for a bounded manifest. `seq` and `parentHash` are preserved (the pruned
	 * middle leaves a gap the timeline shows honestly). PURE. */
	maxRevisions?: number;
}

/** Prune a record's revisions to at most `max` — keep the root (oldest) + the newest `max-1`. PURE. */
function pruneRecord(history: RecordHistoryStore, recordId: string, max: number): RecordHistoryStore {
	if (max <= 0) return history;
	const own = history.filter((r) => r.recordId === recordId).sort((a, b) => a.seq - b.seq);
	if (own.length <= max) return history;
	const keep = new Set([own[0]!.revisionId, ...own.slice(-(max - 1)).map((r) => r.revisionId)]);
	return history.filter((r) => r.recordId !== recordId || keep.has(r.revisionId));
}

/**
 * Append a revision for `record` — UNLESS its content is identical to the latest revision (a
 * re-pull/re-save of an unchanged record does not create a version — the dedup-by-hash lesson the
 * cache teaches). With `maxRevisions`, prunes old middle versions so the store stays bounded.
 * Returns a NEW store (does not mutate). PURE.
 *
 * Overload: `appendRevision(history, record, now, origin?)` (back-compat) or
 * `appendRevision(history, record, now, options)`.
 */
export function appendRevision(
	history: RecordHistoryStore,
	record: KnowledgeRecord,
	now: () => string,
	originOrOptions?: string | AppendRevisionOptions,
): RecordHistoryStore {
	const options: AppendRevisionOptions =
		typeof originOrOptions === "string" ? { origin: originOrOptions } : (originOrOptions ?? {});
	const prev = latestRevision(history, record.id);
	if (prev && prev.contentHash === record.contentHash) return history; // unchanged → no new version
	const appended = [...history, makeRevision(prev, record, now, options.origin)];
	return options.maxRevisions && options.maxRevisions > 0
		? pruneRecord(appended, record.id, options.maxRevisions)
		: appended;
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
