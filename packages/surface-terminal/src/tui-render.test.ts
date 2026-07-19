import { describe, expect, it } from "vitest";

import { computeTuiLayout, type PositionedNode } from "./tui-layout.js";
import { renderTuiLayout } from "./tui-render.js";

const ESC = String.fromCharCode(27);
const red = (s: string) => `${ESC}[31m${s}${ESC}[0m`;

const leaf = (x: number, y: number, w: number, h: number, text: string): PositionedNode => ({
	x,
	y,
	width: w,
	height: h,
	text,
	children: [],
});
const box = (x: number, y: number, w: number, h: number, children: PositionedNode[]): PositionedNode => ({
	x,
	y,
	width: w,
	height: h,
	children,
});

describe("renderTuiLayout (positioned boxes → ANSI grid)", () => {
	it("places a single text leaf on its row", () => {
		expect(renderTuiLayout(box(0, 0, 10, 1, [leaf(0, 0, 5, 1, "hello")]))).toBe("hello");
	});

	it("places a row of two leaves side by side, padding the gap by visible width", () => {
		const root = box(0, 0, 20, 1, [leaf(0, 0, 5, 1, "aaa"), leaf(8, 0, 5, 1, "bbb")]);
		expect(renderTuiLayout(root)).toBe("aaa     bbb"); // "aaa" + 5 spaces (col 8 - visible 3) + "bbb"
	});

	it("stacks a column onto successive rows", () => {
		const root = box(0, 0, 10, 2, [leaf(0, 0, 5, 1, "top"), leaf(0, 1, 5, 1, "bot")]);
		expect(renderTuiLayout(root)).toBe("top\nbot");
	});

	it("truncates a line wider than its box", () => {
		expect(renderTuiLayout(box(0, 0, 10, 1, [leaf(0, 0, 4, 1, "toolong")]))).toBe("tool");
	});

	it("keeps ANSI color intact while padding gaps by VISIBLE width", () => {
		const root = box(0, 0, 20, 1, [leaf(0, 0, 3, 1, red("abc")), leaf(6, 0, 3, 1, "xyz")]);
		// colored "abc" (visible 3) at col 0, "xyz" at col 6 → 3 spaces between; color survives.
		expect(renderTuiLayout(root)).toBe(`${red("abc")}   xyz`);
	});

	it("clips a multi-line leaf to its box height", () => {
		const root = box(0, 0, 10, 2, [leaf(0, 0, 5, 2, "a\nb\nc")]); // 3 lines, box height 2 → drop "c"
		expect(renderTuiLayout(root)).toBe("a\nb");
	});

	it("renders a computed layout end to end (compute → render)", async () => {
		const layout = await computeTuiLayout(
			{ direction: "row", gap: 2, align: "start", children: [{ text: "L" }, { text: "R" }] },
			{ width: 20 },
		);
		expect(renderTuiLayout(layout)).toBe("L  R"); // gap 2 between the two labels
	});
});
