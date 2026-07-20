import { describe, expect, it } from "vitest";

import { agentEventRows, watchAgentEvents } from "./agent-watch.js";

describe("agent-watch (live agent event replay)", () => {
	it("maps agent:* events to numbered table rows", () => {
		expect(agentEventRows([{ event: "prompt:start", ts: 1 }, { event: "tool:call" }])).toEqual([
			{ "#": 1, event: "prompt:start", ts: "1" },
			{ "#": 2, event: "tool:call", ts: "" },
		]);
	});

	it("replays events into a live GROWING table (headless, from fixture events)", async () => {
		const frames: string[] = [];
		await watchAgentEvents({
			events: [
				{ event: "prompt:start", ts: 1 },
				{ event: "route:selected", ts: 2 },
				{ event: "tool:call", ts: 3 },
			],
			width: 50,
			output: (frame) => frames.push(frame),
		});
		// One frame per event (plus the initial empty), each holding the events so far, in order.
		expect(frames.length).toBeGreaterThanOrEqual(3);
		const last = frames.at(-1)!;
		expect(last).toContain("prompt:start");
		expect(last).toContain("route:selected");
		expect(last).toContain("tool:call");
		expect(last.indexOf("prompt:start")).toBeLessThan(last.indexOf("tool:call"));
		// The view grows: the frame after the first event has 1 data row, the last has 3.
		expect(frames.at(1)).toContain("prompt:start");
		expect(frames.at(1)).not.toContain("tool:call");
	});
});
