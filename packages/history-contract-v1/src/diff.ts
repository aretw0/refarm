import type { KnowledgeRecord, RecordSection, RecordRelation, RecordAttachment } from "@refarm.dev/records-contract-v1";

import type { RecordDiff, RecordFieldChange } from "./types.js";

/** Deterministic serialization for deep value comparison — sorted keys, recursive (mirrors the
 * records contract's own stableStringify, kept local to avoid depending on an internal). PURE. */
function stableStringify(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
	if (value && typeof value === "object") {
		const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
		return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
	}
	return JSON.stringify(value);
}

/** Are two values deeply equal (order-insensitive on object keys)? PURE. */
function deepEqual(a: unknown, b: unknown): boolean {
	return stableStringify(a) === stableStringify(b);
}

/** Diff two flat key→value maps under a path prefix, emitting added/removed/changed. */
function diffMap(
	prefix: string,
	before: Record<string, unknown>,
	after: Record<string, unknown>,
	changes: RecordFieldChange[],
): void {
	const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
	for (const key of [...keys].sort()) {
		const path = `${prefix}.${key}`;
		const inBefore = key in before;
		const inAfter = key in after;
		if (inBefore && !inAfter) changes.push({ kind: "removed", path, before: before[key] });
		else if (!inBefore && inAfter) changes.push({ kind: "added", path, after: after[key] });
		else if (!deepEqual(before[key], after[key]))
			changes.push({ kind: "changed", path, before: before[key], after: after[key] });
	}
}

/** Index sections by their `key` (a note's body parts). */
function sectionsByKey(sections: readonly RecordSection[] | undefined): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	for (const s of sections ?? []) out[s.key] = s.content;
	return out;
}

/** Index relations by a stable `<type>→<target>` locator. */
function relationsByLocator(relations: readonly RecordRelation[] | undefined): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	for (const r of relations ?? []) out[`${r.type}→${r.target}`] = r.attrs ?? {};
	return out;
}

/** Index attachments by their id. */
function attachmentsById(attachments: readonly RecordAttachment[] | undefined): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	for (const a of attachments ?? []) out[a.id] = { ref: a.ref, mediaType: a.mediaType, hash: a.hash };
	return out;
}

/**
 * Compute the structural diff of two record versions — what changed field by field across
 * `fields`, `sections`, `relations`, `attachments`, `review`, and `sourceRefs`. `contentHash` is
 * derived, so it is never a change. When `before` is absent the record was created: every present
 * part is an `added`. PURE.
 */
export function diffRecords(before: KnowledgeRecord | undefined, after: KnowledgeRecord): RecordDiff {
	const changes: RecordFieldChange[] = [];

	diffMap("fields", (before?.fields ?? {}) as Record<string, unknown>, (after.fields ?? {}) as Record<string, unknown>, changes);
	diffMap("sections", sectionsByKey(before?.sections), sectionsByKey(after.sections), changes);
	diffMap("relations", relationsByLocator(before?.relations), relationsByLocator(after.relations), changes);
	diffMap("attachments", attachmentsById(before?.attachments), attachmentsById(after.attachments), changes);

	// Top-level single values compared whole: review, sourceRefs, and the record's own identity
	// facets (@type / schemaVersion / @context). The last three live OUTSIDE `fields`, so a schema
	// migration (an upcast that changes @type or schemaVersion) would otherwise be invisible to the
	// diff even though it changed the record — exactly the "what changed" a migration most needs.
	const whole: Array<[string, unknown, unknown]> = [
		["review", before?.review, after.review],
		["sourceRefs", before?.sourceRefs, after.sourceRefs],
		["@type", before?.["@type"], after["@type"]],
		["schemaVersion", before?.schemaVersion, after.schemaVersion],
		["@context", before?.["@context"], after["@context"]],
	];
	for (const [path, b, a] of whole) {
		if (deepEqual(b, a)) continue;
		if (b === undefined) changes.push({ kind: "added", path, after: a });
		else if (a === undefined) changes.push({ kind: "removed", path, before: b });
		else changes.push({ kind: "changed", path, before: b, after: a });
	}

	return {
		recordId: after.id,
		...(before ? { from: before.contentHash } : {}),
		to: after.contentHash,
		changes,
	};
}
