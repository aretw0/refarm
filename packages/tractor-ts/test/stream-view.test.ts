import { describe, expect, it } from "vitest";
import { emptyStreamChunkState } from "../src/lib/stream-chunk";
import { emptyStreamSessionState } from "../src/lib/stream-session";
import {
	streamObservationView,
	streamObservationViewsByStream,
} from "../src/lib/stream-view";

describe("stream observation view", () => {
	it("combines session lifecycle and chunk content for UI rendering", () => {
		const view = streamObservationView({
			session: {
				...emptyStreamSessionState("stream-a"),
				status: "active",
				streamKind: "agent-response",
				lastSequence: 2,
				chunkCount: 3,
				metadata: {
					prompt_ref: "prompt-a",
					projection: "AgentResponse",
					provider_family: "anthropic",
					model: "claude-test",
				},
			},
			chunk: {
				...emptyStreamChunkState("stream-a"),
				content: "hello",
				lastSequence: 2,
				payloadKind: "text_delta",
			},
		});

		expect(view).toMatchObject({
			streamRef: "stream-a",
			content: "hello",
			status: "active",
			payloadKind: "text_delta",
			isActive: true,
			isTerminal: false,
			lastSequence: 2,
			chunkCount: 3,
			projection: "AgentResponse",
			promptRef: "prompt-a",
			providerFamily: "anthropic",
			model: "claude-test",
		});
	});

	it("marks views terminal when either session or chunk is terminal", () => {
		const view = streamObservationView({
			session: {
				...emptyStreamSessionState("stream-a"),
				status: "active",
			},
			chunk: {
				...emptyStreamChunkState("stream-a"),
				isFinal: true,
				payloadKind: "final_text",
				content: "final",
			},
		});

		expect(view.isTerminal).toBe(true);
		expect(view.isActive).toBe(false);
		expect(view.content).toBe("final");
	});

	it("groups views across session and chunk maps", () => {
		const views = streamObservationViewsByStream(
			{
				"stream-a": {
					...emptyStreamSessionState("stream-a"),
					status: "completed",
					completedAtNs: 30,
					startedAtNs: 10,
				},
			},
			{
				"stream-b": {
					...emptyStreamChunkState("stream-b"),
					content: "orphan chunk",
				},
			},
		);

		expect(Object.keys(views).sort()).toEqual(["stream-a", "stream-b"]);
		expect(views["stream-a"].durationNs).toBe(20);
		expect(views["stream-a"].isTerminal).toBe(true);
		expect(views["stream-b"].content).toBe("orphan chunk");
	});
});
