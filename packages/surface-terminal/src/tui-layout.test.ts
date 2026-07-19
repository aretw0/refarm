import { describe, expect, it } from "vitest";

import { computeTuiLayout, defaultMeasureText, type LayoutNode } from "./tui-layout.js";

describe("computeTuiLayout (Yoga flex → positioned terminal cells)", () => {
	it("lays a row of two fixed-width boxes side by side", async () => {
		const root: LayoutNode = {
			direction: "row",
			children: [
				{ width: 10, height: 3 },
				{ width: 8, height: 3 },
			],
		};
		const out = await computeTuiLayout(root, { width: 40 });
		expect(out.children[0]!.x).toBe(0);
		expect(out.children[0]!.width).toBe(10);
		expect(out.children[1]!.x).toBe(10); // second box starts after the first
		expect(out.children[1]!.width).toBe(8);
	});

	it("stacks a column and offsets the next child by height + gap", async () => {
		const root: LayoutNode = {
			direction: "column",
			gap: 1,
			children: [
				{ width: 5, height: 2 },
				{ width: 5, height: 4 },
			],
		};
		const out = await computeTuiLayout(root, { width: 20 });
		expect(out.children[0]!.y).toBe(0);
		expect(out.children[1]!.y).toBe(3); // 2 (first height) + 1 (gap)
	});

	it("offsets children by the parent's padding, in absolute coordinates", async () => {
		const root: LayoutNode = { padding: 2, children: [{ width: 5, height: 1 }] };
		const out = await computeTuiLayout(root, { width: 20 });
		expect(out.children[0]!.x).toBe(2);
		expect(out.children[0]!.y).toBe(2);
	});

	it("grows a flex child to fill the row's free space", async () => {
		const root: LayoutNode = {
			direction: "row",
			width: 30,
			children: [
				{ width: 10, height: 1 },
				{ flex: 1, height: 1 },
			],
		};
		const out = await computeTuiLayout(root, { width: 30 });
		expect(out.children[1]!.x).toBe(10);
		expect(out.children[1]!.width).toBe(20); // fills the remaining 30 - 10
	});

	it("measures a text leaf in cells (width = widest line, height = line count)", async () => {
		const root: LayoutNode = {
			align: "start", // don't stretch leaves to the container width — size them to content
			children: [{ text: "hello" }, { text: "a\nbb\nccc" }],
		};
		const out = await computeTuiLayout(root, { width: 40 });
		expect(out.children[0]!.width).toBe(5);
		expect(out.children[0]!.height).toBe(1);
		expect(out.children[1]!.width).toBe(3); // widest line is "ccc"
		expect(out.children[1]!.height).toBe(3);
	});

	it("defaultMeasureText strips ANSI before counting cells", () => {
		expect(defaultMeasureText(`${String.fromCharCode(27)}[31mred${String.fromCharCode(27)}[0m`)).toEqual({
			width: 3,
			height: 1,
		});
	});
});
