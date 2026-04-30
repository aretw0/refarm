import { describe, expect, it } from "vitest";
import {
	applyStreamSessionEvent,
	emptyStreamSessionState,
	isActiveStreamSession,
	isAgentResponseStreamSession,
	isCompletedStreamSession,
	isFailedStreamSession,
	isStreamSessionKind,
	isStreamSessionStatus,
	isTerminalStreamSession,
	isTerminalStreamSessionStatus,
	orderStreamSessionEvents,
	reduceStreamSessionEvents,
	reduceStreamSessionEventsByStream,
	streamSessionDurationNs,
	streamSessionFailureKind,
	streamSessionFailureReason,
	streamSessionModel,
	streamSessionProjection,
	streamSessionPromptRef,
	streamSessionProviderFamily,
	UNKNOWN_STREAM_SESSION_REF,
} from "../src/lib/stream-session";

describe("StreamSession accumulator", () => {
	it("applies lifecycle snapshots for a stream", () => {
		const state = reduceStreamSessionEvents([
			{
				stream_ref: "stream-a",
				stream_kind: "agent-response",
				status: "active",
				started_at_ns: 100,
				updated_at_ns: 100,
				last_sequence: null,
				chunk_count: 0,
				metadata: {
					projection: "AgentResponse",
					prompt_ref: "prompt-a",
					provider_family: "openai",
					model: "gpt-test",
				},
			},
			{
				stream_ref: "stream-a",
				status: "completed",
				updated_at_ns: 200,
				completed_at_ns: 200,
				last_sequence: 2,
				chunk_count: 3,
			},
		]);

		expect(state).toEqual({
			streamRef: "stream-a",
			streamKind: "agent-response",
			status: "completed",
			startedAtNs: 100,
			updatedAtNs: 200,
			completedAtNs: 200,
			lastSequence: 2,
			chunkCount: 3,
			metadata: {
				projection: "AgentResponse",
				prompt_ref: "prompt-a",
				provider_family: "openai",
				model: "gpt-test",
			},
		});
		expect(isStreamSessionKind(state.streamKind)).toBe(true);
		expect(isAgentResponseStreamSession(state)).toBe(true);
		expect(streamSessionProjection(state)).toBe("AgentResponse");
		expect(streamSessionPromptRef(state)).toBe("prompt-a");
		expect(streamSessionProviderFamily(state)).toBe("openai");
		expect(streamSessionModel(state)).toBe("gpt-test");
		expect(streamSessionDurationNs(state)).toBe(100);
	});

	it("groups interleaved sessions by stream_ref", () => {
		const states = reduceStreamSessionEventsByStream([
			{ stream_ref: "stream-a", status: "active", chunk_count: 0 },
			{ stream_ref: "stream-b", status: "completed", chunk_count: 1 },
			{ stream_ref: "stream-a", status: "completed", chunk_count: 2 },
			{ status: "orphan", chunk_count: 9 },
		]);

		expect(states["stream-a"].status).toBe("completed");
		expect(states["stream-a"].chunkCount).toBe(2);
		expect(states["stream-b"].status).toBe("completed");
		expect(states[UNKNOWN_STREAM_SESSION_REF]).toEqual({
			streamRef: null,
			streamKind: null,
			status: "orphan",
			startedAtNs: null,
			updatedAtNs: null,
			completedAtNs: null,
			lastSequence: null,
			chunkCount: 9,
			metadata: null,
		});
	});

	it("orders session snapshots by lifecycle timestamp without mutating input", () => {
		const events = [
			{ stream_ref: "stream-a", status: "completed", updated_at_ns: 300 },
			{ stream_ref: "stream-a", status: "active", started_at_ns: 100 },
			{ stream_ref: "stream-a", status: "unknown" },
		];

		const ordered = orderStreamSessionEvents(events);

		expect(ordered.map((event) => event.status)).toEqual([
			"active",
			"completed",
			"unknown",
		]);
		expect(events.map((event) => event.status)).toEqual([
			"completed",
			"active",
			"unknown",
		]);
	});

	it("detects terminal stream session statuses", () => {
		expect(isStreamSessionStatus("active")).toBe(true);
		expect(isStreamSessionStatus("unknown")).toBe(false);
		expect(isTerminalStreamSessionStatus("active")).toBe(false);
		expect(isTerminalStreamSessionStatus("completed")).toBe(true);
		expect(isTerminalStreamSessionStatus("failed")).toBe(true);
		expect(
			isActiveStreamSession({
				...emptyStreamSessionState("stream-active"),
				status: "active",
			}),
		).toBe(true);
		expect(
			isTerminalStreamSession({
				...emptyStreamSessionState("stream-terminal"),
				status: "completed",
			}),
		).toBe(true);
		expect(
			isCompletedStreamSession({
				...emptyStreamSessionState("stream-completed"),
				status: "completed",
			}),
		).toBe(true);
		expect(
			isFailedStreamSession({
				...emptyStreamSessionState("stream-failed"),
				status: "failed",
			}),
		).toBe(true);
	});

	it("extracts sanitized failure metadata", () => {
		const state = reduceStreamSessionEvents([
			{
				stream_ref: "stream-failed",
				status: "failed",
				metadata: {
					failure_kind: "stream_read_failed",
					failure_reason: "sse stream body too large",
				},
			},
		]);

		expect(streamSessionFailureKind(state)).toBe("stream_read_failed");
		expect(streamSessionFailureReason(state)).toBe("sse stream body too large");
	});

	it("preserves prior identity and ignores non-finite counters", () => {
		const state = applyStreamSessionEvent(emptyStreamSessionState("stream-c"), {
			status: "active",
			chunk_count: Number.NaN,
		});

		expect(state.streamRef).toBe("stream-c");
		expect(state.status).toBe("active");
		expect(state.chunkCount).toBe(0);
	});
});
