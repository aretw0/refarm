import { describe, expect, it } from "vitest";
import { describeAdapterContract } from "./adapter-contract.js";
import type { WorkItem } from "./contract.js";
import { createProjectJsonAdapter } from "./project-json-adapter.js";

const REFARM_SHAPE = {
	issues: [
		{
			id: "ISS-001",
			title: "first",
			body: "b",
			location: "docs/A.md:1",
			status: "open",
			category: "cleanup",
			priority: "medium",
			package: "apps/refarm",
			axis: "node-vs-directory",
			source: "agent",
		},
		{
			id: "ISS-002",
			title: "second",
			body: "b",
			location: "docs/B.md:2",
			status: "resolved",
			category: "issue",
			priority: "low",
			package: "packages/cli",
			resolved_by: "deadbee",
		},
	],
};

/** rcdc5's SHAPE, not rcdc5's CONTENT. Two id namespaces and the extra `description` field. */
const RCDC5_SHAPE = {
	issues: [
		{
			id: "issue-001",
			title: "first",
			description: "a field refarm's schema forbids",
			body: "b",
			location: "src/x.ts:10",
			status: "open",
			category: "cleanup",
			priority: "high",
			package: "some-package",
		},
		{
			id: "fragility-fragility-abc123",
			title: "second",
			description: "again",
			body: "b",
			location: "src/y.ts:20",
			status: "open",
			category: "issue",
			priority: "medium",
			package: "some-package",
		},
		{
			id: "issue-002",
			title: "third",
			body: "b",
			location: "src/z.ts:30",
			status: "resolved",
			category: "issue",
			priority: "low",
			package: "some-package",
			resolved_by: "cafe123",
		},
	],
};

function newItem(id: string): WorkItem {
	return {
		id,
		title: "added",
		body: "body",
		location: "docs/NEW.md:1",
		status: "open",
		priority: "medium",
		category: "cleanup",
		package: "packages/cli",
		axis: "cost",
	};
}

function inMemoryAdapter(seed: object) {
	let contents = JSON.stringify(seed);
	return createProjectJsonAdapter({
		readDocument: () => contents,
		writeDocument: (next) => {
			contents = next;
		},
	});
}

describeAdapterContract("project-json / refarm shape", () => inMemoryAdapter(REFARM_SHAPE), {
	existingId: "ISS-001",
	count: 2,
	newItem: newItem("ISS-900"),
	expectedExtraFields: [],
});

describeAdapterContract("project-json / rcdc5 shape", () => inMemoryAdapter(RCDC5_SHAPE), {
	existingId: "issue-001",
	count: 3,
	newItem: newItem("issue-900"),
	expectedExtraFields: ["description"],
});

// project-json specifics, not part of the shared adapter contract: the snake_case write mapping
// and the document_unreadable failure mode are behaviours of THIS backend, not promises every
// adapter must keep.
describe("project-json adapter specifics", () => {
	it("round-trips resolvedBy through the resolved_by write mapping", () => {
		const adapter = inMemoryAdapter(REFARM_SHAPE);
		const added = adapter.add({ ...newItem("ISS-901"), resolvedBy: "cafe123" });
		expect(added.ok).toBe(true);

		const read = adapter.list();
		expect(read.items.find((item) => item.id === "ISS-901")?.resolvedBy).toBe("cafe123");
	});

	it("list() reports document_unreadable for malformed JSON instead of throwing", () => {
		const adapter = createProjectJsonAdapter({
			readDocument: () => "{ not json",
			writeDocument: () => {},
		});
		const result = adapter.list();
		expect(result.ok).toBe(false);
		expect(result.items).toEqual([]);
		expect(result.extraFields).toEqual([]);
		expect(result.error?.reason).toBe("document_unreadable");
	});

	it("add() reports document_unreadable for malformed JSON instead of throwing", () => {
		const adapter = createProjectJsonAdapter({
			readDocument: () => "{ not json",
			writeDocument: () => {},
		});
		const result = adapter.add(newItem("ISS-902"));
		expect(result.ok).toBe(false);
		expect(result.error?.reason).toBe("document_unreadable");
	});

	it("setStatus() reports document_unreadable for malformed JSON instead of throwing", () => {
		const adapter = createProjectJsonAdapter({
			readDocument: () => "{ not json",
			writeDocument: () => {},
		});
		const result = adapter.setStatus("ISS-001", "deferred");
		expect(result.ok).toBe(false);
		expect(result.error?.reason).toBe("document_unreadable");
	});

	// FINDING 8 — the fourth of the four writer catches (list/add/setStatus/setAxis) that reads a
	// malformed document. The other three were covered; this one was not.
	it("setAxis() reports document_unreadable for malformed JSON instead of throwing", () => {
		const adapter = createProjectJsonAdapter({
			readDocument: () => "{ not json",
			writeDocument: () => {},
		});
		const result = adapter.setAxis("ISS-001", "cost");
		expect(result.ok).toBe(false);
		expect(result.error?.reason).toBe("document_unreadable");
	});
});

