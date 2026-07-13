import { describe, expect, it } from "vitest";

import { layoutGraph } from "./layout.js";
import { getConnections, traverseGraph, type NodeSource, type SovereignNode } from "./traverse.js";

/** An in-memory store standing in for a real NodeView: nodes keyed by @id, queryable by @type. */
function memorySource(nodes: SovereignNode[]): NodeSource {
	return {
		async queryNodes(type: string) {
			return nodes.filter((n) => n["@type"] === type);
		},
		async getNode(id: string) {
			return nodes.find((n) => n["@id"] === id) ?? null;
		},
	};
}

// A small requirement graph in the store: each node's `related` field lists connected ids.
const store = memorySource([
	{ "@id": "req:a", "@type": "Requirement", title: "Alpha", related: ["req:b", "req:c"] },
	{ "@id": "req:b", "@type": "Requirement", title: "Beta", related: ["req:a"] },
	{ "@id": "req:c", "@type": "Requirement", title: "Gamma", related: [] },
	{ "@id": "person:x", "@type": "Person", title: "X" }, // a different type, not queried
]);

const resolveConnections = (node: SovereignNode): string[] =>
	Array.isArray(node.related) ? (node.related as string[]) : [];

describe("traverseGraph — read the Sovereign Graph from a store", () => {
	it("queries nodes by @type and resolves edges from a connection field", async () => {
		const graph = await traverseGraph(store, { types: "Requirement", resolveConnections });
		expect(graph.nodes.map((n) => n.id).sort()).toEqual(["req:a", "req:b", "req:c"]);
		expect(graph.links).toContainEqual({ source: "req:a", target: "req:b" });
		expect(graph.links).toContainEqual({ source: "req:a", target: "req:c" });
		expect(graph.links).toContainEqual({ source: "req:b", target: "req:a" });
		// The Person node was a different @type → not in the graph.
		expect(graph.byId.has("person:x")).toBe(false);
	});

	it("computes stats (get-stats): node/edge/type counts", async () => {
		const graph = await traverseGraph(store, { types: "Requirement", resolveConnections });
		expect(graph.stats).toEqual({ nodeCount: 3, edgeCount: 3, typeCount: 1 });
	});

	it("computes degree for sizing (the hub has the most connections)", async () => {
		const graph = await traverseGraph(store, { types: "Requirement", resolveConnections });
		const byId = new Map(graph.nodes.map((n) => [n.id, n.degree]));
		expect(byId.get("req:a")).toBe(3); // out 2 + in 1
		expect(byId.get("req:c")).toBe(1); // in 1
	});

	it("drops a dangling connection (target not in the queried set) by default", async () => {
		const s = memorySource([
			{ "@id": "req:a", "@type": "Requirement", related: ["req:ghost"] },
		]);
		const graph = await traverseGraph(s, { types: "Requirement", resolveConnections });
		expect(graph.links).toEqual([]);
	});

	it("unions across several @types", async () => {
		const graph = await traverseGraph(store, { types: ["Requirement", "Person"], resolveConnections });
		expect(graph.byId.has("person:x")).toBe(true);
		expect(graph.stats.typeCount).toBe(2);
	});

	it("feeds layoutGraph end to end (store → traverse → placed nodes)", async () => {
		const graph = await traverseGraph(store, { types: "Requirement", resolveConnections });
		const placed = layoutGraph(graph);
		expect(placed).toHaveLength(3);
		const sizes = new Map(placed.map((n) => [n.id, n.size]));
		expect(sizes.get("req:a")).toBeGreaterThan(sizes.get("req:c")!);
	});
});

describe("getConnections — one node's neighbors (get-connections)", () => {
	it("returns outgoing and incoming ids for a node", async () => {
		const conns = await getConnections(store, "req:a", { types: "Requirement", resolveConnections });
		expect(conns.outgoing.sort()).toEqual(["req:b", "req:c"]);
		expect(conns.incoming).toEqual(["req:b"]);
	});
});
