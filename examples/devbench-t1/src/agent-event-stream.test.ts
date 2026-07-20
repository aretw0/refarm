import { describe, expect, it } from "vitest";

import type { IncomingMessage, ServerResponse } from "node:http";

import { agentEventStreamSource, createAgentEventStreamHandler } from "./agent-event-stream.js";
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


/** A mock GET /agent/events connection capturing the SSE writes. */
function mockConn(): { req: IncomingMessage; res: ServerResponse; writes: string[] } {
	const writes: string[] = [];
	const req = {
		url: "/agent/events",
		method: "GET",
		on() {
			return this;
		},
	} as unknown as IncomingMessage;
	const res = {
		writeHead() {
			return this;
		},
		write(chunk: string) {
			writes.push(chunk);
			return true;
		},
		end() {},
		on() {
			return this;
		},
	} as unknown as ServerResponse;
	return { req, res, writes };
}

describe("createAgentEventStreamHandler (broadcast to many browsers over ONE poll)", () => {
	it("shares a single file poll across connections and fans each new event to all", () => {
		const events: AgentEventLine[] = [];
		let tick: () => void = () => {};
		let schedules = 0;
		const handler = createAgentEventStreamHandler(".dgk", {
			snapshot: () => events.slice(),
			schedule: (fn) => {
				schedules += 1;
				tick = fn;
				return () => {};
			},
		});
		const c1 = mockConn();
		const c2 = mockConn();
		expect(handler(c1.req, c1.res)).toBe(true);
		expect(handler(c2.req, c2.res)).toBe(true);
		expect(schedules).toBe(1); // ONE shared poll for both connections, not one per browser
		events.push({ event: "agent:tool:call", ts: 1 });
		tick();
		expect(c1.writes.join("")).toContain('"agent:tool:call"');
		expect(c2.writes.join("")).toContain('"agent:tool:call"');
	});
});
