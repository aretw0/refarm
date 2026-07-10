import type http from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FileStreamTransport } from "@refarm.dev/file-stream-transport";
import { runConformanceTests, type StreamChunk } from "@refarm.dev/stream-contract-v1";
import { SseStreamTransport } from "./sse-stream-transport.js";

let tempDir = "";

beforeEach(() => {
	tempDir = mkdtempSync(join(tmpdir(), "sse-stream-test-"));
});

afterEach(() => {
	rmSync(tempDir, { recursive: true, force: true });
});

runConformanceTests("SseStreamTransport", () => new SseStreamTransport(null));

describe("SseStreamTransport — HTTP route handler", () => {
	it("returns false for non-matching routes", () => {
		const transport = new SseStreamTransport(null);
		const handler = transport.getRouteHandler();
		const request = { method: "GET", url: "/other" } as http.IncomingMessage;
		const response = {
			writeHead: () => {},
			write: () => {},
			end: () => {},
		} as unknown as http.ServerResponse;
		expect(handler(request, response)).toBe(false);
	});

	it("returns true and writes SSE headers for /stream/:ref", () => {
		const transport = new SseStreamTransport(null);
		const handler = transport.getRouteHandler();
		let headers: Record<string, string> = {};
		const request = {
			method: "GET",
			url: "/stream/my-ref",
			on: () => {},
		} as unknown as http.IncomingMessage;
		const response = {
			writeHead: (_code: number, values: Record<string, string>) => {
				headers = values;
			},
			write: () => {},
			end: () => {},
		} as unknown as http.ServerResponse;

		expect(handler(request, response)).toBe(true);
		expect(headers["Content-Type"]).toBe("text/event-stream");
	});

	it("pushes SSE data frame to connected client on write()", () => {
		const transport = new SseStreamTransport(null);
		const handler = transport.getRouteHandler();
		const written: string[] = [];
		const request = {
			method: "GET",
			url: "/stream/r1",
			on: () => {},
		} as unknown as http.IncomingMessage;
		const response = {
			writeHead: () => {},
			write: (chunk: string) => {
				written.push(chunk);
			},
			end: () => {},
		} as unknown as http.ServerResponse;

		handler(request, response);
		transport.write({
			stream_ref: "r1",
			content: "tok",
			sequence: 0,
			is_final: false,
		});

		expect(written.some((value) => value.includes('"content":"tok"'))).toBe(true);
	});

	it("sends [DONE] frame and closes on is_final", () => {
		const transport = new SseStreamTransport(null);
		const handler = transport.getRouteHandler();
		const written: string[] = [];
		let ended = false;
		const request = {
			method: "GET",
			url: "/stream/r2",
			on: () => {},
		} as unknown as http.IncomingMessage;
		const response = {
			writeHead: () => {},
			write: (chunk: string) => {
				written.push(chunk);
			},
			end: () => {
				ended = true;
			},
		} as unknown as http.ServerResponse;

		handler(request, response);
		transport.write({
			stream_ref: "r2",
			content: "last",
			sequence: 0,
			is_final: true,
		});

		expect(written.some((value) => value.includes("[DONE]"))).toBe(true);
		expect(ended).toBe(true);
	});

	it("replays chunks from FileStreamTransport on SSE connect", () => {
		const fileTransport = new FileStreamTransport(tempDir);
		fileTransport.write({
			stream_ref: "r3",
			content: "past",
			sequence: 0,
			is_final: false,
		});

		const transport = new SseStreamTransport(fileTransport);
		const handler = transport.getRouteHandler();
		const written: string[] = [];
		const request = {
			method: "GET",
			url: "/stream/r3",
			on: () => {},
		} as unknown as http.IncomingMessage;
		const response = {
			writeHead: () => {},
			write: (chunk: string) => {
				written.push(chunk);
			},
			end: () => {},
		} as unknown as http.ServerResponse;

		handler(request, response);
		expect(written.some((value) => value.includes('"content":"past"'))).toBe(true);
	});
});

// ── Stream isolation — the invariant every interactive surface depends on ──────
//
// Multiple conversations (prompts/sessions) stream concurrently through ONE
// transport. Each is keyed by its own `stream_ref` (e.g.
// `urn:tractor:stream:response:<prompt_ref>`), and a chunk for stream A must NEVER
// reach a client subscribed to stream B — else the Web/TUI would splice two
// conversations together. The transport keys `connections`/`inProcess`/`stored` by
// stream_ref by design; this suite PROVES that separation holds under concurrency.

/** A mock SSE connection that records the frames written to it + whether it ended.
 * `frames` is the raw `data: …` strings; `contents` extracts the chunk contents. */
function mockConnection(): {
	request: http.IncomingMessage;
	response: http.ServerResponse;
	frames: string[];
	ended: () => boolean;
	fireClose: () => void;
} {
	const frames: string[] = [];
	let ended = false;
	let onClose: (() => void) | undefined;
	const request = {
		method: "GET",
		on: (event: string, cb: () => void) => {
			if (event === "close") onClose = cb;
		},
	} as unknown as http.IncomingMessage;
	const response = {
		writeHead: () => {},
		write: (chunk: string) => {
			frames.push(chunk);
			return true;
		},
		end: () => {
			ended = true;
		},
	} as unknown as http.ServerResponse;
	return {
		request,
		response,
		frames,
		ended: () => ended,
		fireClose: () => onClose?.(),
	};
}

