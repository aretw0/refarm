import { describe, expect, it } from "vitest";

import { arrayLiveSource, runLiveTerminal, runLiveView } from "./tui-live.js";
import { renderTable } from "./tui-table.js";

describe("runLiveView (stream-driven redraw)", () => {
	it("renders initially, then once per item, accumulating; ends when the source ends", async () => {
		const frames: string[] = [];
		const items = await runLiveView({
			source: arrayLiveSource(["a", "b", "c"]),
			render: (xs) => xs.join(","),
			output: (frame) => frames.push(frame),
		});
		expect(frames).toEqual(["", "a", "a,b", "a,b,c"]); // initial "" + after a, ab, abc
		expect(items).toEqual(["a", "b", "c"]);
	});

	it("keeps only the last maxItems (a rolling window)", async () => {
		const frames: string[] = [];
		await runLiveView({
			source: arrayLiveSource([1, 2, 3, 4]),
			render: (xs) => xs.join(","),
			output: (frame) => frames.push(frame),
			maxItems: 2,
		});
		expect(frames).toEqual(["", "1", "1,2", "2,3", "3,4"]);
	});

	it("streams agent-like events into a live table (the watch-the-machine use)", async () => {
		type Event = { event: string; ts: string };
		const events: Event[] = [
			{ event: "prompt:start", ts: "1" },
			{ event: "route:selected", ts: "2" },
			{ event: "tool:call", ts: "3" },
		];
		let last = "";
		await runLiveView<Event>({
			source: arrayLiveSource(events),
			// The live view IS a growing table — renderTable (async) is a valid render.
			render: (es) =>
				renderTable([{ key: "ts", header: "T" }, { key: "event", header: "Event" }], es, { width: 40 }),
			output: (frame) => {
				last = frame;
			},
		});
		// After the last event, the table holds all three rows in order.
		expect(last).toContain("prompt:start");
		expect(last).toContain("route:selected");
		expect(last).toContain("tool:call");
		expect(last.indexOf("prompt:start")).toBeLessThan(last.indexOf("tool:call"));
	});

	it("runLiveTerminal frames the live view in the alt-screen and restores on exit", async () => {
		const ESC = String.fromCharCode(27);
		const bytes: string[] = [];
		await runLiveTerminal({
			source: arrayLiveSource(["x", "y"]),
			render: (xs) => xs.join(""),
			write: (b) => bytes.push(b),
		});
		const all = bytes.join("");
		expect(all).toContain(`${ESC}[?1049h`); // entered the alt-screen
		expect(all).toContain(`${ESC}[?25l`); // hid the cursor
		expect(all).toContain("xy"); // the final accumulated frame
		expect(all).toContain(`${ESC}[?25h`); // restored the cursor
		expect(all).toContain(`${ESC}[?1049l`); // left the alt-screen
	});
});
