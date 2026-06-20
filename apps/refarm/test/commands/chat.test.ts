import { describe, expect, it, vi } from "vitest";
import {
	buildChatOperatorResumeHint,
	buildChatSessionResumeHint,
	createChatEffort,
	resolveChatRuntimeModelRoute,
	resolveRuntimeStreamsDir,
	resolveRuntimeTaskResultsDir,
} from "../../src/commands/chat.js";
import type { ModelCommandDeps } from "../../src/commands/model.js";
import { buildCurrentModelStatus } from "../../src/commands/model.js";

describe("chat runtime helpers", () => {
	it("resolves stream and task-result directories from environment overrides", () => {
		expect(
			resolveRuntimeStreamsDir({ REFARM_STREAMS_DIR: "/tmp/refarm-streams" }),
		).toBe("/tmp/refarm-streams");
		expect(
			resolveRuntimeTaskResultsDir({
				REFARM_TASK_RESULTS_DIR: "/tmp/refarm-results",
			}),
		).toBe("/tmp/refarm-results");
	});

	it("resolves chat runtime model route from current model status", () => {
		const modelStatus = buildCurrentModelStatus({
			modelProvider: "openai-codex",
			modelId: "gpt-5.3-codex-spark",
		});

		expect(resolveChatRuntimeModelRoute(modelStatus)).toEqual({
			modelProvider: "openai-codex",
			modelId: "gpt-5.3-codex-spark",
		});
	});

	it("creates runtime effort with selected chat model route", async () => {
		const modelDeps: ModelCommandDeps = {
			loadTokens: vi.fn().mockResolvedValue({
				modelProvider: "openai-codex",
				modelId: "gpt-5.3-codex-spark",
			}),
			saveTokens: vi.fn(),
		};

		const effort = await createChatEffort(
			"teste ok",
			"urn:refarm:session:v1:test",
			modelDeps,
			{
				system: "test system prompt",
				historyTurns: 20,
			},
		);

		expect(effort.tasks[0]!.args).toMatchObject({
			prompt: "teste ok",
			session_id: "urn:refarm:session:v1:test",
			provider: "openai-codex",
			model: "gpt-5.3-codex-spark",
			history_turns: 20,
		});
	});

	it("provides exit resume hints", () => {
		const sessionId = "urn:refarm:session:v1:test-session";
		expect(buildChatSessionResumeHint(sessionId)).toBe(
			`To continue this session, run: refarm session --session ${sessionId}`,
		);
		expect(buildChatOperatorResumeHint()).toBe(
			"To inspect next operator action, run: refarm resume --next-action",
		);
	});
});
