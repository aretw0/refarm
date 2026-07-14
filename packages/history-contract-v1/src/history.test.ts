import { computeRecordContentHash, type KnowledgeRecord } from "@refarm.dev/records-contract-v1";
import { describe, expect, it } from "vitest";

import { diffRecords } from "./diff.js";
import { appendRevision, latestRevision, revisionAt, timeline } from "./revision.js";
import { manifestRevisions, mergeAndRecord } from "./manifest.js";

let clock = 0;
const now = () => `2026-07-14T00:00:0${clock++}.000Z`;

function rec(id: string, fields: Record<string, unknown>, extra: Partial<KnowledgeRecord> = {}): KnowledgeRecord {
	const record = {
		id,
		schemaVersion: 1,
		"@type": ["KnowledgeRecord"],
		fields,
		...extra,
		contentHash: "",
	} as KnowledgeRecord;
	record.contentHash = computeRecordContentHash(record);
	return record;
}

describe("diffRecords — structural field-level diff", () => {
	it("reports added / removed / changed fields, sections, relations", () => {
		const before = rec("r", { title: "Old", tipo: "requisito", stale: "x" }, {
			sections: [{ key: "body", content: "one" }],
			relations: [{ type: "references", target: "r2" }],
		});
		const after = rec("r", { title: "New", tipo: "requisito", added: "y" }, {
			sections: [{ key: "body", content: "two" }],
			relations: [{ type: "references", target: "r2" }, { type: "elaborates", target: "r3" }],
		});
		const diff = diffRecords(before, after);
		expect(diff.recordId).toBe("r");
		expect(diff.from).toBe(before.contentHash);
		expect(diff.to).toBe(after.contentHash);
		const byPath = Object.fromEntries(diff.changes.map((c) => [c.path, c]));
		expect(byPath["fields.title"]).toMatchObject({ kind: "changed", before: "Old", after: "New" });
		expect(byPath["fields.stale"]).toMatchObject({ kind: "removed", before: "x" });
		expect(byPath["fields.added"]).toMatchObject({ kind: "added", after: "y" });
		expect(byPath["sections.body"]).toMatchObject({ kind: "changed", before: "one", after: "two" });
		expect(byPath["relations.elaborates→r3"]).toMatchObject({ kind: "added" });
		// tipo unchanged → not in the diff.
		expect(byPath["fields.tipo"]).toBeUndefined();
	});

	it("treats an absent before as creation (all added), and ignores contentHash", () => {
		const created = rec("r", { title: "First" });
		const diff = diffRecords(undefined, created);
		expect(diff.from).toBeUndefined();
		expect(diff.changes.some((c) => c.path === "fields.title" && c.kind === "added")).toBe(true);
		// contentHash is derived — never a change.
		expect(diff.changes.some((c) => c.path.includes("contentHash"))).toBe(false);
	});

	it("no changes for identical records", () => {
		const a = rec("r", { title: "Same" });
		const b = rec("r", { title: "Same" });
		expect(diffRecords(a, b).changes).toEqual([]);
	});

	it("detects a schema migration — @type / schemaVersion change (top-level, outside fields)", () => {
		const before = rec("r", { title: "T" }, { "@type": ["KnowledgeRecord"], schemaVersion: 1 });
		const after = rec("r", { title: "T" }, { "@type": ["KnowledgeRecord", "Requirement"], schemaVersion: 2 });
		const diff = diffRecords(before, after);
		const byPath = Object.fromEntries(diff.changes.map((c) => [c.path, c]));
		expect(byPath["@type"]).toMatchObject({ kind: "changed" });
		expect(byPath["schemaVersion"]).toMatchObject({ kind: "changed", before: 1, after: 2 });
	});
});

