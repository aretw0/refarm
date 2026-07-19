import { describe, expect, it } from "vitest";

import { focusOrder, moveFocus, type FocusTarget } from "./tui-focus.js";
import type { PositionedNode } from "./tui-layout.js";

// A 2×2 grid of focusable cards inside a container:  a b / c d
const card = (id: string, x: number, y: number): PositionedNode => ({
	id,
	focusable: true,
	x,
	y,
	width: 10,
	height: 3,
	children: [],
});
const grid: PositionedNode = {
	x: 0,
	y: 0,
	width: 40,
	height: 10,
	children: [
		// Deliberately out of reading order to prove focusOrder sorts by (y, x).
		card("d", 12, 4),
		card("b", 12, 0),
		card("c", 0, 4),
		card("a", 0, 0),
		{ x: 0, y: 0, width: 5, height: 1, text: "heading", children: [] }, // not focusable → excluded
	],
};
const order: FocusTarget[] = focusOrder(grid);

describe("focusOrder", () => {
	it("collects focusable+id boxes in reading order (top-to-bottom, then left-to-right)", () => {
		expect(order.map((target) => target.id)).toEqual(["a", "b", "c", "d"]);
	});

	it("excludes non-focusable nodes (the heading leaf)", () => {
		expect(order.some((target) => target.id === "heading")).toBe(false);
	});
});

describe("moveFocus", () => {
	it("arrows move spatially — right/left within the row, clamping at the edges", () => {
		expect(moveFocus(order, "a", { name: "right" })).toBe("b"); // next box in the row
		expect(moveFocus(order, "b", { name: "right" })).toBe("b"); // row end → clamp
		expect(moveFocus(order, "b", { name: "left" })).toBe("a");
		expect(moveFocus(order, "a", { name: "left" })).toBe("a"); // row start → clamp
	});

	it("tab cycles in reading order and wraps", () => {
		expect(moveFocus(order, "a", { name: "tab" })).toBe("b");
		expect(moveFocus(order, "b", { name: "tab" })).toBe("c"); // into the next row
		expect(moveFocus(order, "d", { name: "tab" })).toBe("a"); // wraps past the end
	});

	it("down / up move to the geometrically nearest box in that direction", () => {
		expect(moveFocus(order, "a", { name: "down" })).toBe("c"); // same column, next row
		expect(moveFocus(order, "b", { name: "down" })).toBe("d");
		expect(moveFocus(order, "c", { name: "up" })).toBe("a");
		expect(moveFocus(order, "a", { name: "up" })).toBe("a"); // nothing above → unchanged
	});

	it("leaves focus unchanged for a non-navigating key", () => {
		expect(moveFocus(order, "a", { name: "return" })).toBe("a");
	});

	it("focuses the first target when nothing is focused yet, and returns null with no targets", () => {
		expect(moveFocus(order, null, { name: "down" })).toBe("a");
		expect(moveFocus([], "a", { name: "right" })).toBeNull();
	});
});
