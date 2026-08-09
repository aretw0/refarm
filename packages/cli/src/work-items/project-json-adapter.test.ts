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