// ISS-085. The ledger had writers for creation, lifecycle and classification, and none for the
// item's own PROSE. Correcting a title, body or location meant editing .project/issues.json by hand
// — a governed document — which is the writer-gap that killed tasks.json and issues.json the first
// time. It bit five times in the 2026-08-10 session alone: two bodies corrupted by a shell string,
// two corrected by hand, and one hypothesis (ISS-099's) proven wrong with no way to fix the body
// that carried it.
describe("editText", () => {
	function adapterOver(records: unknown[]) {
		let contents = JSON.stringify({ issues: records });
		return {
			adapter: createProjectJsonAdapter({
				readDocument: () => contents,
				writeDocument: (next) => { contents = next; },
			}),
			read: () => JSON.parse(contents).issues,
		};
	}

	const base = {
		id: "ISS-1", title: "old title", body: "old body", location: "old.ts:1", status: "open",
		category: "issue", priority: "high", package: "p", axis: "cost", description: "rcdc5's extra",
	};

	it("edits one field and leaves every other key, and their order, alone", () => {
		const { adapter, read } = adapterOver([base]);
		const result = adapter.editText("ISS-1", { body: "a corrected body" });
		expect(result.ok).toBe(true);
		expect(read()[0].body).toBe("a corrected body");
		expect(read()[0].title).toBe("old title");
		expect(Object.keys(read()[0])).toEqual(Object.keys(base));
		expect(read()[0].description).toBe("rcdc5's extra");
	});

	it("edits several fields in one write", () => {
		const { adapter, read } = adapterOver([base]);
		adapter.editText("ISS-1", { title: "new", location: "new.ts:9" });
		expect(read()[0]).toMatchObject({ title: "new", location: "new.ts:9", body: "old body" });
	});

	it("refuses an edit that names no field rather than writing the record back unchanged", () => {
		const { adapter } = adapterOver([base]);
		const result = adapter.editText("ISS-1", {});
		expect(result.ok).toBe(false);
		expect(result.error?.reason).toBe("no_fields");
	});

	it("refuses an unknown id rather than creating a record", () => {
		const { adapter, read } = adapterOver([]);
		const result = adapter.editText("ISS-404", { title: "x" });
		expect(result.ok).toBe(false);
		expect(result.error?.reason).toBe("unknown_id");
		expect(read()).toEqual([]);
	});

	it("refuses an empty value — clearing a required field is not an edit", () => {
		const { adapter, read } = adapterOver([base]);
		const result = adapter.editText("ISS-1", { title: "   " });
		expect(result.ok).toBe(false);
		expect(result.error?.reason).toBe("empty_value");
		expect(read()[0].title).toBe("old title");
	});
});

describe("a value this ledger has no name for is reported, never absorbed", () => {
	/** The defect these pin, found 2026-08-11 by hitting it: two FINISHED items were written with
	 *  status "closed" — a word this ledger does not use. The reader substituted "open", `validate`
	 *  passed, and both reappeared in the operator's open queue as if nobody had touched them. */
	function ledgerWith(record: Record<string, unknown>) {
		return createProjectJsonAdapter({
			readDocument: () => JSON.stringify({ issues: [record] }),
			writeDocument: () => {},
		});
	}

	it("reports an unrecognised status AND what it was read as instead", () => {
		const result = ledgerWith({ id: "ISS-900", title: "t", status: "closed" }).list();
		expect(result.ok).toBe(true);
		expect(result.coercedValues).toEqual([
			{ id: "ISS-900", field: "status", raw: "closed", readAs: "open" },
		]);
		// The read still succeeds — availability fails open, so one bad row cannot break `list`.
		expect(result.items[0]?.status).toBe("open");
	});

	it("reports an unrecognised axis, which coerces in the HONEST direction", () => {
		// An unknown axis becomes absent — the reader saying it does not know. An unknown status
		// became a claim about the work. Both are reported; only one of them was ever a lie.
		const result = ledgerWith({ id: "ISS-901", title: "t", status: "open", axis: "vibes" }).list();
		expect(result.coercedValues).toEqual([
			{ id: "ISS-901", field: "axis", raw: "vibes", readAs: "(absent)" },
		]);
		expect(result.items[0]?.axis).toBeUndefined();
	});

	it("says nothing when every value is one the contract knows", () => {
		const result = ledgerWith({
			id: "ISS-902",
			title: "t",
			status: "resolved",
			axis: "cost",
		}).list();
		expect(result.coercedValues).toEqual([]);
	});

	it("does not report an ABSENT status — absent is not the same as unrecognised", () => {
		// A record with no status at all is a different fact from one carrying a word nobody
		// recognises. Reporting the first would make the finding noise and teach an operator to
		// ignore it, which is how a gate stops working without ever going red.
		const result = ledgerWith({ id: "ISS-903", title: "t" }).list();
		expect(result.coercedValues).toEqual([]);
		expect(result.items[0]?.status).toBe("open");
	});

	it("reports every offending row, not just the first", () => {
		const adapter = createProjectJsonAdapter({
			readDocument: () =>
				JSON.stringify({
					issues: [
						{ id: "ISS-904", title: "t", status: "closed" },
						{ id: "ISS-905", title: "t", status: "wontfix" },
					],
				}),
			writeDocument: () => {},
		});
		expect(adapter.list().coercedValues.map((c) => c.raw)).toEqual(["closed", "wontfix"]);
	});
});
