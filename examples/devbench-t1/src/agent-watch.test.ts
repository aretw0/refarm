import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { agentEventRows, followAgentEvents, watchAgentEvents } from "./agent-watch.js";
import type { AgentEventLine } from "./live-telemetry.js";

describe("agent-watch (live agent event views)", () => {
	it("maps agent:* events to numbered table rows", () => {
		expect(agentEventRows([{ event: "prompt:start", ts: 1 }, { event: "tool:call" }])).toEqual([
			{ "#": 1, event: "prompt:start", ts: "1" },
			{ "#": 2, event: "tool:call", ts: "" },
		]);
	});

	it("REPLAY: renders events into a live GROWING table (headless, from fixture events)", async () => {
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

	it("FOLLOW: tails a GROWING event source live — new events appear as rows as they arrive", async () => {
		const events: AgentEventLine[] = [{ event: "agent:prompt:start", ts: 1 }];
		// Each wait() simulates a new line being appended to the file between polls.
		const pending: AgentEventLine[] = [
			{ event: "agent:route:selected", ts: 2 },
			{ event: "agent:tool:call", ts: 3 },
		];
		const frames: string[] = [];
		await followAgentEvents({
			snapshot: () => events.slice(),
			wait: () => {
				const next = pending.shift();
				if (next) events.push(next);
				return Promise.resolve();
			},
			done: () => pending.length === 0,
			width: 44,
			output: (frame) => frames.push(frame),
		});
		const last = frames.at(-1)!;
		expect(last).toContain("agent:prompt:start");
		expect(last).toContain("agent:route:selected");
		expect(last).toContain("agent:tool:call");
		// It grew live: an early frame held only the first event.
		expect(frames.at(1)).toContain("agent:prompt:start");
		expect(frames.at(1)).not.toContain("agent:tool:call");
	});

	it("FOLLOW: reads a REAL ndjson file (fs path), filtering to agent:* and painting rows", async () => {
		const dir = mkdtempSync(join(tmpdir(), "t1-agent-watch-"));
		const file = join(dir, "scarecrow-audit.ndjson");
		writeFileSync(
			file,
			[
				JSON.stringify({ event: "agent:prompt:start", ts: 1 }),
				JSON.stringify({ event: "host-effect:fs:read", ts: 2 }), // must be filtered OUT (not agent:*)
				JSON.stringify({ event: "agent:tool:call", ts: 3 }),
				"", // trailing blank line the reader must tolerate
			].join("\n"),
			"utf-8",
		);
		const frames: string[] = [];
		await followAgentEvents({
			refarmDir: dir, // exercise the real readAgentEvents(refarmDir) default snapshot
			wait: () => Promise.resolve(),
			done: () => true, // no live appends here — stop once the initial snapshot is drained
			width: 44,
			output: (frame) => frames.push(frame),
		});
		const last = frames.at(-1)!;
		expect(last).toContain("agent:prompt:start");
		expect(last).toContain("agent:tool:call");
		expect(last).not.toContain("host-effect"); // the non-agent line was filtered out
	});
});
