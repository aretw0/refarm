import { describe, expect, it } from "vitest";

import { graphFromRecords } from "./adapter.js";
import { layoutGraph, type LayoutNode } from "./layout.js";
import { graphToSvg, renderGraphSvg } from "./svg.js";

const nodes: LayoutNode[] = [
	{ id: "a", degree: 2, size: 8, x: 60, y: 60, vx: 0, vy: 0 },
	{ id: "b", degree: 1, size: 6, x: 140, y: 100, vx: 0, vy: 0 },
];
const links = [{ source: "a", target: "b" }];

describe("renderGraphSvg", () => {
	it("emits a self-contained SVG with the viewBox, an edge, and both nodes", () => {
		const svg = renderGraphSvg(nodes, links);
		expect(svg).toContain('viewBox="0 0 200 200"');
		expect(svg).toContain("<line"); // the edge
		expect((svg.match(/<circle/g) ?? []).length).toBe(2);
		expect(svg).toContain("<style>"); // self-contained styling
		expect(svg).toContain("prefers-color-scheme: dark"); // theme-aware
	});

	it("labels nodes via labelFor and truncates long labels", () => {
		const svg = renderGraphSvg(nodes, links, {
			labelFor: (id) => (id === "a" ? "A very long requirement title indeed" : id),
			maxLabelChars: 10,
		});
		expect(svg).toContain("A very lo…");
		expect(svg).toContain(">b<"); // short label untouched
	});

	it("omits label elements when showLabels is false", () => {
		// The style block always defines the class; assert no <text ...__label> ELEMENT is emitted.
		expect(renderGraphSvg(nodes, links, { showLabels: false })).not.toContain('<text class="surveyor-graph__label"');
	});

	it("wraps nodes in <a> when hrefFor returns a target", () => {
		const svg = renderGraphSvg(nodes, links, { hrefFor: (id) => `/req/${id}` });
		expect(svg).toContain('<a href="/req/a">');
	});

	it("escapes XML in labels and titles", () => {
		const svg = renderGraphSvg([nodes[0]!], [], { labelFor: () => "A & B <x>" });
		expect(svg).toContain("A &amp; B &lt;x&gt;");
		expect(svg).not.toContain("<x>");
	});

	it("drops a dangling edge (endpoint missing from the node set)", () => {
		const svg = renderGraphSvg([nodes[0]!], [{ source: "a", target: "ghost" }]);
		expect(svg).not.toContain("<line");
	});
});

describe("graphToSvg — headless pipeline end to end", () => {
	it("lays out and renders a records graph to an SVG string", () => {
		const graph = graphFromRecords([
			{ id: "record:a", title: "Alpha", text: "[[Beta]]" },
			{ id: "record:b", title: "Beta", text: "[[Alpha]]" },
		]);
		const svg = graphToSvg(graph, { labelFor: (id) => (id === "record:a" ? "Alpha" : "Beta") });
		expect(svg).toContain("<svg");
		expect((svg.match(/<circle/g) ?? []).length).toBe(2);
		expect(svg).toContain(">Alpha<");
	});

	it("is deterministic — same graph renders the identical SVG", () => {
		const graph = graphFromRecords([
			{ id: "a", title: "A", text: "[[B]]" },
			{ id: "b", title: "B", text: "" },
		]);
		expect(graphToSvg(graph)).toBe(graphToSvg(graph));
	});

	it("produces coordinates inside the viewBox (a valid diagram)", () => {
		const placed = layoutGraph(graphFromRecords([{ id: "a", title: "A" }, { id: "b", title: "B" }]));
		for (const n of placed) {
			expect(n.x).toBeGreaterThan(0);
			expect(n.x).toBeLessThan(200);
		}
	});
});
