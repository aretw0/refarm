import type { SessionEntry, SessionEntryKind } from "./types.js";

export const SESSION_CONTEXT_FOLD_SCHEMA =
	"refarm.session-context-fold.v1" as const;

export const SESSION_CONTEXT_FOLD_DIGEST_ALGORITHM =
	"refarm-stable-fnv1a64-v1" as const;

export interface SessionContextFoldDigest {
	algorithm: typeof SESSION_CONTEXT_FOLD_DIGEST_ALGORITHM;
	value: string;
}

export interface SessionContextFoldEntryRef {
	entry_id: string;
	parent_entry_id: string | null;
	kind: SessionEntryKind;
	timestamp_ns: number;
	content_digest: SessionContextFoldDigest;
}

export interface SessionContextFoldRange {
	from_entry_id: string;
	to_entry_id: string;
	entry_count: number;
}

export interface SessionContextFold {
	"@type": "SessionContextFold";
	"@id": string;
	schema: typeof SESSION_CONTEXT_FOLD_SCHEMA;
	session_id: string;
	range: SessionContextFoldRange;
	digest: SessionContextFoldDigest;
	folded_entry_refs: SessionContextFoldEntryRef[];
	protected_tail_entry_ids: string[];
	summary: string | null;
	created_at_ns: number;
}

export interface SessionContextFoldPlan {
	fold: SessionContextFold;
	folded_entries: SessionEntry[];
	protected_tail_entries: SessionEntry[];
}

export interface PlanSessionContextFoldOptions {
	protectedTailCount?: number;
	nowNs?: () => number;
	id?: string;
	summary?: string | null;
}

export interface SessionContextUnfoldResult {
	entries: SessionEntry[];
	missing_entry_ids: string[];
	digest_mismatches: Array<{
		entry_id: string;
		expected: SessionContextFoldDigest;
		actual: SessionContextFoldDigest;
	}>;
}

function defaultNowNs(): number {
	return Date.now() * 1_000;
}

function normalizeProtectedTailCount(value: number | undefined): number {
	const count = value ?? 8;
	if (!Number.isInteger(count) || count < 0) {
		throw new Error("protectedTailCount must be a non-negative integer");
	}
	return count;
}

function compareEntries(a: SessionEntry, b: SessionEntry): number {
	const byTime = a.timestamp_ns - b.timestamp_ns;
	if (byTime !== 0) return byTime;
	return a["@id"].localeCompare(b["@id"]);
}

function stableStringify(value: unknown): string {
	if (value === undefined) return "null";
	if (value === null || typeof value !== "object") {
		return JSON.stringify(value);
	}

	if (Array.isArray(value)) {
		return `[${value.map((item) => stableStringify(item)).join(",")}]`;
	}

	const entries = Object.entries(value as Record<string, unknown>).sort(
		([left], [right]) => left.localeCompare(right),
	);
	return `{${entries
		.map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
		.join(",")}}`;
}

function stableHash(value: unknown): SessionContextFoldDigest {
	const text = typeof value === "string" ? value : stableStringify(value);
	let hash = 0xcbf29ce484222325n;
	const prime = 0x100000001b3n;
	const mask = 0xffffffffffffffffn;

	for (let index = 0; index < text.length; index++) {
		hash ^= BigInt(text.charCodeAt(index));
		hash = (hash * prime) & mask;
	}

	return {
		algorithm: SESSION_CONTEXT_FOLD_DIGEST_ALGORITHM,
		value: hash.toString(16).padStart(16, "0"),
	};
}

function entryRef(entry: SessionEntry): SessionContextFoldEntryRef {
	return {
		entry_id: entry["@id"],
		parent_entry_id: entry.parent_entry_id,
		kind: entry.kind,
		timestamp_ns: entry.timestamp_ns,
		content_digest: stableHash(entry.content),
	};
}

function assertSingleSession(entries: SessionEntry[]): string {
	const sessionId = entries[0]?.session_id;
	if (!sessionId) {
		throw new Error("Cannot fold entries without a session_id");
	}

	const mismatched = entries.find((entry) => entry.session_id !== sessionId);
	if (mismatched) {
		throw new Error(
			`Cannot fold entries from multiple sessions: ${sessionId} and ${mismatched.session_id}`,
		);
	}

	return sessionId;
}

export function digestSessionEntryContent(
	entry: Pick<SessionEntry, "content">,
): SessionContextFoldDigest {
	return stableHash(entry.content);
}

export function planSessionContextFold(
	entries: SessionEntry[],
	options: PlanSessionContextFoldOptions = {},
): SessionContextFoldPlan | null {
	const protectedTailCount = normalizeProtectedTailCount(
		options.protectedTailCount,
	);
	const ordered = [...entries].sort(compareEntries);
	if (ordered.length === 0 || ordered.length <= protectedTailCount) {
		return null;
	}

	const sessionId = assertSingleSession(ordered);
	const splitIndex = ordered.length - protectedTailCount;
	const foldedEntries = ordered.slice(0, splitIndex);
	const protectedTailEntries = ordered.slice(splitIndex);
	const foldedEntryRefs = foldedEntries.map(entryRef);
	const protectedTailEntryIds = protectedTailEntries.map((entry) => entry["@id"]);
	const firstFoldedEntry = foldedEntries[0]!;
	const lastFoldedEntry = foldedEntries[foldedEntries.length - 1]!;

	const digestInput = {
		schema: SESSION_CONTEXT_FOLD_SCHEMA,
		session_id: sessionId,
		folded_entry_refs: foldedEntryRefs,
		protected_tail_entry_ids: protectedTailEntryIds,
	};
	const digest = stableHash(digestInput);
	const foldId =
		options.id ??
		`urn:refarm:session-context-fold:v1:${stableHash(sessionId).value}:${digest.value}`;

	return {
		fold: {
			"@type": "SessionContextFold",
			"@id": foldId,
			schema: SESSION_CONTEXT_FOLD_SCHEMA,
			session_id: sessionId,
			range: {
				from_entry_id: firstFoldedEntry["@id"],
				to_entry_id: lastFoldedEntry["@id"],
				entry_count: foldedEntries.length,
			},
			digest,
			folded_entry_refs: foldedEntryRefs,
			protected_tail_entry_ids: protectedTailEntryIds,
			summary: options.summary ?? null,
			created_at_ns: (options.nowNs ?? defaultNowNs)(),
		},
		folded_entries: foldedEntries,
		protected_tail_entries: protectedTailEntries,
	};
}

export function unfoldSessionContextFold(
	fold: SessionContextFold,
	entries: Iterable<SessionEntry>,
): SessionContextUnfoldResult {
	const entriesById = new Map<string, SessionEntry>();
	for (const entry of entries) {
		entriesById.set(entry["@id"], entry);
	}

	const unfolded: SessionEntry[] = [];
	const missingEntryIds: string[] = [];
	const digestMismatches: SessionContextUnfoldResult["digest_mismatches"] = [];

	for (const ref of fold.folded_entry_refs) {
		const entry = entriesById.get(ref.entry_id);
		if (!entry) {
			missingEntryIds.push(ref.entry_id);
			continue;
		}

		const actual = digestSessionEntryContent(entry);
		if (
			actual.algorithm !== ref.content_digest.algorithm ||
			actual.value !== ref.content_digest.value
		) {
			digestMismatches.push({
				entry_id: ref.entry_id,
				expected: ref.content_digest,
				actual,
			});
		}
		unfolded.push(entry);
	}

	return {
		entries: unfolded,
		missing_entry_ids: missingEntryIds,
		digest_mismatches: digestMismatches,
	};
}
