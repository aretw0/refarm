import { describe, expect, it } from "vitest";
import { STREAM_CAPABILITY } from "./types.js";
import type { StreamChunk, StreamTransportAdapter } from "./types.js";

export function runConformanceTests(
	suiteName: string,
	factory: () => StreamTransportAdapter,
): void {
	describe(`${suiteName} — stream:v1 conformance`, () => {
		it("has capability marker", () => {
			expect(factory().capability).toBe(STREAM_CAPABILITY);
		});

		it("delivers a chunk to a subscriber", () => {
			const transport = factory();
			const received: StreamChunk[] = [];
			transport.subscribe("ref-a", (chunk) => received.push(chunk));
			transport.write({
				stream_ref: "ref-a",
				content: "hello",
				sequence: 0,
				is_final: false,
			});
			expect(received).toHaveLength(1);
			expect(received[0].content).toBe("hello");
		});

		it("replays past chunks on late subscribe", () => {
			const transport = factory();
			transport.write({
				stream_ref: "ref-b",
				content: "a",
				sequence: 0,
				is_final: false,
			});
			transport.write({
				stream_ref: "ref-b",
				content: "b",
				sequence: 1,
				is_final: false,
			});
			const received: StreamChunk[] = [];
			transport.subscribe("ref-b", (chunk) => received.push(chunk));
			expect(received).toHaveLength(2);
			expect(received.map((chunk) => chunk.content)).toEqual(["a", "b"]);
		});

		it("delivers final chunk and signals completion", () => {
			const transport = factory();
			const received: StreamChunk[] = [];
			transport.subscribe("ref-c", (chunk) => received.push(chunk));
			transport.write({
				stream_ref: "ref-c",
				content: "last",
				sequence: 0,
				is_final: true,
			});
			expect(received[received.length - 1].is_final).toBe(true);
		});

		it("delivers to multiple subscribers for same stream_ref", () => {
			const transport = factory();
			const first: StreamChunk[] = [];
			const second: StreamChunk[] = [];
			transport.subscribe("ref-d", (chunk) => first.push(chunk));
			transport.subscribe("ref-d", (chunk) => second.push(chunk));
			transport.write({
				stream_ref: "ref-d",
				content: "x",
				sequence: 0,
				is_final: false,
			});
			expect(first).toHaveLength(1);
			expect(second).toHaveLength(1);
		});

		it("maintains sequence order under rapid writes", () => {
			const transport = factory();
			const sequences: number[] = [];
			transport.subscribe("ref-e", (chunk) => sequences.push(chunk.sequence));
			for (let index = 0; index < 5; index++) {
				transport.write({
					stream_ref: "ref-e",
					content: `c${index}`,
					sequence: index,
					is_final: index === 4,
				});
			}
			expect(sequences).toEqual([0, 1, 2, 3, 4]);
		});
	});
}
