import type { StreamChunk } from "@refarm.dev/stream-contract-v1";
import { describe, expect, it, vi } from "vitest";
import { StreamRegistry } from "./stream-registry.js";

const chunk: StreamChunk = {
	stream_ref: "test-ref",
	content: "hello",
	sequence: 0,
	is_final: false,
};

describe("StreamRegistry", () => {
	it("dispatches a chunk to all registered adapters", () => {
		const registry = new StreamRegistry();
		const write1 = vi.fn();
		const write2 = vi.fn();
		registry.register({ write: write1 });
		registry.register({ write: write2 });
		registry.dispatch(chunk);
		expect(write1).toHaveBeenCalledWith(chunk);
		expect(write2).toHaveBeenCalledWith(chunk);
	});

	it("continues dispatching when one adapter throws", () => {
		const registry = new StreamRegistry();
		const throwing = {
			write: vi.fn().mockImplementation(() => {
				throw new Error("boom");
			}),
		};
		const working = { write: vi.fn() };
		registry.register(throwing);
		registry.register(working);
		expect(() => registry.dispatch(chunk)).not.toThrow();
		expect(working.write).toHaveBeenCalledWith(chunk);
	});

	it("dispatches to adapters registered after creation", () => {
		const registry = new StreamRegistry();
		registry.dispatch(chunk);
		const write = vi.fn();
		registry.register({ write });
		registry.dispatch(chunk);
		expect(write).toHaveBeenCalledOnce();
	});
});
