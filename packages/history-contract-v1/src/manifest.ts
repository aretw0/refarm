import type { KnowledgeRecord, RecordsManifest } from "@refarm.dev/records-contract-v1";

import { appendRevision } from "./revision.js";
import type { RecordHistoryStore } from "./types.js";

/**
 * A RecordsManifest that also carries the append-only revision history. `revisions` is an
 * optional extra on the manifest (RecordsManifest allows unknown extras), so a manifest with
 * history round-trips through the existing load/save without any contract change.
 */
export interface VersionedRecordsManifest extends RecordsManifest {
	revisions?: RecordHistoryStore;
}

/** Read a manifest's revision history (empty when it has none). PURE. */
export function manifestRevisions(manifest: RecordsManifest): RecordHistoryStore {
	const revisions = (manifest as VersionedRecordsManifest).revisions;
	return Array.isArray(revisions) ? revisions : [];
}

/**
 * Merge incoming records into a manifest by id (new added, existing REPLACED with the incoming
 * version — the exact behaviour of the examples' hand-rolled mergeRecords) AND append a revision
 * for every incoming record whose content actually changed. This is the single insertion point
 * that gives every consumer durable history: swap `mergeRecords(m, incoming)` for
 * `mergeAndRecord(m, incoming, now, origin)`.
 *
 * `now` is injected (no ambient clock). `origin` labels what produced the change (the verb).
 * Unchanged re-saves do not create a version (dedup by contentHash, inside appendRevision). PURE.
 */
export function mergeAndRecord(
	manifest: RecordsManifest,
	incoming: readonly KnowledgeRecord[],
	now: () => string,
	origin?: string,
): VersionedRecordsManifest {
	const byId = new Map(manifest.records.map((r) => [r.id, r]));
	let revisions = manifestRevisions(manifest);
	for (const record of incoming) {
		byId.set(record.id, record);
		revisions = appendRevision(revisions, record, now, origin);
	}
	return { ...manifest, records: [...byId.values()], revisions };
}
