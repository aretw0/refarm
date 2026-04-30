import { describe, expect, it } from "vitest";
import {
	applyStreamChunkEvent,
	emptyStreamChunkState,
	isFinalEmptyStreamChunkPayloadKind,
	isFinalTextStreamChunkPayloadKind,
	isFinalToolCallStreamChunkPayloadKind,
	isTerminalStreamChunk,
	isTerminalStreamChunkPayloadKind,
	isTerminalStreamChunkState,
	orderStreamChunkEvents,
	reduceStreamChunkEvents,
	reduceStreamChunkEventsByStream,
	UNKNOWN_STREAM_REF,
} from "../src/lib/stream-chunk";

describe("StreamChunk accumulator", () => {
	it("appends partial chunks and replaces content on final chunks", () => {
		const state = reduceStreamChunkEvents([
			{
				stream_ref: "urn:tractor:stream:1",
				content: "hel",
				sequence: 0,
				payload_kind: "text_delta",
				is_final: false,
			},
			{
				stream_ref: "urn:tractor:stream:1",
				content: "lo",
				sequence: 1,
				payload_kind: "text_delta",
				is_final: false,
			},
			{
				stream_ref: "urn:tractor:stream:1",
				content: "hello",
				sequence: 2,
				payload_kind: "text_delta",
				is_final: true,
			},
		]);

		expect(state).toEqual({
			streamRef: "urn:tractor:stream:1",
			content: "hello",
			lastSequence: 2,
			isFinal: true,
			payloadKind: "text_delta",
		});
	});

	it("orders chunks by sequence without mutating the input", () => {
		const events = [
			{ content: "second", sequence: 1, is_final: false },
			{ content: "first", sequence: 0, is_final: false },
			{ content: "unknown", is_final: false },
		];

		const ordered = orderStreamChunkEvents(events);

		expect(ordered.map((event) => event.content)).toEqual([
			"first",
			"second",
			"unknown",
		]);
		expect(events.map((event) => event.content)).toEqual([
			"second",
			"first",
			"unknown",
		]);
	});

	it("groups interleaved chunks by stream_ref", () => {
		const states = reduceStreamChunkEventsByStream([
			{ stream_ref: "stream-a", content: "a", sequence: 0, is_final: false },
			{ stream_ref: "stream-b", content: "b", sequence: 0, is_final: true },
			{ stream_ref: "stream-a", content: "aa", sequence: 1, is_final: true },
			{ content: "orphan", sequence: 0, is_final: false },
		]);

		expect(states["stream-a"].content).toBe("aa");
		expect(states["stream-a"].isFinal).toBe(true);
		expect(states["stream-b"].content).toBe("b");
		expect(states[UNKNOWN_STREAM_REF]).toEqual({
			streamRef: null,
			content: "orphan",
			lastSequence: 0,
			isFinal: false,
			payloadKind: null,
		});
	});

	it("detects terminal stream chunk markers", () => {
		expect(isTerminalStreamChunkPayloadKind("final_text")).toBe(true);
		expect(isTerminalStreamChunkPayloadKind("final_tool_call")).toBe(true);
		expect(isTerminalStreamChunkPayloadKind("final_empty")).toBe(true);
		expect(isTerminalStreamChunkPayloadKind("text_delta")).toBe(false);
		expect(isFinalTextStreamChunkPayloadKind("final_text")).toBe(true);
		expect(isFinalToolCallStreamChunkPayloadKind("final_tool_call")).toBe(true);
		expect(isFinalEmptyStreamChunkPayloadKind("final_empty")).toBe(true);
		expect(isTerminalStreamChunk({ payload_kind: "final_tool_call" })).toBe(
			true,
		);
		expect(
			isTerminalStreamChunk({ payload_kind: "text_delta", is_final: true }),
		).toBe(true);
		expect(
			isTerminalStreamChunkState({
				...emptyStreamChunkState("stream-terminal"),
				payloadKind: "final_empty",
			}),
		).toBe(true);
	});

	it("preserves prior stream identity when events omit stream_ref", () => {
		const state = applyStreamChunkEvent(emptyStreamChunkState("stream-c"), {
			content: "delta",
			sequence: 3,
			is_final: false,
		});

		expect(state.streamRef).toBe("stream-c");
		expect(state.content).toBe("delta");
		expect(state.lastSequence).toBe(3);
	});
});
