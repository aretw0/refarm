// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

import { graphFromRecords } from "./adapter.js";
import { mountGraph } from "./interactive.js";

// jsdom has no SVG layout engine: getScreenCTM/createSVGPoint are absent. Stub an identity CTM so
// the pointer-coordinate math (which we DO want to exercise) resolves. Screen == graph coords.
function stubSvgGeometry(svg: SVGSVGElement): void {
	const identity = {
		inverse: () => identity,
	} as unknown as DOMMatrix;
	// @ts-expect-error jsdom stub
	svg.getScreenCTM = () => identity;
	// @ts-expect-error jsdom stub
	svg.createSVGPoint = () => ({
		x: 0,
		y: 0,
		matrixTransform() {
			return { x: this.x, y: this.y };
		},
	});
	// @ts-expect-error jsdom stub
	svg.setPointerCapture = () => {};
	// @ts-expect-error jsdom stub
	svg.releasePointerCapture = () => {};
}

const graph = graphFromRecords([
	{ id: "a", title: "Alpha", text: "[[Beta]] [[Gamma]]" },
	{ id: "b", title: "Beta", text: "[[Alpha]]" },
	{ id: "c", title: "Gamma", text: "" },
]);

let mount: HTMLElement;
beforeEach(() => {
	document.body.innerHTML = "";
	mount = document.createElement("div");
	document.body.appendChild(mount);
});

describe("mountGraph — structure", () => {
	it("builds an SVG with a node group per node and a line per resolved edge", () => {
		const handle = mountGraph(mount, graph);
		expect(handle.svg.tagName.toLowerCase()).toBe("svg");
		expect(mount.querySelectorAll("[data-node-id]")).toHaveLength(3);
		// a→b, a→c, b→a → 3 edges.
		expect(mount.querySelectorAll("line.surveyor-graph__edge")).toHaveLength(3);
		handle.destroy();
	});

	it("labels nodes via labelFor", () => {
		const handle = mountGraph(mount, graph, { labelFor: (id) => id.toUpperCase() });
		const labels = [...mount.querySelectorAll("text.surveyor-graph__label")].map((t) => t.textContent);
		expect(labels).toContain("A");
		handle.destroy();
	});

	it("omits labels when showLabels is false", () => {
		const handle = mountGraph(mount, graph, { showLabels: false });
		expect(mount.querySelectorAll("text.surveyor-graph__label")).toHaveLength(0);
		handle.destroy();
	});

	it("positions nodes inside the viewBox (the layout ran)", () => {
		const handle = mountGraph(mount, graph);
		for (const circle of mount.querySelectorAll("circle.surveyor-graph__node")) {
			const cx = Number(circle.getAttribute("cx"));
			expect(cx).toBeGreaterThan(0);
			expect(cx).toBeLessThan(200);
		}
		handle.destroy();
	});
});

describe("mountGraph — hover highlight", () => {
	it("marks the hovered node, its neighbors, and dims the rest", () => {
		const handle = mountGraph(mount, graph);
		const groupA = mount.querySelector('[data-node-id="a"]')!;
		groupA.dispatchEvent(new Event("pointerenter"));
		expect(handle.svg.getAttribute("data-hover")).toBe("1");
		expect(groupA.classList.contains("is-hovered")).toBe(true);
		// Beta and Gamma are a's neighbors.
		expect(mount.querySelector('[data-node-id="b"]')!.classList.contains("is-neighbor")).toBe(true);
		expect(mount.querySelector('[data-node-id="c"]')!.classList.contains("is-neighbor")).toBe(true);
		groupA.dispatchEvent(new Event("pointerleave"));
		expect(handle.svg.getAttribute("data-hover")).toBeNull();
		handle.destroy();
	});
});

describe("mountGraph — click vs drag", () => {
	it("fires onNodeClick for a press-release with no movement (a click)", () => {
		const onNodeClick = vi.fn();
		const handle = mountGraph(mount, graph, { onNodeClick });
		stubSvgGeometry(handle.svg);
		const circleA = mount.querySelector('[data-node-id="a"] circle')!;
		// pointerdown ON the node (bubbles to the svg with target=circle), pointerup same spot → click.
		circleA.dispatchEvent(new PointerEvent("pointerdown", { pointerId: 1, clientX: 10, clientY: 10, bubbles: true }));
		handle.svg.dispatchEvent(new PointerEvent("pointerup", { pointerId: 1, clientX: 10, clientY: 10 }));
		expect(onNodeClick).toHaveBeenCalledWith("a");
		handle.destroy();
	});

	it("does NOT fire onNodeClick when the pointer moved past the drag threshold", () => {
		const onNodeClick = vi.fn();
		const handle = mountGraph(mount, graph, { onNodeClick });
		stubSvgGeometry(handle.svg);
		const circleA = mount.querySelector('[data-node-id="a"] circle')!;
		circleA.dispatchEvent(new PointerEvent("pointerdown", { pointerId: 1, clientX: 10, clientY: 10, bubbles: true }));
		handle.svg.dispatchEvent(new PointerEvent("pointermove", { pointerId: 1, clientX: 40, clientY: 40 }));
		handle.svg.dispatchEvent(new PointerEvent("pointerup", { pointerId: 1, clientX: 40, clientY: 40 }));
		expect(onNodeClick).not.toHaveBeenCalled();
		handle.destroy();
	});
});

describe("mountGraph — lifecycle", () => {
	it("relayout replaces the nodes for a new graph", () => {
		const handle = mountGraph(mount, graph);
		expect(mount.querySelectorAll("[data-node-id]")).toHaveLength(3);
		handle.relayout(graphFromRecords([{ id: "solo", title: "Solo", text: "" }]));
		expect(mount.querySelectorAll("[data-node-id]")).toHaveLength(1);
		handle.destroy();
	});

	it("destroy removes the SVG from the mount", () => {
		const handle = mountGraph(mount, graph);
		expect(mount.querySelector("svg")).not.toBeNull();
		handle.destroy();
		expect(mount.querySelector("svg")).toBeNull();
	});
});
