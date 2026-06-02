import type {
	Effort,
	EffortLogEntry,
	EffortResult,
} from "@refarm.dev/effort-contract-v1";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	buildTaskEffortCommands,
	buildTaskLogsCommand,
	buildTaskStatusCommand,
	FileTaskSessionRecorder,
	formatTaskSessionModelRoute,
	taskSessionEffortCommands,
} from "../../src/commands/task-session.js";

const tempDirs: string[] = [];

function createTempDir(): string {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "refarm-task-session-"));
	tempDirs.push(dir);
	return dir;
}

afterEach(() => {
	for (const dir of tempDirs.splice(0, tempDirs.length)) {
		fs.rmSync(dir, { recursive: true, force: true });
	}
});

describe("task session commands", () => {
	it("builds stable task status and logs commands", () => {
		expect(buildTaskStatusCommand("effort-1", "http")).toBe(
			"refarm task status effort-1 --transport http",
		);
		expect(buildTaskStatusCommand("effort-1", "http", { watch: true })).toBe(
			"refarm task status effort-1 --transport http --watch",
		);
		expect(buildTaskStatusCommand("effort-1", "http", { json: true })).toBe(
			"refarm task status effort-1 --transport http --json",
		);
		expect(
			buildTaskStatusCommand("effort-1", "http", {
				json: true,
				watch: true,
			}),
		).toBe("refarm task status effort-1 --transport http --watch --json");
		expect(buildTaskLogsCommand("effort-1", "http")).toBe(
			"refarm task logs effort-1 --transport http",
		);
		expect(buildTaskLogsCommand("effort-1", "http", { json: true })).toBe(
			"refarm task logs effort-1 --transport http --json",
		);
		expect(buildTaskStatusCommand("effort with space", "file")).toBe(
			"refarm task status 'effort with space' --transport file",
		);
		expect(buildTaskLogsCommand("effort with ' quote", "file")).toBe(
			"refarm task logs 'effort with '\"'\"' quote' --transport file",
		);
	});

	it("builds per-effort status and logs command handoffs", () => {
		expect(
			buildTaskEffortCommands(
				[
					{ effortId: "effort-1" },
					{ effortId: "effort with space" },
				],
				"file",
			),
		).toEqual([
			{
				effortId: "effort-1",
				statusCommand: "refarm task status effort-1 --transport file",
				logsCommand: "refarm task logs effort-1 --transport file",
			},
			{
				effortId: "effort with space",
				statusCommand: "refarm task status 'effort with space' --transport file",
				logsCommand: "refarm task logs 'effort with space' --transport file",
			},
		]);
	});

	it("preserves recorded task session effort command handoffs", () => {
		expect(
			taskSessionEffortCommands([
				{
					effortId: "effort-1",
					statusCommand: "refarm task status effort-1 --transport file",
					logsCommand: "refarm task logs effort-1 --transport file",
					transport: "file",
				},
				{
					effortId: "effort-2",
					statusCommand: "refarm task status effort-2 --transport http",
					logsCommand: "refarm task logs effort-2 --transport http",
					transport: "http",
				},
			]),
		).toEqual([
			{
				effortId: "effort-1",
				statusCommand: "refarm task status effort-1 --transport file",
				logsCommand: "refarm task logs effort-1 --transport file",
			},
			{
				effortId: "effort-2",
				statusCommand: "refarm task status effort-2 --transport http",
				logsCommand: "refarm task logs effort-2 --transport http",
			},
		]);
	});

	it("derives JSON task session effort command handoffs", () => {
		expect(
			taskSessionEffortCommands(
				[
					{
						effortId: "effort-1",
						statusCommand: "refarm task status effort-1 --transport file",
						logsCommand: "refarm task logs effort-1 --transport file",
						transport: "file",
					},
				],
				{ json: true },
			),
		).toEqual([
			{
				effortId: "effort-1",
				statusCommand: "refarm task status effort-1 --transport file --json",
				logsCommand: "refarm task logs effort-1 --transport file --json",
			},
		]);
	});
});

