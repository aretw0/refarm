import type { StreamChunk } from "@refarm.dev/stream-contract-v1";
import { describe, expect, it } from "vitest";
import {
	projectStreamChunk,
	shouldProjectStreamChunk,
	toStreamChunk,
} from "./stream-chunk-mapper.js";

function chunk(overrides: Partial<StreamChunk> = {}): StreamChunk {
	return {
		stream_ref: "urn:tractor:stream:response:p1",
		content: "x",
		sequence: 0,
		is_final: false,
		...overrides,
	};
}

describe("shouldProjectStreamChunk (farmhand)", () => {
	it("projects partial agent-response chunks", () => {
		expect(shouldProjectStreamChunk(chunk({ is_final: false }))).toBe(true);
	});

	it("projects the agent-response final (the tractor-ts guest cannot write it)", () => {
		// On the Rust host the guest owns the final ndjson line, but the tractor-ts
		// guest's wasi:filesystem is an inert stub — dropping the host's final here
		// would leave the stream with no terminal line at all.
		expect(shouldProjectStreamChunk(chunk({ is_final: true }))).toBe(true);
	});

	it("projects final chunks for NON-agent-response streams", () => {
		expect(
			shouldProjectStreamChunk(
				chunk({ stream_ref: "urn:tractor:stream:vault:v1", is_final: true }),
			),
		).toBe(true);
	});
});

describe("projectStreamChunk (single-owner final rule)", () => {
	it("passes single-shot agent-response finals through with the whole answer", () => {
		// No partials preceded (sequence 0): the final carries the full answer, which
		// the accumulating CLI files exactly once.
		const projected = projectStreamChunk(
			chunk({ is_final: true, sequence: 0, content: "the whole answer" }),
		);
		expect(projected.content).toBe("the whole answer");
	});

	it("blanks the agent-response final when partials preceded it", () => {
		// Partials (sequence > 0) already carried the deltas; the final becomes a pure
		// end-marker so sum(partials) + final.content == answer, exactly once.
		const projected = projectStreamChunk(
			chunk({ is_final: true, sequence: 3, content: "the whole answer" }),
		);
		expect(projected.content).toBe("");
		expect(projected.is_final).toBe(true);
		expect(projected.sequence).toBe(3);
	});

	it("passes partial agent-response chunks through unchanged", () => {
		const partial = chunk({ is_final: false, sequence: 2, content: "delta" });
		expect(projectStreamChunk(partial)).toEqual(partial);
	});

	it("does not blank finals for NON-agent-response streams", () => {
		const other = chunk({
			stream_ref: "urn:tractor:stream:vault:v1",
			is_final: true,
			sequence: 5,
			content: "keep me",
		});
		expect(projectStreamChunk(other).content).toBe("keep me");
	});
});

describe("toStreamChunk", () => {
	it("maps node fields with defaults", () => {
		const mapped = toStreamChunk({
			stream_ref: "urn:tractor:stream:response:p1",
			content: "hi",
			sequence: 2,
			is_final: true,
			payload_kind: "text_delta",
		});
		expect(mapped).toMatchObject({
			stream_ref: "urn:tractor:stream:response:p1",
			content: "hi",
			sequence: 2,
			is_final: true,
			payload_kind: "text_delta",
		});
	});

	it("defaults missing fields safely", () => {
		const mapped = toStreamChunk({});
		expect(mapped.stream_ref).toBe("");
		expect(mapped.content).toBe("");
		expect(mapped.sequence).toBe(0);
		expect(mapped.is_final).toBe(false);
	});
});
