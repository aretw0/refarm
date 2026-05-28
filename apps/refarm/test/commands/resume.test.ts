import type { RefarmStatusJson } from "@refarm.dev/cli/status";
import { describe, expect, it, vi } from "vitest";
import type { AgentFinishSessionRecorder } from "../../src/commands/agent-finish-session.js";
import { createResumeCommand } from "../../src/commands/resume.js";
import type {
TaskSessionCheckpoint,
TaskSessionRecorder,
} from "../../src/commands/task-session.js";

const status: RefarmStatusJson = {
	schemaVersion: 1,
	host: { app: "apps/refarm", command: "refarm", profile: "dev", mode: "headless" },
	renderer: { id: "refarm-headless", kind: "headless", capabilities: [] },
	runtime: {
		ready: true,
		namespace: "refarm-main",
		databaseName: "refarm-main",
	},
	plugins: { installed: 0, active: 0, rejectedSurfaces: 0, surfaceActions: 0 },
	trust: { profile: "strict", warnings: 0, critical: 0 },
	streams: { active: 0, terminal: 0 },
	diagnostics: [],
};

function recorder(checkpoint: TaskSessionCheckpoint | null): TaskSessionRecorder {
	return {
		rememberRun: vi.fn(),
		rememberStatus: vi.fn(),
		rememberList: vi.fn(),
		rememberLogs: vi.fn(),
		rememberControl: vi.fn(),
		getCheckpoint: vi.fn().mockReturnValue(checkpoint),
	};
}

function finishRecorder(
	latest: ReturnType<AgentFinishSessionRecorder["getLatest"]>,
): AgentFinishSessionRecorder {
	return {
		rememberRun: vi.fn(),
		getCheckpoint: vi.fn().mockReturnValue(
			latest
				? {
						version: 1,
						latest,
					}
				: null,
		),
		getLatest: vi.fn().mockReturnValue(latest),
	};
}

describe("resume command", () => {
	it("prints the operator resume view", async () => {
		const checkpoint: TaskSessionCheckpoint = {
			version: 1,
			updatedAt: "2026-05-27T12:00:00.000Z",
			activeEffortId: "effort-1",
			efforts: [
				{
					effortId: "effort-1",
					transport: "http",
					lastStatus: "in-progress",
					statusCommand: "refarm task status effort-1 --transport http",
					logsCommand: "refarm task logs effort-1 --transport http",
				},
			],
		};
		const command = createResumeCommand({
			resolveStatusPayload: vi.fn().mockResolvedValue({ json: status }),
			sessionRecorder: recorder(checkpoint),
			finishRecorder: finishRecorder({
				updatedAt: "2026-05-27T12:05:00.000Z",
				status: "failed",
				command: "refarm agent finish --run --json",
				profile: "quick",
				lane: null,
				validationScope: "quick",
				failedStepId: "health",
				failedCommand: "refarm health --next-action --json",
				nextCommands: ["refarm runtime start --wait"],
				remainingCommands: [],
			}),
			readActiveSessionId: vi.fn().mockReturnValue(
				"urn:refarm:session:v1:abcdef1234567890",
			),
			loadModelTokens: vi.fn().mockResolvedValue({
				modelProvider: "openai",
				modelId: "gpt-5.5",
			}),
			loadRecentSessions: vi.fn().mockResolvedValue([
				{
					sessionId: "urn:refarm:session:v1:abcdef1234567890",
					shortId: "ef1234567890",
					name: "planning",
					hasHistory: true,
					showCommand: "refarm sessions show ef1234567890 --json",
					useCommand: "refarm sessions use ef1234567890 --json",
				},
			]),
			loadChatHistory: vi.fn().mockReturnValue(["ship it"]),
		});
		const spy = vi.spyOn(console, "log").mockImplementation(() => {});

		await command.parseAsync([], { from: "user" });

		expect(spy).toHaveBeenCalledWith(expect.stringContaining("Operator resume"));
		expect(spy).toHaveBeenCalledWith(expect.stringContaining("Model: default openai/gpt-5.5"));
		expect(spy).toHaveBeenCalledWith(
			expect.stringContaining("refarm task status effort-1 --transport http --watch"),
		);
		expect(spy).toHaveBeenCalledWith(
			expect.stringContaining("refarm tree show ef1234567890 --json"),
		);
		expect(spy).toHaveBeenCalledWith(expect.stringContaining("ship it"));
		expect(spy).toHaveBeenCalledWith(expect.stringContaining("Recent sessions:"));
		expect(spy).toHaveBeenCalledWith(expect.stringContaining("name=planning"));
		expect(spy).toHaveBeenCalledWith(expect.stringContaining("Finish: failed"));
		expect(spy).toHaveBeenCalledWith(
			expect.stringContaining("refarm runtime start --wait"),
		);
		spy.mockRestore();
	});

	it("prints JSON handoff output", async () => {
		const command = createResumeCommand({
			resolveStatusPayload: vi.fn().mockResolvedValue({ json: status }),
			sessionRecorder: recorder(null),
			finishRecorder: finishRecorder(null),
			readActiveSessionId: vi.fn().mockReturnValue(null),
			loadModelTokens: vi.fn().mockResolvedValue({
				modelProvider: "openai",
				modelId: "gpt-5.5",
			}),
			loadRecentSessions: vi.fn().mockResolvedValue([]),
			loadChatHistory: vi.fn().mockReturnValue([]),
		});
		const spy = vi.spyOn(console, "log").mockImplementation(() => {});

		await command.parseAsync(["--json"], { from: "user" });

		expect(spy).toHaveBeenCalledWith(expect.stringContaining('"command": "resume"'));
		expect(spy).toHaveBeenCalledWith(
			expect.stringContaining('"nextCommand": "refarm model current --json"'),
		);
		expect(spy).toHaveBeenCalledWith(expect.stringContaining('"model": {'));
		spy.mockRestore();
	});

	it("can skip runtime status inspection", async () => {
		const resolveStatusPayload = vi.fn().mockResolvedValue({ json: status });
		const loadRecentSessions = vi.fn().mockResolvedValue([]);
		const command = createResumeCommand({
			resolveStatusPayload,
			sessionRecorder: recorder(null),
			finishRecorder: finishRecorder(null),
			readActiveSessionId: vi.fn().mockReturnValue(null),
			loadModelTokens: vi.fn().mockResolvedValue({}),
			loadRecentSessions,
			loadChatHistory: vi.fn().mockReturnValue([]),
		});
		const spy = vi.spyOn(console, "log").mockImplementation(() => {});

		await command.parseAsync(["--no-status"], { from: "user" });

		expect(resolveStatusPayload).not.toHaveBeenCalled();
		expect(loadRecentSessions).not.toHaveBeenCalled();
		expect(spy).toHaveBeenCalledWith(expect.stringContaining("Runtime: not inspected"));
		spy.mockRestore();
	});
});
