import { describe, expect, it } from "vitest";
import { createRuntimeAgentRespondEffort } from "../../src/commands/runtime-agent-effort.js";

describe("createRuntimeAgentRespondEffort", () => {
	it("builds the canonical runtime-agent respond effort", () => {
		const effort = createRuntimeAgentRespondEffort({
			prompt: "Summarize the open work",
			system: "system context",
			sessionId: "urn:sovereign:session:v1:abc",
			source: "refarm-chat",
			historyTurns: 20,
			modelProvider: "openai-codex",
			modelId: "gpt-5.3-codex-spark",
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
					pluginId: "@refarm/agent",
					fn: "respond",
					args: {
						prompt: "Summarize the open work",
						system: "system context",
						session_id: "urn:sovereign:session:v1:abc",
						history_turns: 20,
						provider: "openai-codex",
						model: "gpt-5.3-codex-spark",
					},
				},
			],
			source: "refarm-chat",
			submittedAt: "2026-05-18T19:00:00.000Z",
		});
	});

	it("routes by profile (ADR-012): passes args.profile and omits a pinned route", () => {
		const effort = createRuntimeAgentRespondEffort({
			prompt: "quick question",
			system: "",
			sessionId: "urn:sovereign:session:v1:xyz",
			source: "refarm-ask",
			historyTurns: 20,
			// A profile is sent INSTEAD of a pinned provider/model — the guest resolves.
			profile: "cheap",
			now: () => new Date("2026-05-18T19:00:00.000Z"),
			randomUUID: (() => {
				const ids = ["e", "t"];
				return () => ids.shift() ?? "x";
			})(),
		});

		const args = effort.tasks[0]!.args as Record<string, unknown>;
		expect(args.profile).toBe("cheap");
		// No pinned route, so the guest's profile resolver isn't shadowed by an override.
		expect(args.provider).toBeUndefined();
		expect(args.model).toBeUndefined();
	});

	it("an explicit pinned route and a profile can coexist in args (override wins guest-side)", () => {
		// The factory does not enforce precedence — that's the guest's job. It just
		// serializes whatever the caller passes; the ask command is what decides to send
		// one OR the other. This pins the serialization contract.
		const effort = createRuntimeAgentRespondEffort({
			prompt: "q",
			system: "",
			sessionId: "s",
			source: "refarm-ask",
			historyTurns: 1,
			modelProvider: "anthropic",
			modelId: "claude-sonnet-4-6",
			profile: "reliable",
		});
		const args = effort.tasks[0]!.args as Record<string, unknown>;
		expect(args.provider).toBe("anthropic");
		expect(args.profile).toBe("reliable");
	});
});
