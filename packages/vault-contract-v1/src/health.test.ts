import type { KnowledgeRecord } from "@refarm.dev/records-contract-v1";
import { describe, expect, it } from "vitest";

import { analyzeCorpusHealth } from "./health.js";

function rec(
	id: string,
	fields: Record<string, unknown>,
	relations?: KnowledgeRecord["relations"],
): KnowledgeRecord {
	return {
		id,
		schemaVersion: 1,
		"@type": ["KnowledgeRecord"],
		fields,
		...(relations ? { relations } : {}),
		contentHash: "x",
	} as KnowledgeRecord;
}

describe("analyzeCorpusHealth — cross-record vault health", () => {
	it("a fully-linked, unique corpus is healthy", () => {
		const records = [
			rec("record:a", { externalKey: "A", title: "Alpha" }, [
				{ type: "references", target: "record:b" },
			]),
			rec("record:b", { externalKey: "B", title: "Beta" }, [
				{ type: "elaborates", target: "record:a" },
			]),
		];
		const report = analyzeCorpusHealth(records);
		expect(report.healthy).toBe(true);
		expect(report.findings).toHaveLength(0);
	});

	it("flags a dangling relation (in-corpus target that does not exist)", () => {
		const records = [
			rec("record:a", { externalKey: "A" }, [{ type: "satisfies", target: "record:ghost" }]),
			rec("record:b", { externalKey: "B" }, [{ type: "references", target: "record:a" }]),
		];
		const report = analyzeCorpusHealth(records);
		const dangling = report.findings.filter((f) => f.kind === "dangling-relation");
		expect(dangling).toHaveLength(1);
		expect(dangling[0]?.recordId).toBe("record:a");
		expect(dangling[0]?.detail).toBe("record:ghost");
	});

	it("does NOT flag an external relation as dangling (out-of-corpus is expected)", () => {
		const records = [
			rec("record:a", { externalKey: "A" }, [
				{ type: "references", target: "https://alm/OUTSIDE", attrs: { external: true } },
			]),
			rec("record:b", { externalKey: "B" }, [{ type: "references", target: "record:a" }]),
		];
		const report = analyzeCorpusHealth(records);
		expect(report.counts["dangling-relation"]).toBe(0);
		// record:a is connected in-corpus via record:b's link, so it is not an orphan either.
		expect(report.counts.orphan).toBe(0);
	});

	it("flags an orphan (no in-corpus links either way)", () => {
		const records = [
			rec("record:a", { externalKey: "A" }, [{ type: "references", target: "record:b" }]),
			rec("record:b", { externalKey: "B" }),
			rec("record:lonely", { externalKey: "L" }), // linked by no one, links to no one
		];
		const report = analyzeCorpusHealth(records);
		const orphans = report.findings.filter((f) => f.kind === "orphan");
		expect(orphans).toHaveLength(1);
		expect(orphans[0]?.recordId).toBe("record:lonely");
	});

	it("an external-only relation does not save a record from orphanhood", () => {
		const records = [
			rec("record:a", { externalKey: "A" }, [{ type: "references", target: "record:b" }]),
			rec("record:b", { externalKey: "B" }, [{ type: "references", target: "record:a" }]),
			rec("record:x", { externalKey: "X" }, [
				{ type: "references", target: "https://alm/OUT", attrs: { external: true } },
			]),
		];
		const report = analyzeCorpusHealth(records);
		expect(report.findings.filter((f) => f.kind === "orphan").map((f) => f.recordId)).toEqual([
			"record:x",
		]);
	});

	it("flags duplicates by externalKey (every member of the group)", () => {
		const records = [
			rec("record:a1", { externalKey: "RN-1", title: "Regra" }, [
				{ type: "references", target: "record:b" },
			]),
			rec("record:a2", { externalKey: "RN-1", title: "Regra (repull)" }, [
				{ type: "references", target: "record:b" },
			]),
			rec("record:b", { externalKey: "B" }, [{ type: "references", target: "record:a1" }]),
		];
		const report = analyzeCorpusHealth(records);
		const dups = report.findings.filter((f) => f.kind === "duplicate");
		expect(dups.map((f) => f.recordId).sort()).toEqual(["record:a1", "record:a2"]);
		expect(dups[0]?.detail).toBe("RN-1");
	});

	it("a single-record corpus is not an orphan", () => {
		const report = analyzeCorpusHealth([rec("record:solo", { externalKey: "S" })]);
		expect(report.counts.orphan).toBe(0);
		expect(report.healthy).toBe(true);
	});
});
