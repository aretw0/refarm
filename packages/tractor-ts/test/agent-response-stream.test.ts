import { describe, expect, it } from "vitest";
import {
	applyAgentResponseStreamEvent,
	emptyAgentResponseStreamState,
	reduceAgentResponseStreamEvents,
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
