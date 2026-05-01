import type {
	EffortLogEntry,
	EffortResult,
	EffortSummary,
} from "@refarm.dev/effort-contract-v1";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTaskCommand } from "../../src/commands/task.js";
import type {
	TaskSessionCheckpoint,
	TaskSessionRecorder,
} from "../../src/commands/task-session.js";

interface MockTaskAdapter {
	submit: ReturnType<typeof vi.fn>;
	query: ReturnType<typeof vi.fn>;
	list: ReturnType<typeof vi.fn>;
	logs: ReturnType<typeof vi.fn>;
	retry: ReturnType<typeof vi.fn>;
	cancel: ReturnType<typeof vi.fn>;
	summary: ReturnType<typeof vi.fn>;
}

interface MockTaskSessionRecorder {
	rememberRun: ReturnType<typeof vi.fn>;
	rememberStatus: ReturnType<typeof vi.fn>;
	rememberList: ReturnType<typeof vi.fn>;
	rememberLogs: ReturnType<typeof vi.fn>;
	rememberControl: ReturnType<typeof vi.fn>;
	getCheckpoint: ReturnType<typeof vi.fn>;
}

function createMockAdapter(overrides: Partial<MockTaskAdapter> = {}) {
	const defaults: MockTaskAdapter = {
		submit: vi.fn().mockResolvedValue("effort-abc"),
		query: vi.fn().mockResolvedValue(null),
		list: vi.fn().mockResolvedValue([]),
		logs: vi.fn().mockResolvedValue([]),
		retry: vi.fn().mockResolvedValue(true),
		cancel: vi.fn().mockResolvedValue(true),
		summary: vi.fn().mockResolvedValue({
			total: 0,
			pending: 0,
			inProgress: 0,
			done: 0,
			failed: 0,
			cancelled: 0,
		} satisfies EffortSummary),
	};

	return {
		...defaults,
		...overrides,
	};
}

function createMockSessionRecorder(
	overrides: Partial<MockTaskSessionRecorder> = {},
): MockTaskSessionRecorder {
	const defaults: MockTaskSessionRecorder = {
		rememberRun: vi.fn(),
		rememberStatus: vi.fn(),
		rememberList: vi.fn(),
		rememberLogs: vi.fn(),
		rememberControl: vi.fn(),
		getCheckpoint: vi
			.fn()
			.mockReturnValue(null as TaskSessionCheckpoint | null),
	};

	return {
		...defaults,
		...overrides,
	};
}

describe("refarm task run", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		process.exitCode = undefined;
	});

	it("dispatches effort and prints effortId", async () => {
		const adapter = createMockAdapter();
		const session = createMockSessionRecorder();
		const taskCommand = createTaskCommand(
			() => adapter as any,
			session as unknown as TaskSessionRecorder,
		);
		const spy = vi.spyOn(console, "log").mockImplementation(() => {});
		await taskCommand.commands
			.find((command) => command.name() === "run")!
			.parseAsync(["my-plugin", "process", "--direction", "Test effort"], {
				from: "user",
			});

		expect(adapter.submit).toHaveBeenCalledWith(
			expect.objectContaining({
				direction: "Test effort",
				source: "refarm-cli",
			}),
		);
		expect(session.rememberRun).toHaveBeenCalledWith(
			expect.objectContaining({ transport: "file" }),
		);
		expect(spy).toHaveBeenCalledWith(expect.stringContaining("effort-abc"));
		spy.mockRestore();
	});

	it("prints error and sets exitCode when --args is invalid JSON", async () => {
		const adapter = createMockAdapter();
		const session = createMockSessionRecorder();
		const taskCommand = createTaskCommand(
			() => adapter as any,
			session as unknown as TaskSessionRecorder,
		);
		const spy = vi.spyOn(console, "error").mockImplementation(() => {});
		await taskCommand.commands
			.find((command) => command.name() === "run")!
			.parseAsync(["p", "f", "--args", "not-json"], { from: "user" });

		expect(spy).toHaveBeenCalledWith(expect.stringContaining("valid JSON"));
		expect(adapter.submit).not.toHaveBeenCalled();
		expect(session.rememberRun).not.toHaveBeenCalled();
		expect(process.exitCode).toBe(1);
		spy.mockRestore();
	});
});

