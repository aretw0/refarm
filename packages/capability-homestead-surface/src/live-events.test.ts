/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest";

import { arrayEventSource, mountLiveEventTable, type LiveEventSource } from "./live-events.js";

interface Ev {
	event: string;
	ts: number;
}
const COLUMNS = [
	{ key: "#", header: "#" },
	{ key: "event", header: "Event" },
	{ key: "ts", header: "When" },
];
const toRow = (e: Ev, i: number): Record<string, unknown> => ({ "#": i + 1, event: e.event, ts: e.ts });

/** A hand-driven source so the growth can be asserted deterministically, event by event. */
function manualSource<T>(): { source: LiveEventSource<T>; emit: (event: T) => void; end: () => void } {
	let onEvent: (event: T) => void = () => {};
	let onEnd: () => void = () => {};
	const source: LiveEventSource<T> = {
		subscribe(handleEvent, handleEnd) {
			onEvent = handleEvent;
			onEnd = handleEnd ?? (() => {});
			return () => {};
		},
	};
	return { source, emit: (event) => onEvent(event), end: () => onEnd() };
}

function rowCount(container: HTMLElement): number {
	return container.querySelectorAll("tbody tr").length;
}

describe("mountLiveEventTable (browser twin of the TUI live view)", () => {
	it("renders an initially empty table, then GROWS one row per event", () => {
		document.body.innerHTML = `<div id="live"></div>`;
		const container = document.getElementById("live")!;
		const { source, emit } = manualSource<Ev>();
		mountLiveEventTable({ container, source, columns: COLUMNS, toRow, caption: "Agent activity" });

		expect(container.querySelector("table")).not.toBeNull();
		expect(rowCount(container)).toBe(0);
		expect(container.querySelector("caption")?.textContent).toBe("Agent activity");

		emit({ event: "agent:prompt:start", ts: 1 });
		expect(rowCount(container)).toBe(1);
		expect(container.textContent).toContain("agent:prompt:start");

		emit({ event: "agent:tool:call", ts: 2 });
		expect(rowCount(container)).toBe(2);
		// order preserved: the first event still precedes the second
		const text = container.textContent ?? "";
		expect(text.indexOf("agent:prompt:start")).toBeLessThan(text.indexOf("agent:tool:call"));
	});

	it("honours maxRows as a rolling window (drops the oldest)", () => {
		document.body.innerHTML = `<div id="live2"></div>`;
		const container = document.getElementById("live2")!;
		const { source, emit } = manualSource<Ev>();
		mountLiveEventTable({ container, source, columns: COLUMNS, toRow, maxRows: 2 });

		emit({ event: "a", ts: 1 });
		emit({ event: "b", ts: 2 });
		emit({ event: "c", ts: 3 });
		expect(rowCount(container)).toBe(2);
		const text = container.textContent ?? "";
		expect(text).not.toContain(">a<"); // the oldest fell out of the window
		expect(text).toContain("b");
		expect(text).toContain("c");
	});

	it("replays an arrayEventSource to completion (the demo/replay path)", async () => {
		document.body.innerHTML = `<div id="live3"></div>`;
		const container = document.getElementById("live3")!;
		const events: Ev[] = [
			{ event: "agent:prompt:start", ts: 1 },
			{ event: "agent:route:selected", ts: 2 },
			{ event: "agent:response:done", ts: 3 },
		];
		await new Promise<void>((resolve) => {
			const source: LiveEventSource<Ev> = {
				subscribe(onEvent, onEnd) {
					return arrayEventSource(events).subscribe(onEvent, () => {
						onEnd?.();
						resolve();
					});
				},
			};
			mountLiveEventTable({ container, source, columns: COLUMNS, toRow });
		});
		expect(rowCount(container)).toBe(3);
		expect(container.textContent).toContain("agent:response:done");
	});
});
