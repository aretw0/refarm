import type { IncomingMessage, ServerResponse } from "node:http";

/**
 * The SSE projector — the STREAMING sibling of the HTTP route projector. Where createCapabilityRouteHandler
 * answers a request/response verb, this holds a connection open and pushes a stream of events as
 * `text/event-stream`. It returns the SAME `(req,res) => boolean` handler shape (true = "I handled this
 * route"), so it composes on the same node:http server beside the capability routes.
 *
 * The source is an {@link EventStreamSource} — `subscribe(send, end)` returning an unsubscribe fn — the
 * SAME structural shape the browser's LiveEventSource uses. One source abstraction, server + client: the
 * server tails a stream and pushes each event as SSE; the browser's EventSource receives + renders it into
 * the live table (mountLiveEventTable). Host-agnostic + source-injected, so the streaming is unit-tested
 * with a mock req/res + an array source — no real socket.
 */

/** A source of live events for an SSE route. `subscribe` pushes each event via `send` and signals the end
 * via `end`; it returns an unsubscribe fn, called when the client disconnects (or the caller stops). */
export interface EventStreamSource {
	subscribe(send: (event: unknown) => void, end: () => void): () => void;
}

/**
 * A node:http handler that streams `source`'s events as Server-Sent Events on GET `path`. Writes the SSE
 * headers, then one `data: <json>\n\n` frame per event, and unsubscribes when the client disconnects or the
 * source ends. Returns true iff it matched the route. Never throws into the socket — a send after close is a
 * no-op the runtime tolerates.
 */
export function createEventStreamHandler(
	path: string,
	source: EventStreamSource,
	options: { prefix?: string } = {},
): (req: IncomingMessage, res: ServerResponse) => boolean {
	const fullPath = `${options.prefix ?? ""}${path}`;
	return (req, res) => {
		const url = new URL(req.url ?? "/", "http://127.0.0.1");
		if ((req.method ?? "GET").toUpperCase() !== "GET" || url.pathname !== fullPath) return false;

		res.writeHead(200, {
			"content-type": "text/event-stream",
			"cache-control": "no-cache",
			connection: "keep-alive",
		});

		let closed = false;
		const send = (event: unknown): void => {
			if (!closed) res.write(`data: ${JSON.stringify(event)}\n\n`);
		};
		const end = (): void => {
			if (!closed) {
				closed = true;
				res.end();
			}
		};

		const unsubscribe = source.subscribe(send, end);
		const stop = (): void => {
			closed = true;
			unsubscribe();
		};
		req.on("close", stop);
		res.on("close", stop);
		return true;
	};
}