describe("refarm task status", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		process.exitCode = undefined;
	});

	it("prints 'No result yet' when query returns null", async () => {
		const adapter = createMockAdapter({
			query: vi.fn().mockResolvedValue(null),
		});
		const session = createMockSessionRecorder();
		const taskCommand = createTaskCommand(
			() => adapter as any,
			session as unknown as TaskSessionRecorder,
		);
		const spy = vi.spyOn(console, "log").mockImplementation(() => {});
		await taskCommand.commands
			.find((command) => command.name() === "status")!
			.parseAsync(["effort-abc"], { from: "user" });

		expect(session.rememberStatus).toHaveBeenCalledWith({
			effortId: "effort-abc",
			transport: "file",
			result: null,
		});
		expect(spy).toHaveBeenCalledWith(expect.stringContaining("No result yet"));
		spy.mockRestore();
	});

	it("prints status and task results when found", async () => {
		const result: EffortResult = {
			effortId: "effort-abc",
			status: "done",
			results: [
				{
					taskId: "t1",
					effortId: "effort-abc",
					status: "ok",
					attempts: 1,
					completedAt: new Date().toISOString(),
				},
			],
			attemptCount: 1,
			submittedAt: new Date(Date.now() - 1000).toISOString(),
			completedAt: new Date().toISOString(),
		};
		const adapter = createMockAdapter({
			query: vi.fn().mockResolvedValue(result),
		});

		const session = createMockSessionRecorder();
		const taskCommand = createTaskCommand(
			() => adapter as any,
			session as unknown as TaskSessionRecorder,
		);
		const spy = vi.spyOn(console, "log").mockImplementation(() => {});
		await taskCommand.commands
			.find((command) => command.name() === "status")!
			.parseAsync(["effort-abc"], { from: "user" });

		expect(session.rememberStatus).toHaveBeenCalledWith({
			effortId: "effort-abc",
			transport: "file",
			result,
		});
		expect(spy).toHaveBeenCalledWith(expect.stringContaining("done"));
		expect(spy).toHaveBeenCalledWith(expect.stringContaining("t1"));
		spy.mockRestore();
	});
});

