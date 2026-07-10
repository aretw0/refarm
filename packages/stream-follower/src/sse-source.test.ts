import http from "node:http";

import type { StreamChunk } from "@refarm.dev/stream-contract-v1";
import { afterEach, describe, expect, it } from "vitest";

import { createSseChunkSource } from "./sse-source.js";
import { followStream } from "./follow.js";

let server: http.Server | null = null;
afterEach(() => {
	server?.close();
	server = null;
});

/** Spin a tiny SSE server serving `/stream/:ref` with the exact sidecar frame format. */
function sseServer(chunks: StreamChunk[]): Promise<string> {
	return new Promise((resolve) => {
		server = http.createServer((req, res) => {
			if (!req.url?.startsWith("/stream/")) {
				res.writeHead(404).end();
				return;
			}
			res.writeHead(200, {
				"content-type": "text/event-stream",
				"cache-control": "no-cache",
				connection: "keep-alive",
			});
			// A heartbeat comment (must be ignored), then the data frames, then [DONE].
			res.write(": heartbeat\n\n");
			for (const chunk of chunks) {
				res.write(`data: ${JSON.stringify(chunk)}\n\n`);
			}
			res.write("data: [DONE]\n\n");
			res.end();
		});
		server.listen(0, "127.0.0.1", () => {
			const addr = server!.address();
			const port = typeof addr === "object" && addr ? addr.port : 0;
			resolve(`http://127.0.0.1:${port}`);
		});
	});
}

describe("createSseChunkSource", () => {
	it("follows an SSE stream from the sidecar to the final chunk (the remote path)", async () => {
		const baseUrl = await sseServer([
			{ stream_ref: "e", content: "re", sequence: 0, is_final: false },
			{ stream_ref: "e", content: "mo", sequence: 1, is_final: false },
			{ stream_ref: "e", content: "to", sequence: 2, is_final: true },
		]);
		const source = createSseChunkSource({ baseUrl });
		const result = await followStream(source, "e", { timeoutMs: 2_000 });
		expect(result.content).toBe("remoto");
		expect(result.final.is_final).toBe(true);
	});

	it("ignores heartbeats and the [DONE] sentinel", async () => {
		const baseUrl = await sseServer([
			{ stream_ref: "e", content: "ok", sequence: 0, is_final: true },
		]);
		const source = createSseChunkSource({ baseUrl });
		const seen: string[] = [];
		const result = await followStream(source, "e", {
			timeoutMs: 2_000,
			onChunk: (c) => seen.push(c.content),
		});
		// Only the real chunk fired onChunk — not the `: heartbeat` or `[DONE]`.
		expect(seen).toEqual(["ok"]);
		expect(result.content).toBe("ok");
	});

	it("rejects when the SSE endpoint returns non-OK", async () => {
		const source = createSseChunkSource({ baseUrl: "http://127.0.0.1:1" });
		await expect(followStream(source, "e", { timeoutMs: 500 })).rejects.toThrow();
	});
});
