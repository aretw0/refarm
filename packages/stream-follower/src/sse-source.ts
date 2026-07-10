import type { StreamChunk } from "@refarm.dev/stream-contract-v1";

import type { ChunkSource } from "./types.js";

export interface SseChunkSourceOptions {
	/** Base URL of the sidecar (e.g. `http://127.0.0.1:42123`). */
	baseUrl: string;
	/**
	 * Path template for the SSE stream, with `:ref` replaced by the stream_ref.
	 * Defaults to the sidecar's `/stream/:ref` (what `SseStreamTransport` serves).
	 */
	pathTemplate?: string;
	/** Extra headers (auth, etc.) for the SSE request. */
	headers?: Record<string, string>;
	/** Injected fetch (defaults to global `fetch`) — for tests / non-global runtimes. */
	fetchImpl?: typeof fetch;
}

/**
 * A {@link ChunkSource} that consumes the sidecar's Server-Sent Events endpoint —
 * the REMOTE half. `SseStreamTransport` serves `/stream/:ref` as `data: <json>\n\n`
 * frames (with `data: [DONE]` at the end and `: heartbeat` keep-alives); this reads
 * that stream over HTTP and emits each frame's JSON as a {@link StreamChunk}. This is
 * the piece that lets a follower — and the SDK on top — work against a daemon on
 * another machine, not just a local file.
 */
export function createSseChunkSource(options: SseChunkSourceOptions): ChunkSource {
	const fetchImpl = options.fetchImpl ?? fetch;
	const template = options.pathTemplate ?? "/stream/:ref";
	const base = options.baseUrl.replace(/\/+$/, "");

	return {
		follow(streamRef, onChunk, onError) {
			const controller = new AbortController();
			const url = base + template.replace(":ref", encodeURIComponent(streamRef));

			(async () => {
				let response: Response;
				try {
					response = await fetchImpl(url, {
						headers: { accept: "text/event-stream", ...options.headers },
						signal: controller.signal,
					});
				} catch (error) {
					if (!controller.signal.aborted) {
						onError(error instanceof Error ? error : new Error(String(error)));
					}
					return;
				}
				if (!response.ok || !response.body) {
					onError(new Error(`SSE ${url} returned ${response.status}`));
					return;
				}

				const reader = response.body.getReader();
				const decoder = new TextDecoder();
				let buffer = "";
				try {
					for (;;) {
						const { done, value } = await reader.read();
						if (done) break;
						buffer += decoder.decode(value, { stream: true });
						// SSE frames are separated by a blank line.
						let sep: number;
						while ((sep = buffer.indexOf("\n\n")) !== -1) {
							const frame = buffer.slice(0, sep);
							buffer = buffer.slice(sep + 2);
							emitFrame(frame, onChunk);
						}
					}
				} catch (error) {
					if (!controller.signal.aborted) {
						onError(error instanceof Error ? error : new Error(String(error)));
					}
				}
			})();

			return { stop: () => controller.abort() };
		},
	};
}

/** Parse one SSE frame's `data:` lines; skip comments (`:`) and the `[DONE]` sentinel. */
function emitFrame(frame: string, onChunk: (chunk: StreamChunk) => void): void {
	for (const line of frame.split("\n")) {
		if (!line.startsWith("data:")) continue; // `: heartbeat` and field lines
		const data = line.slice(5).trim();
		if (data === "[DONE]" || data.length === 0) continue;
		try {
			onChunk(JSON.parse(data) as StreamChunk);
		} catch {
			// malformed frame — ignore, the stream continues
		}
	}
}