describe("refarm task list/logs/retry/cancel", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		process.exitCode = undefined;
	});

	it("list prints summary and effort rows", async () => {
		const adapter = createMockAdapter({
			summary: vi.fn().mockResolvedValue({
				total: 1,
				pending: 1,
				inProgress: 0,
				done: 0,
				failed: 0,
				cancelled: 0,
			} satisfies EffortSummary),
			list: vi.fn().mockResolvedValue([
				{
					effortId: "effort-abc",
					status: "pending",
					results: [],
					submittedAt: new Date().toISOString(),
				} satisfies EffortResult,
			]),
		});

		const session = createMockSessionRecorder();
		const taskCommand = createTaskCommand(
			() => adapter as any,
			session as unknown as TaskSessionRecorder,
		);
		const spy = vi.spyOn(console, "log").mockImplementation(() => {});
		await taskCommand.commands
			.find((command) => command.name() === "list")!
			.parseAsync([], { from: "user" });

		expect(adapter.summary).toHaveBeenCalled();
		expect(adapter.list).toHaveBeenCalled();
		expect(session.rememberList).toHaveBeenCalledWith(
			expect.objectContaining({ transport: "file" }),
		);
		expect(spy).toHaveBeenCalledWith(
			expect.stringContaining("Efforts: total=1"),
		);
		expect(spy).toHaveBeenCalledWith(expect.stringContaining("effort-abc"));
		spy.mockRestore();
	});

	it("logs prints entries", async () => {
		const logs: EffortLogEntry[] = [
			{
				effortId: "effort-abc",
				timestamp: new Date().toISOString(),
				level: "info",
				event: "submitted",
				message: "Effort submitted",
			},
		];
		const adapter = createMockAdapter({
			logs: vi.fn().mockResolvedValue(logs),
		});
		const session = createMockSessionRecorder();
		const taskCommand = createTaskCommand(
			() => adapter as any,
			session as unknown as TaskSessionRecorder,
		);
		const spy = vi.spyOn(console, "log").mockImplementation(() => {});
		await taskCommand.commands
			.find((command) => command.name() === "logs")!
			.parseAsync(["effort-abc"], { from: "user" });

		expect(adapter.logs).toHaveBeenCalledWith("effort-abc");
		expect(session.rememberLogs).toHaveBeenCalledWith({
			effortId: "effort-abc",
			transport: "file",
			logs,
		});
		expect(spy).toHaveBeenCalledWith(expect.stringContaining("submitted"));
		spy.mockRestore();
	});

	it("retry sets exitCode when rejected", async () => {
		const adapter = createMockAdapter({
			retry: vi.fn().mockResolvedValue(false),
		});
		const session = createMockSessionRecorder();
		const taskCommand = createTaskCommand(
			() => adapter as any,
			session as unknown as TaskSessionRecorder,
		);
		const spy = vi.spyOn(console, "error").mockImplementation(() => {});
		await taskCommand.commands
			.find((command) => command.name() === "retry")!
			.parseAsync(["effort-abc"], { from: "user" });

		expect(session.rememberControl).not.toHaveBeenCalled();
		expect(process.exitCode).toBe(1);
		expect(spy).toHaveBeenCalledWith(expect.stringContaining("Retry rejected"));
		spy.mockRestore();
	});

	it("cancel requests cancellation", async () => {
		const adapter = createMockAdapter({
			cancel: vi.fn().mockResolvedValue(true),
		});
		const session = createMockSessionRecorder();
		const taskCommand = createTaskCommand(
			() => adapter as any,
			session as unknown as TaskSessionRecorder,
		);
		const spy = vi.spyOn(console, "log").mockImplementation(() => {});
		await taskCommand.commands
			.find((command) => command.name() === "cancel")!
			.parseAsync(["effort-abc"], { from: "user" });

		expect(adapter.cancel).toHaveBeenCalledWith("effort-abc");
		expect(session.rememberControl).toHaveBeenCalledWith({
			effortId: "effort-abc",
			transport: "file",
			action: "cancel",
		});
		expect(spy).toHaveBeenCalledWith(
			expect.stringContaining("Cancel requested"),
		);
		spy.mockRestore();
	});
});

describe("refarm task resume", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		process.exitCode = undefined;
	});

	it("prints empty hint when no checkpoint exists", async () => {
		const adapter = createMockAdapter();
		const session = createMockSessionRecorder({
			getCheckpoint: vi.fn().mockReturnValue(null),
		});
		const taskCommand = createTaskCommand(
			() => adapter as any,
			session as unknown as TaskSessionRecorder,
		);
		const spy = vi.spyOn(console, "log").mockImplementation(() => {});

		await taskCommand.commands
			.find((command) => command.name() === "resume")!
			.parseAsync([], { from: "user" });

		expect(spy).toHaveBeenCalledWith(
			expect.stringContaining("No task session checkpoint yet."),
		);
		spy.mockRestore();
	});

	it("prints checkpoint payload in json mode", async () => {
		const adapter = createMockAdapter();
		const checkpoint: TaskSessionCheckpoint = {
			version: 1,
			updatedAt: new Date().toISOString(),
			activeEffortId: "effort-abc",
			efforts: [
				{
					effortId: "effort-abc",
					transport: "http",
					lastStatus: "in-progress",
					statusCommand: "refarm task status effort-abc --transport http",
					logsCommand: "refarm task logs effort-abc --transport http",
				},
			],
		};
		const session = createMockSessionRecorder({
			getCheckpoint: vi.fn().mockReturnValue(checkpoint),
		});
		const taskCommand = createTaskCommand(
			() => adapter as any,
			session as unknown as TaskSessionRecorder,
		);
		const spy = vi.spyOn(console, "log").mockImplementation(() => {});

		await taskCommand.commands
			.find((command) => command.name() === "resume")!
			.parseAsync(["--json"], { from: "user" });

		expect(spy).toHaveBeenCalledWith(
			expect.stringContaining('"activeEffortId": "effort-abc"'),
		);
		spy.mockRestore();
	});
});
