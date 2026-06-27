import type { RefarmStatusJson } from "@refarm.dev/cli/status";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { AgentFinishSessionRecorder } from "../../src/commands/agent-finish-session.js";
import {
	createResumeCommand,
	loadProjectHandoff,
} from "../../src/commands/resume.js";
import type {
	TaskSessionCheckpoint,
	TaskSessionRecorder,
} from "../../src/commands/task-session.js";

const status: RefarmStatusJson = {
	schemaVersion: 1,
	host: {
		app: "apps/refarm",
		command: "refarm",
		profile: "dev",
		mode: "headless",
	},
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

function recorder(
	checkpoint: TaskSessionCheckpoint | null,
): TaskSessionRecorder {
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
	it("loads repository project handoff context for resume", () => {
		const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "refarm-resume-"));
		try {
			fs.mkdirSync(path.join(tempDir, ".project"));
			fs.writeFileSync(
				path.join(tempDir, ".project", "handoff.json"),
				JSON.stringify({
					context: "resume from project state",
					timestamp: "2026-06-27T05:00:00.000Z",
					current_phase: 12,
					current_tasks: ["current A", "current B"],
					blockers: ["blocked A"],
					next_actions: ["next A"],
					open_questions: ["question A"],
				}),
				"utf-8",
			);

			expect(loadProjectHandoff(tempDir)).toEqual({
				path: ".project/handoff.json",
				timestamp: "2026-06-27T05:00:00.000Z",
				currentPhase: 12,
				context: "resume from project state",
				currentTasks: ["current A", "current B"],
				blockers: ["blocked A"],
				nextActions: ["next A"],
				openQuestions: ["question A"],
			});
		} finally {
			fs.rmSync(tempDir, { recursive: true, force: true });
		}
	});

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
			readActiveSessionId: vi
				.fn()
				.mockReturnValue("urn:refarm:session:v1:abcdef1234567890"),
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

		expect(spy).toHaveBeenCalledWith(
			expect.stringContaining("Operator resume"),
		);
		expect(spy).toHaveBeenCalledWith(
			expect.stringContaining("Model: default openai/gpt-5.5"),
		);
		expect(spy).toHaveBeenCalledWith(
			expect.stringContaining(
				"refarm task status effort-1 --transport http --watch",
			),
		);
		expect(spy).toHaveBeenCalledWith(
			expect.stringContaining("refarm sessions show ef1234567890 --json"),
		);
		expect(spy).toHaveBeenCalledWith(expect.stringContaining("ship it"));
		expect(spy).toHaveBeenCalledWith(
			expect.stringContaining("Recent sessions:"),
		);
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

		expect(spy).toHaveBeenCalledWith(
			expect.stringContaining('"command": "resume"'),
		);
		expect(spy).toHaveBeenCalledWith(
			expect.stringContaining('"nextCommand": "refarm model current --json"'),
		);
		expect(spy).toHaveBeenCalledWith(expect.stringContaining('"model": {'));
		expect(spy).toHaveBeenCalledWith(
			expect.stringContaining('"doctorCommand": "refarm model doctor --json"'),
		);
		spy.mockRestore();
	});

	it("prints project handoff context in JSON resume output", async () => {
		const command = createResumeCommand({
			resolveStatusPayload: vi.fn().mockResolvedValue({ json: status }),
			sessionRecorder: recorder(null),
			finishRecorder: finishRecorder(null),
			readActiveSessionId: vi.fn().mockReturnValue(null),
			loadModelTokens: vi.fn().mockResolvedValue({
				modelProvider: "ollama",
				modelId: "llama3.2",
			}),
			loadRecentSessions: vi.fn().mockResolvedValue([]),
			loadChatHistory: vi.fn().mockReturnValue([]),
			loadProjectHandoff: vi.fn().mockReturnValue({
				path: ".project/handoff.json",
				timestamp: "2026-06-27T05:00:00.000Z",
				currentPhase: 12,
				context: "resume from project handoff",
				currentTasks: ["finish current slice"],
				blockers: [],
				nextActions: ["pick next slice"],
				openQuestions: [],
			}),
		});
		const logs: string[] = [];
		const spy = vi.spyOn(console, "log").mockImplementation((value) => {
			logs.push(String(value));
		});

		await command.parseAsync(["--json"], { from: "user" });

		const payload = JSON.parse(logs.join("\n")) as {
			project?: {
				path: string;
				currentTasks: string[];
				nextActions: string[];
			};
		};
		expect(payload.project).toMatchObject({
			path: ".project/handoff.json",
			currentTasks: ["finish current slice"],
			nextActions: ["pick next slice"],
		});
		spy.mockRestore();
	});

	it("prioritizes stale session cleanup in plain resume output", async () => {
		const command = createResumeCommand({
			resolveStatusPayload: vi.fn().mockResolvedValue({ json: status }),
			sessionRecorder: recorder(null),
			finishRecorder: finishRecorder(null),
			readActiveSessionId: vi.fn().mockReturnValue("urn:refarm:session:v1:stale987654"),
			loadModelTokens: vi.fn().mockResolvedValue({
				modelProvider: "openai",
				modelId: "gpt-5.5",
			}),
			loadRecentSessions: vi.fn().mockResolvedValue([
				{
					sessionId: "urn:refarm:session:v1:other123456",
					shortId: "other123",
					name: "other",
					hasHistory: true,
					showCommand: "refarm sessions show other123 --json",
					useCommand: "refarm sessions use other123 --json",
				},
			]),
			loadChatHistory: vi.fn().mockReturnValue(["ship it"]),
		});
		const spy = vi.spyOn(console, "log").mockImplementation(() => {});

		await command.parseAsync([], { from: "user" });

		const output = spy.mock.calls.map((call) => String(call[0])).join("\n");
		expect(output).toContain("Session: stale");
		expect(output).toContain("show: unavailable; clear or inspect sessions list");
		expect(output).toContain("Next commands:");
		const clearIndex = output.indexOf("refarm sessions clear --json");
		const listIndex = output.indexOf("refarm sessions list --json");
		expect(clearIndex).toBeGreaterThan(-1);
		expect(listIndex).toBeGreaterThan(clearIndex);
		spy.mockRestore();
	});

	it("prioritizes stale session cleanup in JSON resume handoff", async () => {
		const command = createResumeCommand({
			resolveStatusPayload: vi.fn().mockResolvedValue({ json: status }),
			sessionRecorder: recorder(null),
			finishRecorder: finishRecorder(null),
			readActiveSessionId: vi.fn().mockReturnValue("urn:refarm:session:v1:stale987654"),
			loadModelTokens: vi.fn().mockResolvedValue({
				modelProvider: "openai",
				modelId: "gpt-5.5",
			}),
			loadRecentSessions: vi.fn().mockResolvedValue([
				{
					sessionId: "urn:refarm:session:v1:other123456",
					shortId: "other123",
					name: "other",
					hasHistory: true,
					showCommand: "refarm sessions show other123 --json",
					useCommand: "refarm sessions use other123 --json",
				},
			]),
			loadChatHistory: vi.fn().mockReturnValue(["ship it"]),
		});
		const logs: string[] = [];
		const spy = vi.spyOn(console, "log").mockImplementation((value) => {
			logs.push(String(value));
		});

		await command.parseAsync(["--json"], { from: "user" });

		const payload = JSON.parse(logs.join("\n")) as {
			session: { status: "active" | "stale" | "none" };
			nextCommands?: string[];
		};
		expect(payload.session.status).toBe("stale");
		expect(payload.nextCommands?.[0]).toBe("refarm sessions clear --json");
		expect(payload.nextCommands).toContain("refarm sessions list --json");
		spy.mockRestore();
	});

	it("prints only the next command in plain text", async () => {
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

		await command.parseAsync(["--next-action"], { from: "user" });

		expect(spy).toHaveBeenCalledTimes(1);
		expect(spy).toHaveBeenCalledWith("refarm model current --json");
		spy.mockRestore();
	});

	it("prints only the next command in JSON format", async () => {
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
		const logs: string[] = [];
		const spy = vi.spyOn(console, "log").mockImplementation((value) => {
			logs.push(String(value));
		});

		await command.parseAsync(["--next-command", "--json"], { from: "user" });

		const payload = JSON.parse(logs.join("\n")) as {
			command: string;
			nextCommand?: string | null;
			nextAction?: string | null;
			nextActions?: string[];
			nextCommands?: string[];
			nextProcesses?: Array<{
				command: string;
				args: string[];
				display: string;
			}>;
		};
		expect(payload.command).toBe("resume");
		expect(payload.nextCommand).toBe("refarm model current --json");
		expect(payload.nextActions).toContain("refarm model current --json");
		expect(payload.nextCommands?.[0]).toBe("refarm model current --json");
		expect(payload.nextAction).toBe("refarm model current --json");
		expect(Array.isArray(payload.nextProcesses)).toBe(true);
		expect(
			(payload.nextProcesses ?? []).some(
				(process) =>
					process.command === "refarm" &&
					process.args.join(" ") === "model current --json" &&
					process.display === "refarm model current --json",
			),
		).toBe(true);
		spy.mockRestore();
	});

	it("prints task checkpoint command fields as JSON handoffs", async () => {
		const command = createResumeCommand({
			resolveStatusPayload: vi.fn().mockResolvedValue({ json: status }),
			sessionRecorder: recorder({
				version: 1,
				updatedAt: "2026-05-27T12:00:00.000Z",
				activeEffortId: "effort-1",
				efforts: [
					{
						effortId: "effort-1",
						transport: "file",
						lastStatus: "in-progress",
						statusCommand: "refarm task status effort-1 --transport file",
						logsCommand: "refarm task logs effort-1 --transport file",
					},
				],
			}),
			finishRecorder: finishRecorder(null),
			readActiveSessionId: vi.fn().mockReturnValue(null),
			loadModelTokens: vi.fn().mockResolvedValue({
				modelProvider: "openai",
				modelId: "gpt-5.5",
			}),
			loadRecentSessions: vi.fn().mockResolvedValue([]),
			loadChatHistory: vi.fn().mockReturnValue([]),
		});
		const logs: string[] = [];
		const spy = vi.spyOn(console, "log").mockImplementation((value) => {
			logs.push(String(value));
		});

		await command.parseAsync(["--json"], { from: "user" });

		const payload = JSON.parse(logs.join("\n")) as {
			tasks: {
				activeEffort?: { statusCommand: string; logsCommand: string };
				recentEfforts: Array<{ statusCommand: string; logsCommand: string }>;
			};
		};
		expect(payload.tasks.activeEffort).toMatchObject({
			statusCommand: "refarm task status effort-1 --transport file --json",
			logsCommand: "refarm task logs effort-1 --transport file --json",
		});
		expect(payload.tasks.recentEfforts[0]).toMatchObject({
			statusCommand: "refarm task status effort-1 --transport file --json",
			logsCommand: "refarm task logs effort-1 --transport file --json",
		});
		spy.mockRestore();
	});

	it("recovers interrupted non-terminal task checkpoints through task resume", async () => {
		const command = createResumeCommand({
			resolveStatusPayload: vi.fn().mockResolvedValue({ json: status }),
			sessionRecorder: recorder({
				version: 1,
				updatedAt: "2026-05-27T12:00:00.000Z",
				efforts: [
					{
						effortId: "effort-pending",
						transport: "http",
						lastStatus: "pending",
						statusCommand: "refarm task status effort-pending --transport http",
						logsCommand: "refarm task logs effort-pending --transport http",
					},
				],
			}),
			finishRecorder: finishRecorder(null),
			readActiveSessionId: vi.fn().mockReturnValue(null),
			loadModelTokens: vi.fn().mockResolvedValue({
				modelProvider: "openai-codex",
				modelId: "gpt-5.3-codex-spark",
				oauthProvider: "openai-codex",
				oauthCredentials: { "openai-codex": { access: "token" } },
			}),
			loadRecentSessions: vi.fn().mockResolvedValue([]),
			loadChatHistory: vi.fn().mockReturnValue([]),
		});
		const logs: string[] = [];
		const spy = vi.spyOn(console, "log").mockImplementation((value) => {
			logs.push(String(value));
		});

		await command.parseAsync(["--json"], { from: "user" });

		const payload = JSON.parse(logs.join("\n")) as {
			nextCommand?: string | null;
			nextCommands?: string[];
			tasks: {
				activeEffort?: { effortId: string };
				recentEfforts: Array<{
					effortId: string;
					statusCommand: string;
					logsCommand: string;
				}>;
			};
		};
		expect(payload.tasks.activeEffort).toBeUndefined();
		expect(payload.tasks.recentEfforts[0]).toMatchObject({
			effortId: "effort-pending",
			statusCommand: "refarm task status effort-pending --transport http --json",
			logsCommand: "refarm task logs effort-pending --transport http --json",
		});
		expect(payload.nextCommand).toBe("refarm task resume --json");
		expect(payload.nextCommands).toEqual(["refarm task resume --json"]);
		spy.mockRestore();
	});

	it("surfaces failedCommand and remaining count in operator output", async () => {
		const command = createResumeCommand({
			resolveStatusPayload: vi.fn().mockResolvedValue({ json: status }),
			sessionRecorder: recorder(null),
			finishRecorder: finishRecorder({
				updatedAt: "2026-05-27T12:05:00.000Z",
				status: "failed",
				command: "refarm agent finish --run --json",
				profile: "quick",
				lane: null,
				validationScope: "quick",
				failedStepId: "health",
				failedCommand: "refarm health --next-action --json",
				nextCommands: ["refarm runtime ensure --wait --next-command"],
				remainingCommands: ["refarm check --next-action --json"],
			}),
			readActiveSessionId: vi.fn().mockReturnValue(null),
			loadModelTokens: vi.fn().mockResolvedValue({}),
			loadRecentSessions: vi.fn().mockResolvedValue([]),
			loadChatHistory: vi.fn().mockReturnValue([]),
		});
		const spy = vi.spyOn(console, "log").mockImplementation(() => {});

		await command.parseAsync([], { from: "user" });

		const output = spy.mock.calls.map((call) => String(call[0])).join("\n");
		expect(output).toContain("failedStep: health");
		expect(output).toContain(
			"failedCommand: refarm health --next-action --json",
		);
		expect(output).toContain("remaining: 1 command");
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
		expect(spy).toHaveBeenCalledWith(
			expect.stringContaining("Runtime: not inspected"),
		);
		spy.mockRestore();
	});
});