describe("FileTaskSessionRecorder", () => {
	it("defers creating the sessions store until state is recorded", () => {
		const parentDir = createTempDir();
		const baseDir = path.join(parentDir, "missing-refarm-home");

		const recorder = new FileTaskSessionRecorder(baseDir);

		expect(recorder.getCheckpoint()).toBeNull();
		expect(fs.existsSync(path.join(baseDir, "sessions"))).toBe(false);
		recorder.rememberList({
			transport: "file",
			efforts: [{ effortId: "pending-1", status: "pending", results: [] }],
		});
		expect(fs.existsSync(path.join(baseDir, "sessions"))).toBe(true);
	});

	it("records dispatched efforts with resume links", () => {
		const baseDir = createTempDir();
		const recorder = new FileTaskSessionRecorder(baseDir);
		const effort: Effort = {
			id: "effort-1",
			direction: "Test",
			tasks: [{ id: "t1", pluginId: "p", fn: "f" }],
			source: "refarm-cli",
			submittedAt: new Date().toISOString(),
		};

		recorder.rememberRun({ effort, transport: "http" });
		const checkpoint = recorder.getCheckpoint();

		expect(checkpoint).not.toBeNull();
		expect(checkpoint!.activeEffortId).toBe("effort-1");
		expect(checkpoint!.efforts[0]!.statusCommand).toContain(
			"refarm task status effort-1 --transport http",
		);
		expect(checkpoint!.efforts[0]!.logsCommand).toContain(
			"refarm task logs effort-1 --transport http",
		);
	});

	it("clears active effort when terminal status is observed", () => {
		const baseDir = createTempDir();
		const recorder = new FileTaskSessionRecorder(baseDir);
		const effort: Effort = {
			id: "effort-2",
			direction: "Test",
			tasks: [{ id: "t1", pluginId: "p", fn: "f" }],
			source: "refarm-cli",
			submittedAt: new Date().toISOString(),
		};
		recorder.rememberRun({ effort, transport: "file" });

		const result: EffortResult = {
			effortId: "effort-2",
			status: "done",
			results: [],
			submittedAt: effort.submittedAt,
			completedAt: new Date().toISOString(),
		};
		recorder.rememberStatus({
			effortId: "effort-2",
			transport: "file",
			result,
		});

		const checkpoint = recorder.getCheckpoint();
		expect(checkpoint?.activeEffortId).toBeUndefined();
		expect(checkpoint?.efforts[0]!.lastStatus).toBe("done");
	});

	it("treats partial and timed-out efforts as terminal for resume", () => {
		for (const status of ["partial", "timed-out"] as const) {
			const baseDir = createTempDir();
			const recorder = new FileTaskSessionRecorder(baseDir);
			const effort: Effort = {
				id: `effort-${status}`,
				direction: "Test",
				tasks: [{ id: "t1", pluginId: "p", fn: "f" }],
				source: "refarm-cli",
				submittedAt: new Date().toISOString(),
			};
			recorder.rememberRun({ effort, transport: "file" });

			const result: EffortResult = {
				effortId: effort.id,
				status,
				results: [],
				submittedAt: effort.submittedAt,
			};
			recorder.rememberStatus({
				effortId: effort.id,
				transport: "file",
				result,
			});

			const checkpoint = recorder.getCheckpoint();
			expect(checkpoint?.activeEffortId).toBeUndefined();
			expect(checkpoint?.efforts[0]!.lastStatus).toBe(status);
		}
	});

	it("marks first non-terminal effort as active when listing", () => {
		const baseDir = createTempDir();
		const recorder = new FileTaskSessionRecorder(baseDir);
		recorder.rememberList({
			transport: "file",
			efforts: [
				{ effortId: "done-1", status: "done", results: [] },
				{ effortId: "pending-1", status: "pending", results: [] },
			],
		});

		const checkpoint = recorder.getCheckpoint();
		expect(checkpoint?.activeEffortId).toBe("pending-1");
	});

	it("remembers the latest model route observed in task logs", () => {
		const baseDir = createTempDir();
		const recorder = new FileTaskSessionRecorder(baseDir);
		const logs: EffortLogEntry[] = [
			{
				timestamp: "2026-05-27T12:00:00.000Z",
				level: "info",
				event: "processing_started",
				message: "started",
				effortId: "effort-model",
				meta: {
					modelScope: "default",
					modelProvider: "openai",
					modelId: "gpt-5.5",
				},
			},
			{
				timestamp: "2026-05-27T12:00:01.000Z",
				level: "info",
				event: "task_attempt_succeeded",
				message: "done",
				effortId: "effort-model",
				taskId: "task-1",
				meta: {
					modelScope: "worker",
					modelProvider: "openai",
					modelId: "gpt-5.3-codex-spark",
				},
			},
		];

		recorder.rememberLogs({
			effortId: "effort-model",
			transport: "file",
			logs,
		});

		const checkpoint = recorder.getCheckpoint();
		expect(checkpoint?.efforts[0]!.lastLogAt).toBe(logs[1]!.timestamp);
		expect(checkpoint?.efforts[0]!.lastModelRoute).toEqual({
			scope: "worker",
			provider: "openai",
			modelId: "gpt-5.3-codex-spark",
			ref: "openai/gpt-5.3-codex-spark",
		});
		expect(
			formatTaskSessionModelRoute(checkpoint?.efforts[0]!.lastModelRoute),
		).toBe("worker openai/gpt-5.3-codex-spark");
	});
});
