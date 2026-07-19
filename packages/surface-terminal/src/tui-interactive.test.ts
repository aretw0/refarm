import { describe, expect, it } from "vitest";

import { focusOrder } from "./tui-focus.js";
import { scriptedInput } from "./tui-input.js";
import { runInteractiveLayout } from "./tui-interactive.js";
import type { PositionedNode } from "./tui-layout.js";

const card = (id: string, x: number, y: number): PositionedNode => ({
	id,
	focusable: true,
	x,
	y,
	width: 10,
	height: 3,
	children: [],
});
// a b / c d
const grid: PositionedNode = {
	x: 0,
	y: 0,
	width: 40,
	height: 10,
	children: [card("a", 0, 0), card("b", 12, 0), card("c", 0, 4), card("d", 12, 4)],
};
const targets = focusOrder(grid);

describe("runInteractiveLayout", () => {
	it("renders the initial focus, repaints on each focus move, and exits on escape", async () => {
		const frames: string[] = [];
		const last = await runInteractiveLayout({
			targets,
			render: (id) => `focus:${id}`,
			input: scriptedInput([{ name: "right" }, { name: "down" }, { name: "escape" }]),
			output: (frame) => frames.push(frame),
		});
		expect(frames).toEqual(["focus:a", "focus:b", "focus:d"]); // a → right:b → down-from-b:d
		expect(last).toBe("d");
	});

	it("fires onSelect with the focused id on Enter", async () => {
		const selected: string[] = [];
		await runInteractiveLayout({
			targets,
			render: (id) => `${id}`,
			input: scriptedInput([{ name: "right" }, { name: "return" }, { name: "escape" }]),
			output: () => {},
			onSelect: (id) => {
				selected.push(id);
			},
		});
		expect(selected).toEqual(["b"]);
	});

	it("exits the loop when onSelect returns false (later keys are not processed)", async () => {
		const seen: string[] = [];
		await runInteractiveLayout({
			targets,
			render: () => "",
			input: scriptedInput([{ name: "return" }, { name: "right" }]),
			output: () => {},
			onSelect: (id) => {
				seen.push(id);
				return false;
			},
		});
		expect(seen).toEqual(["a"]); // only the first Enter; the loop exited before "right"
	});

	it("exits when the input is exhausted, with no explicit escape", async () => {
		const last = await runInteractiveLayout({
			targets,
			render: (id) => `${id}`,
			input: scriptedInput([{ name: "right" }]),
			output: () => {},
		});
		expect(last).toBe("b");
	});

	it("does not repaint when a key does not change focus", async () => {
		const frames: string[] = [];
		await runInteractiveLayout({
			targets,
			render: (id) => `${id}`,
			input: scriptedInput([{ name: "up" }, { name: "escape" }]), // up from "a" stays "a"
			output: (frame) => frames.push(frame),
		});
		expect(frames).toEqual(["a"]); // only the initial render
	});
});
