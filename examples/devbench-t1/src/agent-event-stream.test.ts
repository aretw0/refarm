import { describe, expect, it } from "vitest";

import { agentEventStreamSource } from "./agent-event-stream.js";
import type { AgentEventLine } from "./live-telemetry.js";

describe("agentEventStreamSource (SSE server tail)", () => {
	it("flushes existing events immediately, then sends newly-appended ones on each tick", () => {
		const events: AgentEventLine[] = [{ event: "agent:prompt:start", ts: 1 }];
		let tick: () => void = () => {};
		const source = agentEventStreamSource({
			snapshot: () => events.slice(),
			schedule: (fn) => {
				tick = fn;
				return () => {};
			},
		});

		const sent: AgentEventLine[] = [];
		const unsubscribe = source.subscribe(
			(e) => sent.push(e as AgentEventLine),
			() => {},
		);

		// subscribe flushed the one already-recorded event
		expect(sent).toEqual([{ event: "agent:prompt:start", ts: 1 }]);

		// a new event is appended (the agent ran another step) → the next tick sends only it
		events.push({ event: "agent:tool:call", ts: 2 });
		tick();
		expect(sent).toEqual([
			{ event: "agent:prompt:start", ts: 1 },
			{ event: "agent:tool:call", ts: 2 },
		]);

		// no new events → a tick sends nothing (by-count dedup)
		tick();
		expect(sent.length).toBe(2);

		unsubscribe();
	});

	it("stops polling when unsubscribed", () => {
		let cancelled = false;
		const source = agentEventStreamSource({
			snapshot: () => [],
			schedule: () => () => {
				cancelled = true;
			},
		});
		const unsubscribe = source.subscribe(
			() => {},
			() => {},
		);
		unsubscribe();
		expect(cancelled).toBe(true);
	});
});
