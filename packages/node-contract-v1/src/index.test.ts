import { describe, expect, it } from "vitest";
import { NODE_CAPABILITY, type GraphNode } from "./index.js";

describe("node contracts", () => {
	it("declares the base graph node capability", () => {
		expect(NODE_CAPABILITY).toBe("node:v1");
	});

	it("accepts the minimal linked-data node shape", () => {
		const node = {
			"@type": "task",
			"@id": "node-1",
			created_at_ns: 1_700_000_000_000_000_000,
		} satisfies GraphNode;

		expect(node).toEqual({
			"@type": "task",
			"@id": "node-1",
			created_at_ns: 1_700_000_000_000_000_000,
		});
	});
});
