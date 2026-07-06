import type { StreamChunk } from "@refarm.dev/stream-contract-v1";
import { describe, expect, it } from "vitest";
import { shouldProjectStreamChunk, toStreamChunk } from "./stream-chunk-mapper.js";

function chunk(overrides: Partial<StreamChunk> = {}): StreamChunk {
	return {
		stream_ref: "urn:tractor:stream:response:p1",
		content: "x",
		sequence: 0,
		is_final: false,
		...overrides,
	};
}

describe("shouldProjectStreamChunk (farmhand dedup)", () => {
	it("projects partial agent-response chunks", () => {
		expect(shouldProjectStreamChunk(chunk({ is_final: false }))).toBe(true);
	});

	it("drops the host whole-answer final for agent-response streams", () => {
		// The guest writes the single final ndjson line; projecting the host's
		// is_final observation too would double the answer in {stream_ref}.ndjson.
		expect(
			shouldProjectStreamChunk(
				chunk({ is_final: true, content: "the whole answer" }),
			),
		).toBe(false);
	});

	it("projects final chunks for NON-agent-response streams", () => {
		// Other stream families own their own final line — only agent-response is
		// deduped against the guest writer.
		expect(
			shouldProjectStreamChunk(
				chunk({ stream_ref: "urn:tractor:stream:vault:v1", is_final: true }),
			),
		).toBe(true);
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
