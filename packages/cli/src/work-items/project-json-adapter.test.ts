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
