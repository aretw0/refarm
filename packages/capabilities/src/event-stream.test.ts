import type { IncomingMessage, ServerResponse } from "node:http";
import { describe, expect, it } from "vitest";

import { createEventStreamHandler, type EventStreamSource } from "./event-stream.js";

/** A mock req that can fire "close", + a mock res capturing head/writes/end + firing "close". */
function mocks(method: string, path: string): {
	req: IncomingMessage;
	res: ServerResponse;
	captured: { status?: number; headers?: Record<string, string>; writes: string[]; ended: boolean };
	closeClient: () => void;
} {
	const reqHandlers: Record<string, () => void> = {};
	const resHandlers: Record<string, () => void> = {};
	const captured = { status: undefined as number | undefined, headers: undefined as Record<string, string> | undefined, writes: [] as string[], ended: false };
	const req = {
		url: path,
		method,
		on(event: string, cb: () => void) {
			reqHandlers[event] = cb;
			return this;
		},
	} as unknown as IncomingMessage;
	const res = {
		writeHead(status: number, headers: Record<string, string>) {
			captured.status = status;
			captured.headers = headers;
			return this;
		},
		write(chunk: string) {
			captured.writes.push(chunk);
			return true;
		},
		end() {
			captured.ended = true;
		},
		on(event: string, cb: () => void) {
			resHandlers[event] = cb;
			return this;
		},
	} as unknown as ServerResponse;
	return { req, res, captured, closeClient: () => reqHandlers.close?.() };
}

/** Emit a fixed set of events synchronously on subscribe, then end. */
function arrayStreamSource(events: readonly unknown[]): EventStreamSource {
	return {
		subscribe(send, end) {
			for (const e of events) send(e);
			end();
			return () => {};
		},
	};
}

describe("createEventStreamHandler (SSE projector)", () => {
	it("ignores a non-matching route", () => {
		const handler = createEventStreamHandler("/agent/events", arrayStreamSource([]));
		const { req, res } = mocks("GET", "/other");
		expect(handler(req, res)).toBe(false);
	});

	it("streams each event as an SSE data frame + sets event-stream headers", () => {
		const handler = createEventStreamHandler("/agent/events", arrayStreamSource([
			{ event: "agent:prompt:start", ts: 1 },
			{ event: "agent:tool:call", ts: 2 },
		]));
		const { req, res, captured } = mocks("GET", "/agent/events");
		expect(handler(req, res)).toBe(true);
		expect(captured.status).toBe(200);
		expect(captured.headers?.["content-type"]).toBe("text/event-stream");
		expect(captured.writes).toEqual([
			'data: {"event":"agent:prompt:start","ts":1}\n\n',
			'data: {"event":"agent:tool:call","ts":2}\n\n',
		]);
		expect(captured.ended).toBe(true);
	});

	it("honours a prefix", () => {
		const handler = createEventStreamHandler("/agent/events", arrayStreamSource([]), { prefix: "/capabilities" });
		expect(handler(mocks("GET", "/agent/events").req, mocks("GET", "/agent/events").res)).toBe(false);
		const m = mocks("GET", "/capabilities/agent/events");
		expect(handler(m.req, m.res)).toBe(true);
	});

	it("unsubscribes + stops sending when the client disconnects", () => {
		let sendRef: ((event: unknown) => void) | undefined;
		let unsubscribed = false;
		const source: EventStreamSource = {
			subscribe(send) {
				sendRef = send;
				return () => {
					unsubscribed = true;
				};
			},
		};
		const handler = createEventStreamHandler("/agent/events", source);
		const { req, res, captured, closeClient } = mocks("GET", "/agent/events");
		handler(req, res);
		sendRef?.({ event: "before-close" });
		expect(captured.writes.length).toBe(1);
		closeClient();
		expect(unsubscribed).toBe(true);
		sendRef?.({ event: "after-close" }); // a late send is a no-op (connection closed)
		expect(captured.writes.length).toBe(1);
	});
});
