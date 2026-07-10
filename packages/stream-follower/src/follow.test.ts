import type { StreamChunk } from "@refarm.dev/stream-contract-v1";
import { describe, expect, it } from "vitest";

import { followStream } from "./follow.js";
import type { ChunkSource } from "./types.js";

function chunk(seq: number, content: string, is_final = false): StreamChunk {
	return { stream_ref: "ref", content, sequence: seq, is_final };
}

/** A source that emits a scripted list of chunks synchronously on follow. */
function scriptedSource(chunks: StreamChunk[]): ChunkSource {
	return {
		follow(_ref, onChunk) {
			for (const c of chunks) onChunk(c);
			return { stop: () => {} };
		},
	};
}

describe("followStream", () => {
	it("resolves with concatenated content when the final chunk arrives", async () => {
		const source = scriptedSource([
			chunk(0, "Hello "),
			chunk(1, "world"),
			chunk(2, "!", true),
		]);
		const result = await followStream(source, "ref");
		expect(result.content).toBe("Hello world!");
		expect(result.final.is_final).toBe(true);
		expect(result.chunks).toHaveLength(3);
	});

	it("orders content by sequence even if earlier chunks arrive out of order", async () => {
		// A realistic race: non-final chunks arrive shuffled; the final is still last.
		const source = scriptedSource([
			chunk(1, "B"),
			chunk(0, "A"),
			chunk(2, "C", true),
		]);
		const result = await followStream(source, "ref");
		// Content is assembled in ascending sequence order, so it is stable.
		expect(result.content).toBe("ABC");
	});

	it("de-dupes re-delivered chunks (poll re-reads / replay-on-subscribe)", async () => {
		const source: ChunkSource = {
			follow(_ref, onChunk) {
				onChunk(chunk(0, "x"));
				onChunk(chunk(0, "x")); // duplicate sequence — must be ignored
				onChunk(chunk(1, "y", true));
				return { stop: () => {} };
			},
		};
		const seen: number[] = [];
		const result = await followStream(source, "ref", {
			onChunk: (c) => seen.push(c.sequence),
		});
		expect(seen).toEqual([0, 1]); // the duplicate did not fire onChunk again
		expect(result.content).toBe("xy");
	});

	it("calls onChunk incrementally for streaming consumers", async () => {
		const source = scriptedSource([chunk(0, "a"), chunk(1, "b"), chunk(2, "c", true)]);
		const deltas: string[] = [];
		await followStream(source, "ref", { onChunk: (c) => deltas.push(c.content) });
		expect(deltas).toEqual(["a", "b", "c"]);
	});

	it("rejects on timeout when no final chunk arrives", async () => {
		const source: ChunkSource = {
			follow(_ref, onChunk) {
				onChunk(chunk(0, "partial")); // never final
				return { stop: () => {} };
			},
		};
		await expect(followStream(source, "ref", { timeoutMs: 50 })).rejects.toThrow(
			/did not reach a final chunk within 50ms/,
		);
	});

	it("rejects when the source reports an error", async () => {
		const source: ChunkSource = {
			follow(_ref, _onChunk, onError) {
				onError(new Error("effort failed"));
				return { stop: () => {} };
			},
		};
		await expect(followStream(source, "ref")).rejects.toThrow("effort failed");
	});

	it("stops the source once settled (no leak past the final chunk)", async () => {
		let stopped = false;
		const source: ChunkSource = {
			follow(_ref, onChunk) {
				onChunk(chunk(0, "done", true));
				return { stop: () => { stopped = true; } };
			},
		};
		await followStream(source, "ref");
		expect(stopped).toBe(true);
	});
});