describe("appendRevision — append-only chain with dedup", () => {
	it("chains revisions with seq + parentHash, and dedups an unchanged re-save", () => {
		let history = appendRevision([], rec("r", { title: "v1" }), now, "pull");
		const v1Hash = history[0]!.contentHash;
		history = appendRevision(history, rec("r", { title: "v2" }), now, "correct");
		// A re-save of the SAME content as v2 → no new revision (dedup by hash).
		const v2 = rec("r", { title: "v2" });
		history = appendRevision(history, v2, now, "pull");

		expect(history).toHaveLength(2);
		expect(history[0]).toMatchObject({ seq: 1, origin: "pull", recordId: "r" });
		expect(history[0]!.parentHash).toBeUndefined(); // root
		expect(history[1]).toMatchObject({ seq: 2, origin: "correct", parentHash: v1Hash });
		expect(history[1]!.revisionId).toBe(`r@${history[1]!.contentHash}`);
	});

	it("maxRevisions bounds the store — keeps the root + the newest, prunes the middle", () => {
		let history: ReturnType<typeof appendRevision> = [];
		for (let n = 1; n <= 5; n++) {
			history = appendRevision(history, rec("r", { n }), now, { origin: "pull", maxRevisions: 3 });
		}
		const t = timeline(history, "r");
		// 5 distinct versions, capped to 3: the root (seq 1) + the two newest (seq 4, 5).
		expect(t).toHaveLength(3);
		expect(t.map((x) => x.seq)).toEqual([1, 4, 5]);
		expect(t[0]!.snapshot.fields.n).toBe(1); // root preserved
		expect(t[2]!.snapshot.fields.n).toBe(5); // newest preserved
	});

	it("timeline / latestRevision / revisionAt read the chain", () => {
		let history = appendRevision([], rec("r", { n: 1 }), now);
		history = appendRevision(history, rec("r", { n: 2 }), now);
		history = appendRevision(history, rec("other", { n: 1 }), now);
		const t = timeline(history, "r");
		expect(t.map((x) => x.seq)).toEqual([1, 2]);
		expect(latestRevision(history, "r")?.seq).toBe(2);
		expect(revisionAt(history, "r", t[0]!.contentHash)?.seq).toBe(1);
		// Cross-record isolation: "other" has its own chain.
		expect(timeline(history, "other")).toHaveLength(1);
	});
});

describe("mergeAndRecord — the drop-in for mergeRecords + history", () => {
	it("merges by id (replace) AND appends a revision for each changed record", () => {
		const manifest = { manifestVersion: 1 as const, records: [rec("r", { title: "v1" })] };
		const step1 = mergeAndRecord(manifest, [rec("r", { title: "v2" }), rec("new", { title: "n1" })], now, "pull");
		// Records: r replaced, new added.
		expect(step1.records.find((x) => x.id === "r")?.fields.title).toBe("v2");
		expect(step1.records.some((x) => x.id === "new")).toBe(true);
		// History: r@v2 (seq 1 — the base manifest had no history for r, so v2 is its first revision)
		// and new@n1. A re-merge with identical content adds NO revision.
		expect(manifestRevisions(step1)).toHaveLength(2);
		const step2 = mergeAndRecord(step1, [rec("r", { title: "v2" })], now, "pull");
		expect(manifestRevisions(step2)).toHaveLength(2); // unchanged → no new revision
		const step3 = mergeAndRecord(step2, [rec("r", { title: "v3" })], now, "correct");
		expect(manifestRevisions(step3)).toHaveLength(3);
		// r's timeline: v2 (pull) then v3 (correct); each revision carries its origin + snapshot.
		const rTimeline = timeline(manifestRevisions(step3), "r");
		expect(rTimeline.map((x) => x.origin)).toEqual(["pull", "correct"]);
		expect(rTimeline[1]!.snapshot.fields.title).toBe("v3");
	});

	it("a manifest with no revisions round-trips (extra field, non-breaking)", () => {
		const manifest = { manifestVersion: 1 as const, records: [] };
		expect(manifestRevisions(manifest)).toEqual([]);
	});
});
