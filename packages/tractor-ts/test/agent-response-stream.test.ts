import { describe, expect, it } from "vitest";
import {
	applyAgentResponseStreamEvent,
	emptyAgentResponseStreamState,
	reduceAgentResponseStreamEvents,
	reduceAgentResponseStreamEventsByPrompt,
	UNKNOWN_AGENT_RESPONSE_PROMPT_REF,
} from "../src/lib/agent-response-stream";

describe("AgentResponse streaming accumulator", () => {
	it("appends partial deltas and replaces content with the final full response", () => {
		const state = reduceAgentResponseStreamEvents([
			{ prompt_ref: "prompt-1", content: "Olá ", sequence: 0, is_final: false },
			{
				prompt_ref: "prompt-1",
				content: "stream",
				sequence: 1,
				is_final: false,
			},
			{
				prompt_ref: "prompt-1",
				content: "Olá stream",
				sequence: 2,
				is_final: true,
			},
		]);

		expect(state).toEqual({
			promptRef: "prompt-1",
			content: "Olá stream",
			lastSequence: 2,
			isFinal: true,
		});
	});

	it("groups interleaved events by prompt_ref for structured clients", () => {
		const states = reduceAgentResponseStreamEventsByPrompt([
			{ prompt_ref: "prompt-a", content: "hel", sequence: 0, is_final: false },
			{ prompt_ref: "prompt-b", content: "other", sequence: 0, is_final: true },
			{ prompt_ref: "prompt-a", content: "hello", sequence: 1, is_final: true },
			{ content: "orphan", sequence: 0, is_final: false },
		]);

		expect(states["prompt-a"]).toEqual({
			promptRef: "prompt-a",
			content: "hello",
			lastSequence: 1,
			isFinal: true,
		});
		expect(states["prompt-b"]).toEqual({
			promptRef: "prompt-b",
			content: "other",
			lastSequence: 0,
			isFinal: true,
		});
		expect(states[UNKNOWN_AGENT_RESPONSE_PROMPT_REF]).toEqual({
			promptRef: null,
			content: "orphan",
			lastSequence: 0,
			isFinal: false,
		});
	});

	it("keeps accumulated partial content when no final event has arrived", () => {
		const state = applyAgentResponseStreamEvent(
			emptyAgentResponseStreamState("prompt-2"),
			{ content: "delta", sequence: 4, is_final: false },
		);

		expect(state).toEqual({
			promptRef: "prompt-2",
			content: "delta",
			lastSequence: 4,
			isFinal: false,
		});
	});
});
