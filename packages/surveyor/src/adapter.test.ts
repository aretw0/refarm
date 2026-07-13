import { describe, expect, it } from "vitest";

import { extractWikilinks, graphFromRecords, type GraphRecord } from "./adapter.js";
import { layoutGraph } from "./layout.js";

describe("extractWikilinks", () => {
	it("captures plain, aliased, and heading forms", () => {
		expect(extractWikilinks("see [[Alpha]] and [[Beta|the beta]] and [[Gamma#section]]")).toEqual([
			"Alpha",
			"Beta",
			"Gamma",
		]);
	});
	it("dedupes and trims", () => {
		expect(extractWikilinks("[[ X ]] [[X]]")).toEqual(["X"]);
	});
	it("returns nothing for text with no wikilinks", () => {
		expect(extractWikilinks("plain text")).toEqual([]);
	});
});

describe("graphFromRecords", () => {
	const records: GraphRecord[] = [
		{ id: "record:a", title: "Alpha", text: "links to [[Beta]] and [[Gamma]]" },
		{ id: "record:b", title: "Beta", text: "back to [[Alpha]]" },
		{ id: "record:c", title: "Gamma", text: "isolated-ish" },
	];

	it("resolves wikilinks by title to node ids and builds links", () => {
		const graph = graphFromRecords(records);
		expect(graph.nodes.map((n) => n.id).sort()).toEqual(["record:a", "record:b", "record:c"]);
		// a→b, a→c, b→a (a↔b is two directed edges; dedup only collapses identical direction).
		expect(graph.links).toContainEqual({ source: "record:a", target: "record:b" });
		expect(graph.links).toContainEqual({ source: "record:a", target: "record:c" });
		expect(graph.links).toContainEqual({ source: "record:b", target: "record:a" });
	});

	it("computes degree (in + out) for sizing — the hub has the highest", () => {
		const graph = graphFromRecords(records);
		const byId = new Map(graph.nodes.map((n) => [n.id, n.degree]));
		// a: out 2 (b,c) + in 1 (b) = 3; b: out 1 + in 1 = 2; c: in 1 = 1.
		expect(byId.get("record:a")).toBe(3);
		expect(byId.get("record:b")).toBe(2);
		expect(byId.get("record:c")).toBe(1);
	});

	it("drops a dangling wikilink (target not a known node)", () => {
		const graph = graphFromRecords([{ id: "record:a", title: "Alpha", text: "[[Nonexistent]]" }]);
		expect(graph.links).toEqual([]);
	});

	it("resolves wikilinks by alias (an external key)", () => {
		const graph = graphFromRecords([
			{ id: "record:req-rn1", title: "Regra Um", aliases: ["RN-1"], text: "" },
			{ id: "record:req-cdu2", title: "Caso Dois", text: "realiza [[RN-1]]" },
		]);
		expect(graph.links).toContainEqual({ source: "record:req-cdu2", target: "record:req-rn1" });
	});

	it("merges injected structural edges (e.g. OSLC relations)", () => {
		const graph = graphFromRecords(
			[
				{ id: "record:a", title: "Alpha", text: "" },
				{ id: "record:b", title: "Beta", text: "" },
			],
			{ extraLinks: [{ source: "Alpha", target: "Beta" }] },
		);
		expect(graph.links).toContainEqual({ source: "record:a", target: "record:b" });
	});

	it("can drop isolated nodes when asked", () => {
		const graph = graphFromRecords(
			[
				{ id: "record:a", title: "Alpha", text: "[[Beta]]" },
				{ id: "record:b", title: "Beta", text: "" },
				{ id: "record:lonely", title: "Lonely", text: "" },
			],
			{ includeIsolated: false },
		);
		expect(graph.nodes.map((n) => n.id).sort()).toEqual(["record:a", "record:b"]);
	});

	it("produces a graph the layout kernel lays out end to end", () => {
		const graph = graphFromRecords(records);
		const placed = layoutGraph(graph);
		expect(placed).toHaveLength(3);
		// The hub (record:a, degree 3) is the largest node.
		const sizes = new Map(placed.map((n) => [n.id, n.size]));
		expect(sizes.get("record:a")).toBeGreaterThan(sizes.get("record:c")!);
	});
});
