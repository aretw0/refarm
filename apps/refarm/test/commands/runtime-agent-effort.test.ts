import { describe, expect, it } from "vitest";
import { createRuntimeAgentRespondEffort } from "../../src/commands/runtime-agent-effort.js";

describe("createRuntimeAgentRespondEffort", () => {
	it("builds the canonical runtime-agent respond effort", () => {
		const effort = createRuntimeAgentRespondEffort({
			prompt: "Summarize the open work",
			system: "system context",
			sessionId: "urn:refarm:session:v1:abc",
			source: "refarm-chat",
			historyTurns: 20,
			now: () => new Date("2026-05-18T19:00:00.000Z"),
			randomUUID: (() => {
				const ids = ["effort-id", "task-id"];
				return () => ids.shift() ?? "extra-id";
			})(),
		});

		expect(effort).toEqual({
			id: "effort-id",
			direction: "ask",
			tasks: [
				{
					id: "task-id",
					pluginId: "@refarm/pi-agent",
					fn: "respond",
					args: {
						prompt: "Summarize the open work",
						system: "system context",
						session_id: "urn:refarm:session:v1:abc",
						history_turns: 20,
					},
				},
			],
			source: "refarm-chat",
			submittedAt: "2026-05-18T19:00:00.000Z",
		});
	});
});
