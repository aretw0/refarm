import type { KnowledgeRecord } from "@refarm.dev/records-contract-v1";

/**
 * history:v1 — append-only REVISIONS of a KnowledgeRecord.
 *
 * A record's `contentHash` already fingerprints one version; nothing kept the PREVIOUS version,
 * so "what changed between two pulls/edits" was unanswerable (mergeRecords replaced by id, the
 * cache kept only a hash, provenance overwrote its snapshot). This contract fills that gap: each
 * time a record changes, its full snapshot is appended as a `RecordRevision`, so the timeline is
 * durable and a diff of any two versions is a pure function.
 *
 * Snapshots are complete (not diff-forward): the repo has no structural delta-apply engine
 * (`diffy` is line-based text), so a full snapshot is the only honest way to reconstruct a prior
 * version. Dedup by contentHash keeps an identical re-pull from versioning; the diff is computed
 * on demand, never persisted.
 */

export const HISTORY_CAPABILITY = "history:v1" as const;

/** One durable version of a record — its full snapshot plus its place in the chain. */
export interface RecordRevision {
	/** The `KnowledgeRecord.id` this is a revision of. */
	recordId: string;
	/** A unique id for THIS revision: `${recordId}@${contentHash}`. Unique per version, so a
	 * store that upserts by id (a NodeView) becomes append-only for revisions. */
	revisionId: string;
	/** 1-based monotonic sequence within a recordId (1 = the first version seen). */
	seq: number;
	/** The record's content fingerprint at this version (= `record.contentHash`). */
	contentHash: string;
	/** The previous revision's contentHash — the chain link. Absent on the root revision. */
	parentHash?: string;
	/** When this revision was recorded (ISO-8601). Injected — no ambient clock. */
	recordedAt: string;
	/** What produced this revision (the verb: "pull" | "import" | "correct" | "revoke" | …). */
	origin?: string;
	/** The COMPLETE record at this version — the snapshot a diff/reconstruct reads. */
	snapshot: KnowledgeRecord;
}

/** One field-level change between two record versions. `path` is a dotted/bracketed locator
 * (e.g. `fields.title`, `sections[description]`, `relations[elaborates→record:x]`). */
export type RecordFieldChange =
	| { kind: "added"; path: string; after: unknown }
	| { kind: "removed"; path: string; before: unknown }
	| { kind: "changed"; path: string; before: unknown; after: unknown };

/** The structural diff of two record versions — what changed, field by field. */
export interface RecordDiff {
	recordId: string;
	/** The base version's contentHash (absent = the record was created). */
	from?: string;
	/** The target version's contentHash. */
	to: string;
	changes: RecordFieldChange[];
}

/** The append-only revision store — a flat list of revisions across all records. Hung on the
 * RecordsManifest (`revisions?`) or held in a separate ledger; the shape is the same. */
export type RecordHistoryStore = RecordRevision[];
