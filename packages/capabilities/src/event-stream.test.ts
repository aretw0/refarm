import type { IncomingMessage, ServerResponse } from "node:http";
import { describe, expect, it } from "vitest";

import { broadcastEventSource, createEventStreamHandler, type EventStreamSource } from "./event-stream.js";

/** A mock req that can fire "close", + a mock res capturing head/writes/end + firing "close". */
function mocks(method: string, path: string): {
	req: IncomingMessage;
	res: ServerResponse;
	captured: { status?: number; headers?: Record<string, string>; writes: string[]; ended: boolean };
	closeClient: () => void;
} {
	const reqHandlers: Record<string, () => void> = {};
	const resHandlers: Record<string, () => void> = {};
	const captured = { status: undefined as number | undefined, headers: undefined as Record<string, string> | undefined, writes: [] as string[], ended: false, flushed: false };
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
		flushHeaders() {
			captured.flushed = true;
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
		expect(captured.flushed).toBe(true); // headers flushed immediately so the client connects before any event
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

/** A controllable underlying source: capture its send/end, count subscriptions, track unsubscribe. */
function manualUnderlying(): {
	source: EventStreamSource;
	emit: (event: unknown) => void;
	subscribeCount: () => number;
	unsubscribed: () => boolean;
} {
	let sendRef: ((event: unknown) => void) | undefined;
	let subs = 0;
	let unsub = true;
	const source: EventStreamSource = {
		subscribe(send) {
			subs += 1;
			unsub = false;
			sendRef = send;
			return () => {
				unsub = true;
				sendRef = undefined;
			};
		},
	};
	return {
		source,
		emit: (event) => sendRef?.(event),
		subscribeCount: () => subs,
		unsubscribed: () => unsub,
	};
}

describe("broadcastEventSource (fan one stream out to many clients)", () => {
	it("subscribes the underlying ONCE and fans each event to every client", () => {
		const u = manualUnderlying();
		const hub = broadcastEventSource(u.source);
		const a: unknown[] = [];
		const b: unknown[] = [];
		hub.subscribe((e) => a.push(e), () => {});
		hub.subscribe((e) => b.push(e), () => {});
		expect(u.subscribeCount()).toBe(1); // one underlying subscription for both clients
		u.emit({ n: 1 });
		u.emit({ n: 2 });
		expect(a).toEqual([{ n: 1 }, { n: 2 }]);
		expect(b).toEqual([{ n: 1 }, { n: 2 }]);
	});

	it("replays the run-so-far to a late joiner, then fans live events", () => {
		const u = manualUnderlying();
		const hub = broadcastEventSource(u.source);
		const early: unknown[] = [];
		hub.subscribe((e) => early.push(e), () => {});
		u.emit({ n: 1 });
		u.emit({ n: 2 });
		const late: unknown[] = [];
		hub.subscribe((e) => late.push(e), () => {}); // joins after two events
		expect(late).toEqual([{ n: 1 }, { n: 2 }]); // history replayed
		u.emit({ n: 3 });
		expect(late).toEqual([{ n: 1 }, { n: 2 }, { n: 3 }]);
		expect(early).toEqual([{ n: 1 }, { n: 2 }, { n: 3 }]);
	});

	it("unsubscribes the underlying only when the LAST client leaves", () => {
		const u = manualUnderlying();
		const hub = broadcastEventSource(u.source);
		const stop1 = hub.subscribe(() => {}, () => {});
		const stop2 = hub.subscribe(() => {}, () => {});
		stop1();
		expect(u.unsubscribed()).toBe(false); // one client remains
		stop2();
		expect(u.unsubscribed()).toBe(true); // last left → underlying stopped
	});

	it("clears the buffer when idle; a reconnecting client re-reads via a fresh subscription (no dup)", () => {
		const u = manualUnderlying();
		const hub = broadcastEventSource(u.source);
		const stop1 = hub.subscribe(() => {}, () => {});
		u.emit({ n: 1 });
		u.emit({ n: 2 });
		stop1(); // last client left → underlying unsubscribed + buffer cleared
		expect(u.subscribeCount()).toBe(1);

		const got: unknown[] = [];
		hub.subscribe((e) => got.push(e), () => {});
		expect(u.subscribeCount()).toBe(2); // re-subscribed fresh
		expect(got).toEqual([]); // buffer was cleared → nothing replayed on join
		u.emit({ n: 1 }); // a fresh poll re-reads the file...
		u.emit({ n: 2 });
		expect(got).toEqual([{ n: 1 }, { n: 2 }]); // ...delivered ONCE (nothing to skip)
	});

	it("does NOT drop live events on reconnect with a NON-replaying (push) source", () => {
		// The case the old skip logic silently dropped: a push source that resumes with NEW events only.
		const u = manualUnderlying();
		const hub = broadcastEventSource(u.source);
		const stop1 = hub.subscribe(() => {}, () => {});
		u.emit({ n: 1 });
		u.emit({ n: 2 });
		stop1();
		const got: unknown[] = [];
		hub.subscribe((e) => got.push(e), () => {});
		u.emit({ n: 3 }); // NEW events (not a replay) — every one must reach the client
		u.emit({ n: 4 });
		expect(got).toEqual([{ n: 3 }, { n: 4 }]); // e3,e4 NOT dropped
	});

	it("bounds the replay buffer at maxHistory (a late joiner sees the last N)", () => {
		const u = manualUnderlying();
		const hub = broadcastEventSource(u.source, { maxHistory: 2 });
		hub.subscribe(() => {}, () => {}); // keep the underlying alive
		u.emit({ n: 1 });
		u.emit({ n: 2 });
		u.emit({ n: 3 });
		const late: unknown[] = [];
		hub.subscribe((e) => late.push(e), () => {});
		expect(late).toEqual([{ n: 2 }, { n: 3 }]); // the oldest fell out of the ring
	});
});