/** Connect a mock client to `/stream/<ref>` on the transport's route handler. */
function connect(transport: SseStreamTransport, ref: string): ReturnType<typeof mockConnection> {
	const conn = mockConnection();
	(conn.request as { url?: string }).url = `/stream/${ref}`;
	transport.getRouteHandler()(conn.request, conn.response);
	return conn;
}

function chunk(stream_ref: string, content: string, is_final = false, sequence = 0): StreamChunk {
	return { stream_ref, content, sequence, is_final };
}

/** Whether any frame written to a connection carries `content`. */
function received(conn: ReturnType<typeof mockConnection>, content: string): boolean {
	return conn.frames.some((f) => f.includes(`"content":"${content}"`));
}

describe("SseStreamTransport — stream isolation (messages roll in separate)", () => {
	it("a chunk for stream A never reaches a client subscribed to stream B (SSE route)", () => {
		const transport = new SseStreamTransport(null);
		const connA = connect(transport, "A");
		const connB = connect(transport, "B");

		transport.write(chunk("A", "for-A"));
		transport.write(chunk("B", "for-B"));

		// Each client saw ONLY its own stream's content.
		expect(received(connA, "for-A")).toBe(true);
		expect(received(connA, "for-B")).toBe(false); // no leak A←B
		expect(received(connB, "for-B")).toBe(true);
		expect(received(connB, "for-A")).toBe(false); // no leak B←A
	});

	it("an in-process subscriber for A never fires for a B chunk", () => {
		const transport = new SseStreamTransport(null);
		const seenByA: string[] = [];
		const seenByB: string[] = [];
		transport.subscribe("A", (c) => seenByA.push(c.content));
		transport.subscribe("B", (c) => seenByB.push(c.content));

		transport.write(chunk("A", "a1"));
		transport.write(chunk("B", "b1"));
		transport.write(chunk("A", "a2", false, 1));

		expect(seenByA).toEqual(["a1", "a2"]);
		expect(seenByB).toEqual(["b1"]); // B never saw A's chunks, and vice-versa
	});

	it("is_final on stream A closes ONLY A's connections, leaving B streaming", () => {
		const transport = new SseStreamTransport(null);
		const connA = connect(transport, "A");
		const connB = connect(transport, "B");

		transport.write(chunk("A", "done-A", true));

		expect(connA.ended()).toBe(true); // A finalised + closed
		expect(connB.ended()).toBe(false); // B still open

		// B keeps receiving after A finalised — the streams are independent.
		transport.write(chunk("B", "after-A-final"));
		expect(received(connB, "after-A-final")).toBe(true);
		// And a late A chunk reaches nobody (A's connection set was cleared).
		transport.write(chunk("A", "late-A"));
		expect(received(connA, "late-A")).toBe(false);
	});

	it("cancel(A) drops only A's subscribers/connections; B is untouched", () => {
		const transport = new SseStreamTransport(null);
		const connA = connect(transport, "A");
		const connB = connect(transport, "B");
		const subA: string[] = [];
		const subB: string[] = [];
		transport.subscribe("A", (c) => subA.push(c.content));
		transport.subscribe("B", (c) => subB.push(c.content));

		transport.cancel("A");

		transport.write(chunk("A", "post-cancel-A"));
		transport.write(chunk("B", "post-cancel-B"));

		// A is fully detached (SSE + in-process); B still flows.
		expect(received(connA, "post-cancel-A")).toBe(false);
		expect(subA).toEqual([]);
		expect(received(connB, "post-cancel-B")).toBe(true);
		expect(subB).toEqual(["post-cancel-B"]);
	});

	it("replay is per-ref: a new subscriber to A gets A's history, none of B's", () => {
		const transport = new SseStreamTransport(null);
		transport.write(chunk("A", "a-hist-1"));
		transport.write(chunk("B", "b-hist-1"));
		transport.write(chunk("A", "a-hist-2", false, 1));

		const replayed: string[] = [];
		transport.subscribe("A", (c) => replayed.push(c.content));

		// The late subscriber to A replays ONLY A's stored history, in order.
		expect(replayed).toEqual(["a-hist-1", "a-hist-2"]);
	});

	it("two connections on the SAME ref both receive it (fan-out within a stream)", () => {
		const transport = new SseStreamTransport(null);
		const conn1 = connect(transport, "A");
		const conn2 = connect(transport, "A");

		transport.write(chunk("A", "shared"));

		expect(received(conn1, "shared")).toBe(true);
		expect(received(conn2, "shared")).toBe(true);
	});

	it("closing one connection on A does not stop the other A connection", () => {
		const transport = new SseStreamTransport(null);
		const conn1 = connect(transport, "A");
		const conn2 = connect(transport, "A");

		conn1.fireClose(); // client 1 disconnects

		transport.write(chunk("A", "after-close"));

		expect(received(conn1, "after-close")).toBe(false); // gone
		expect(received(conn2, "after-close")).toBe(true); // still connected
	});
});
