import { describe, expect, it } from "vitest";

import {
	VIEWBOX_SIZE,
	computeForces,
	layoutGraph,
	nodeSizeFromDegree,
	relaxLayout,
	seedLayout,
	type GraphInput,
	type LayoutNode,
} from "./layout.js";

function dist(a: LayoutNode, b: LayoutNode): number {
	return Math.hypot(a.x - b.x, a.y - b.y);
}

describe("nodeSizeFromDegree", () => {
	it("grows with degree and caps", () => {
		expect(nodeSizeFromDegree(0)).toBe(5);
		expect(nodeSizeFromDegree(4)).toBeCloseTo(9.6);
		expect(nodeSizeFromDegree(100)).toBe(14); // capped at 5 + 9
	});
});

describe("seedLayout", () => {
	it("orders nodes by degree descending (hubs first) and derives size", () => {
		const seeded = seedLayout({
			nodes: [
				{ id: "a", degree: 1 },
				{ id: "hub", degree: 10 },
				{ id: "b", degree: 2 },
			],
			links: [],
		});
		expect(seeded.map((n) => n.id)).toEqual(["hub", "b", "a"]);
		expect(seeded[0]!.size).toBe(nodeSizeFromDegree(10));
	});

	it("is deterministic — same graph seeds identical positions (no Math.random)", () => {
		const graph: GraphInput = { nodes: [{ id: "x", degree: 0 }, { id: "y", degree: 0 }], links: [] };
		expect(seedLayout(graph)).toEqual(seedLayout(graph));
	});

	it("places nodes inside the viewport", () => {
		const seeded = seedLayout({ nodes: [{ id: "a" }, { id: "b" }, { id: "c" }], links: [] });
		for (const n of seeded) {
			expect(n.x).toBeGreaterThan(0);
			expect(n.x).toBeLessThan(VIEWBOX_SIZE);
			expect(n.y).toBeGreaterThan(0);
			expect(n.y).toBeLessThan(VIEWBOX_SIZE);
		}
	});
});

describe("computeForces", () => {
	it("pushes two co-located-ish nodes apart (repulsion is equal and opposite)", () => {
		const nodes: LayoutNode[] = [
			{ id: "a", degree: 0, size: 5, x: 100, y: 100, vx: 0, vy: 0 },
			{ id: "b", degree: 0, size: 5, x: 104, y: 100, vx: 0, vy: 0 },
		];
		const [fa, fb] = computeForces(nodes, []);
		// a is left of b → a pushed further left (negative x), b pushed right (positive x).
		expect(fa!.x).toBeLessThan(0);
		expect(fb!.x).toBeGreaterThan(0);
		// Equal and opposite.
		expect(fa!.x).toBeCloseTo(-fb!.x);
	});

	it("a stretched spring pulls its endpoints together", () => {
		const nodes: LayoutNode[] = [
			{ id: "a", degree: 0, size: 5, x: 20, y: 100, vx: 0, vy: 0 },
			{ id: "b", degree: 0, size: 5, x: 180, y: 100, vx: 0, vy: 0 },
		];
		// With only the spring (no meaningful repulsion at this distance dominating), a is pulled
		// right (toward b) and b pulled left.
		const [fa, fb] = computeForces(nodes, [{ source: "a", target: "b" }]);
		expect(fa!.x).toBeGreaterThan(0);
		expect(fb!.x).toBeLessThan(0);
	});

	it("ignores a dangling edge (endpoint not in the node set)", () => {
		const nodes: LayoutNode[] = [{ id: "a", degree: 0, size: 5, x: 100, y: 100, vx: 0, vy: 0 }];
		expect(() => computeForces(nodes, [{ source: "a", target: "ghost" }])).not.toThrow();
	});

	it("does not mutate the input nodes", () => {
		const nodes: LayoutNode[] = [
			{ id: "a", degree: 0, size: 5, x: 100, y: 100, vx: 0, vy: 0 },
			{ id: "b", degree: 0, size: 5, x: 110, y: 100, vx: 0, vy: 0 },
		];
		const snapshot = JSON.stringify(nodes);
		computeForces(nodes, []);
		expect(JSON.stringify(nodes)).toBe(snapshot);
	});
});

describe("relaxLayout / layoutGraph", () => {
	it("keeps disconnected nodes apart (repulsion prevents collapse onto each other)", () => {
		// Two nodes with NO edge: they must not pile onto the same point — repulsion holds them
		// apart even as centering pulls both toward the middle.
		const graph: GraphInput = { nodes: [{ id: "a" }, { id: "b" }], links: [] };
		const placed = layoutGraph(graph);
		expect(dist(placed[0]!, placed[1]!)).toBeGreaterThan(placed[0]!.size + placed[1]!.size);
	});

	it("pushes two nodes seeded close together apart (repulsion dominates at short range)", () => {
		// Seed two nodes almost on top of each other, then relax with centering OFF so we isolate
		// repulsion: they must end further apart than they started.
		const nodes: LayoutNode[] = [
			{ id: "a", degree: 0, size: 5, x: 100, y: 100, vx: 0, vy: 0 },
			{ id: "b", degree: 0, size: 5, x: 101, y: 100, vx: 0, vy: 0 },
		];
		const before = dist(nodes[0]!, nodes[1]!);
		relaxLayout(nodes, [], { centerForce: 0, steps: 40 });
		expect(dist(nodes[0]!, nodes[1]!)).toBeGreaterThan(before);
	});

	it("keeps every node inside the viewport after relaxation", () => {
		const graph: GraphInput = {
			nodes: Array.from({ length: 12 }, (_, i) => ({ id: `n${i}`, degree: i % 4 })),
			links: [{ source: "n0", target: "n1" }, { source: "n0", target: "n2" }, { source: "n1", target: "n3" }],
		};
		const placed = layoutGraph(graph);
		for (const n of placed) {
			expect(n.x).toBeGreaterThanOrEqual(n.size + 2 - 0.001);
			expect(n.x).toBeLessThanOrEqual(VIEWBOX_SIZE - n.size - 2 + 0.001);
			expect(n.y).toBeGreaterThanOrEqual(n.size + 2 - 0.001);
			expect(n.y).toBeLessThanOrEqual(VIEWBOX_SIZE - n.size - 2 + 0.001);
		}
	});

	it("is deterministic — same graph produces the same final layout", () => {
		const graph: GraphInput = {
			nodes: [{ id: "a", degree: 2 }, { id: "b", degree: 1 }, { id: "c", degree: 1 }],
			links: [{ source: "a", target: "b" }, { source: "a", target: "c" }],
		};
		expect(layoutGraph(graph)).toEqual(layoutGraph(graph));
	});

	it("connected nodes end up closer than the viewport diagonal (the spring binds them)", () => {
		const graph: GraphInput = {
			nodes: [{ id: "a", degree: 1 }, { id: "b", degree: 1 }],
			links: [{ source: "a", target: "b" }],
		};
		const placed = layoutGraph(graph);
		// A bound pair should settle near the spring rest length, well under the box diagonal.
		expect(dist(placed[0]!, placed[1]!)).toBeLessThan(VIEWBOX_SIZE);
	});

	it("no-ops a single-node graph (nothing to relax)", () => {
		const placed = layoutGraph({ nodes: [{ id: "solo" }], links: [] });
		expect(placed).toHaveLength(1);
	});
});
