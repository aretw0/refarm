import { EventEmitter } from "node:events";

import { describe, expect, it } from "vitest";

import { focusOrder } from "./tui-focus.js";
import { scriptedInput } from "./tui-input.js";
import { createStdinInput, runInteractiveLayout, withInteractiveTerminal } from "./tui-interactive.js";
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

	it("withInteractiveTerminal enters the alt-screen + hides the cursor, then ALWAYS restores (even on throw)", async () => {
		const ESC = String.fromCharCode(27);
		const bytes: string[] = [];
		const write = (b: string) => bytes.push(b);
		const result = await withInteractiveTerminal(
			(_input, output) => {
				output("frame");
				return Promise.resolve(42);
			},
			write,
			scriptedInput([]),
		);
		expect(result).toBe(42);
		let all = bytes.join("");
		expect(all).toContain(`${ESC}[?1049h`); // entered the alt-screen
		expect(all).toContain(`${ESC}[?25l`); // hid the cursor
		expect(all).toContain("frame"); // the painted frame
		expect(all).toContain(`${ESC}[?25h`); // showed the cursor (restored)
		expect(all).toContain(`${ESC}[?1049l`); // left the alt-screen (restored)
		expect(all.indexOf(`${ESC}[?1049h`)).toBeLessThan(all.indexOf(`${ESC}[?1049l`));

		// Restore even when the run throws.
		bytes.length = 0;
		await expect(
			withInteractiveTerminal(() => Promise.reject(new Error("boom")), write, scriptedInput([])),
		).rejects.toThrow("boom");
		all = bytes.join("");
		expect(all).toContain(`${ESC}[?25h`); // cursor restored despite the throw
		expect(all).toContain(`${ESC}[?1049l`); // alt-screen left despite the throw
	});

	it("createStdinInput normalizes + queues keys and closes cleanly (over an injected stdin)", async () => {
		const stdin = Object.assign(new EventEmitter(), {
			isTTY: false,
			resume() {},
			pause() {},
			setRawMode() {},
		}) as unknown as NodeJS.ReadStream;
		const input = createStdinInput(stdin);

		// Keys that arrive BEFORE readKey are queued, then dequeued in order (normalized).
		stdin.emit("keypress", "a", { name: "a", sequence: "a", ctrl: false });
		stdin.emit("keypress", undefined, { name: "up" });
		expect(await input.readKey()).toEqual({ name: "a", ctrl: false, shift: false, meta: false, sequence: "a" });
		expect(await input.readKey()).toEqual({ name: "up", ctrl: false, shift: false, meta: false });

		// readKey BEFORE the key: the waiter resolves when the key arrives (no lost key).
		const pending = input.readKey();
		stdin.emit("keypress", "b", { name: "b", sequence: "b" });
		expect(await pending).toMatchObject({ name: "b", sequence: "b" });

		// close() resolves a pending readKey with null (no hang), and stays null after.
		const afterClose = input.readKey();
		input.close();
		expect(await afterClose).toBeNull();
		expect(await input.readKey()).toBeNull();
	});
});
