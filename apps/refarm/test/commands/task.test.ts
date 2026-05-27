import type {
EffortLogEntry,
EffortResult,
EffortSummary,
} from "@refarm.dev/effort-contract-v1";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
TaskSessionCheckpoint,
TaskSessionRecorder,
} from "../../src/commands/task-session.js";
import {
	createTaskCommand,
	normalizeTaskArgs,
	resolveAdapter,
} from "../../src/commands/task.js";

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
			partial: 0,
			failed: 0,
			timedOut: 0,
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

	it("documents runtime task transports in help", () => {
		const taskCommand = createTaskCommand();
		let help = "";
		taskCommand.configureOutput({
			writeOut: (value) => {
				help += value;
			},
		});

		taskCommand.outputHelp();

		expect(help).toContain("Manage Refarm runtime task efforts");
		expect(help).toContain("refarm task run @refarm.dev/pi-agent respond");
		expect(help).toContain('{"prompt":"hello"}');
		expect(help).toContain("http transport submits directly");
		expect(help).toContain("refarm runtime status");
		expect(help).toContain("refarm runtime ensure --wait --next-command");
		expect(help).toContain("refarm doctor --next-action");
		expect(help).toContain("refarm doctor");
	});

	it("documents task run examples and transport behavior", () => {
		const taskCommand = createTaskCommand();
		const runCommand = taskCommand.commands.find(
			(command) => command.name() === "run",
		);
		let help = "";
		runCommand?.configureOutput({
			writeOut: (value) => {
				help += value;
			},
		});

		runCommand?.outputHelp();

		expect(help).toContain("refarm task run @refarm.dev/pi-agent respond");
		expect(help).toContain('{"query":"hello"}');
		expect(help).toContain("http transport submits directly");
		expect(help).toContain("refarm runtime ensure --wait --next-command");
	});

	it("normalizes legacy query args for pi-agent respond tasks", () => {
		expect(
			normalizeTaskArgs("@refarm.dev/pi-agent", "respond", { query: "hello" }),
		).toEqual({ query: "hello", prompt: "hello" });
		expect(
			normalizeTaskArgs("@refarm/pi-agent", "respond", { query: "hello" }),
		).toEqual({ query: "hello", prompt: "hello" });
		expect(
			normalizeTaskArgs("@refarm.dev/pi-agent", "respond", {
				query: "legacy",
				prompt: "canonical",
			}),
		).toEqual({ query: "legacy", prompt: "canonical" });
		expect(normalizeTaskArgs("other", "respond", { query: "hello" })).toEqual({
			query: "hello",
		});
	});

	it("dispatches effort and prints effortId", async () => {
		const adapter = createMockAdapter();
		const session = createMockSessionRecorder();
		const taskCommand = createTaskCommand(
			() => adapter as unknown as ReturnType<typeof resolveAdapter>,
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

	it("dispatches effort as JSON", async () => {
		const adapter = createMockAdapter();
		const session = createMockSessionRecorder();
		const taskCommand = createTaskCommand(
			() => adapter as unknown as ReturnType<typeof resolveAdapter>,
			session as unknown as TaskSessionRecorder,
		);
		const spy = vi.spyOn(console, "log").mockImplementation(() => {});

		await taskCommand.commands
			.find((command) => command.name() === "run")!
			.parseAsync(
				[
					"my-plugin",
					"process",
					"--direction",
					"Test effort",
					"--args",
					'{"value":1}',
					"--json",
				],
				{ from: "user" },
			);

		const payload = JSON.parse(String(spy.mock.calls[0]?.[0])) as {
			ok: boolean;
			command: string;
			operation: string;
			effortId: string;
			transport: string;
			plugin: string;
			fn: string;
			nextActions: string[];
			nextCommand: string;
			nextCommands: string[];
			effort: { direction: string; tasks: Array<{ args: unknown }> };
		};
		expect(payload).toEqual(
			expect.objectContaining({
				ok: true,
				command: "task",
				operation: "run",
				effortId: "effort-abc",
				transport: "file",
				plugin: "my-plugin",
				fn: "process",
				nextCommand: "refarm task status effort-abc --transport file --watch",
			}),
		);
		expect(payload.nextActions).toEqual(payload.nextCommands);
		expect(payload.nextCommands).toContain("refarm task status effort-abc --transport file");
		expect(payload.nextCommands).toContain("refarm task logs effort-abc --transport file");
		expect(payload.effort.direction).toBe("Test effort");
		expect(payload.effort.tasks[0]?.args).toEqual({ value: 1 });
		expect(session.rememberRun).toHaveBeenCalledWith(
			expect.objectContaining({ transport: "file" }),
		);
		spy.mockRestore();
	});

	it("dispatches pi-agent respond query args as prompt for compatibility", async () => {
		const adapter = createMockAdapter();
		const session = createMockSessionRecorder();
		const taskCommand = createTaskCommand(
			() => adapter as unknown as ReturnType<typeof resolveAdapter>,
			session as unknown as TaskSessionRecorder,
		);
		const spy = vi.spyOn(console, "log").mockImplementation(() => {});
		await taskCommand.commands
			.find((command) => command.name() === "run")!
			.parseAsync(
				["@refarm.dev/pi-agent", "respond", "--args", '{"query":"hello"}'],
				{ from: "user" },
			);

		expect(adapter.submit).toHaveBeenCalledWith(
			expect.objectContaining({
				tasks: [
					expect.objectContaining({
						args: { query: "hello", prompt: "hello" },
					}),
				],
			}),
		);
		spy.mockRestore();
	});

	it("prints error and sets exitCode when --args is invalid JSON", async () => {
		const adapter = createMockAdapter();
		const session = createMockSessionRecorder();
		const taskCommand = createTaskCommand(
			() => adapter as unknown as ReturnType<typeof resolveAdapter>,
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

	it("prints structured JSON when --args is invalid JSON", async () => {
		const adapter = createMockAdapter();
		const session = createMockSessionRecorder();
		const resolver = vi.fn(
			() => adapter as unknown as ReturnType<typeof resolveAdapter>,
		);
		const taskCommand = createTaskCommand(
			resolver,
			session as unknown as TaskSessionRecorder,
		);
		const spy = vi.spyOn(console, "log").mockImplementation(() => {});

		await taskCommand.commands
			.find((command) => command.name() === "run")!
			.parseAsync(["p", "f", "--args", "not-json", "--json"], {
				from: "user",
			});

		expect(JSON.parse(String(spy.mock.calls[0]?.[0]))).toEqual(
			expect.objectContaining({
				ok: false,
				command: "task",
				operation: "run",
				error: "invalid-task-args-json",
				message: "--args must be valid JSON.",
				plugin: "p",
				fn: "f",
				transport: "file",
				nextCommand: "refarm task run 'p' 'f' --args '{}' --transport file --json",
			}),
		);
		expect(resolver).not.toHaveBeenCalled();
		expect(adapter.submit).not.toHaveBeenCalled();
		expect(session.rememberRun).not.toHaveBeenCalled();
		expect(process.exitCode).toBe(1);
		spy.mockRestore();
	});

	it("rejects unknown transports before resolving adapters", async () => {
		const adapter = createMockAdapter();
		const session = createMockSessionRecorder();
		const resolver = vi.fn(
			() => adapter as unknown as ReturnType<typeof resolveAdapter>,
		);
		const taskCommand = createTaskCommand(
			resolver,
			session as unknown as TaskSessionRecorder,
		);
		const runCommand = taskCommand.commands.find(
			(command) => command.name() === "run",
		)!;
		runCommand.exitOverride((error) => {
			throw error;
		});

		await expect(
			runCommand.parseAsync(["p", "f", "--transport", "grpc"], { from: "user" }),
		).rejects.toThrow('Invalid task transport "grpc". Use: file, http');

		expect(resolver).not.toHaveBeenCalled();
		expect(adapter.submit).not.toHaveBeenCalled();
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
			() => adapter as unknown as ReturnType<typeof resolveAdapter>,
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

	it("documents task status watch and transport options", () => {
		const taskCommand = createTaskCommand();
		const statusCommand = taskCommand.commands.find(
			(command) => command.name() === "status",
		);
		let help = "";
		statusCommand?.configureOutput({
			writeOut: (value) => {
				help += value;
			},
		});

		statusCommand?.outputHelp();

		expect(help).toContain("refarm task status <effort-id> --watch");
		expect(help).toContain("Use the same transport used by task run");
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
			() => adapter as unknown as ReturnType<typeof resolveAdapter>,
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

	it("prints status not-found JSON with follow-up commands", async () => {
		const adapter = createMockAdapter({
			query: vi.fn().mockResolvedValue(null),
		});
		const session = createMockSessionRecorder();
		const taskCommand = createTaskCommand(
			() => adapter as unknown as ReturnType<typeof resolveAdapter>,
			session as unknown as TaskSessionRecorder,
		);
		const spy = vi.spyOn(console, "log").mockImplementation(() => {});

		await taskCommand.commands
			.find((command) => command.name() === "status")!
			.parseAsync(["effort-abc", "--json"], { from: "user" });

		const payload = JSON.parse(String(spy.mock.calls[0]?.[0])) as {
			ok: boolean;
			command: string;
			operation: string;
			status: string;
			nextActions: string[];
			nextCommand: string;
			nextCommands: string[];
		};
		expect(payload.ok).toBe(true);
		expect(payload.command).toBe("task");
		expect(payload.operation).toBe("status");
		expect(payload.status).toBe("not-found");
		expect(payload.nextCommand).toBe(
			"refarm task status effort-abc --transport file --watch",
		);
		expect(payload.nextCommands).toContain(
			"refarm task logs effort-abc --transport file",
		);
		expect(payload.nextActions).toEqual(payload.nextCommands);
		spy.mockRestore();
	});

	it("prints status adapter failures as JSON without stderr", async () => {
		const adapter = createMockAdapter({
			query: vi.fn().mockRejectedValue(new Error("HTTP 503")),
		});
		const session = createMockSessionRecorder();
		const taskCommand = createTaskCommand(
			() => adapter as unknown as ReturnType<typeof resolveAdapter>,
			session as unknown as TaskSessionRecorder,
		);
		const logs: string[] = [];
		const logSpy = vi.spyOn(console, "log").mockImplementation((value) => {
			logs.push(String(value));
		});
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		await taskCommand.commands
			.find((command) => command.name() === "status")!
			.parseAsync(["effort-abc", "--transport", "http", "--json"], {
				from: "user",
			});

		expect(errorSpy).not.toHaveBeenCalled();
		expect(JSON.parse(logs.join("\n"))).toMatchObject({
			ok: false,
			command: "task",
			operation: "status",
			error: "task-status-failed",
			message: "HTTP 503",
			effortId: "effort-abc",
			transport: "http",
			logsCommand: "refarm task logs effort-abc --transport http",
			nextAction: "refarm doctor --next-action",
			nextCommand: "refarm doctor --next-command",
			nextCommands: [
				"refarm doctor --next-command",
				"refarm runtime ensure --wait --next-command",
			],
		});
		expect(session.rememberStatus).not.toHaveBeenCalled();
		expect(process.exitCode).toBe(1);
		logSpy.mockRestore();
		errorSpy.mockRestore();
	});
});

describe("refarm task list/logs/retry/cancel", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		process.exitCode = undefined;
	});

	it("documents task list transport and continuation behavior", () => {
		const taskCommand = createTaskCommand();
		const listCommand = taskCommand.commands.find(
			(command) => command.name() === "list",
		);
		let help = "";
		listCommand?.configureOutput({
			writeOut: (value) => {
				help += value;
			},
		});

		listCommand?.outputHelp();

		expect(help).toContain("refarm task list --transport http --json");
		expect(help).toContain("JSON output includes status/log nextCommands");
		expect(help).toContain("Use resume to continue from the local checkpoint");
	});

	it("list prints summary and effort rows", async () => {
		const adapter = createMockAdapter({
			summary: vi.fn().mockResolvedValue({
				total: 1,
				pending: 1,
				inProgress: 0,
				done: 0,
				partial: 0,
				failed: 0,
				timedOut: 0,
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
			() => adapter as unknown as ReturnType<typeof resolveAdapter>,
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
			() => adapter as unknown as ReturnType<typeof resolveAdapter>,
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

	it("logs prints empty JSON with status follow-up", async () => {
		const adapter = createMockAdapter({
			logs: vi.fn().mockResolvedValue([]),
		});
		const session = createMockSessionRecorder();
		const taskCommand = createTaskCommand(
			() => adapter as unknown as ReturnType<typeof resolveAdapter>,
			session as unknown as TaskSessionRecorder,
		);
		const spy = vi.spyOn(console, "log").mockImplementation(() => {});

		await taskCommand.commands
			.find((command) => command.name() === "logs")!
			.parseAsync(["effort-abc", "--json"], { from: "user" });

		const payload = JSON.parse(String(spy.mock.calls[0]?.[0])) as {
			ok: boolean;
			command: string;
			operation: string;
			logs: EffortLogEntry[];
			nextCommand: string;
		};
		expect(payload.ok).toBe(true);
		expect(payload.command).toBe("task");
		expect(payload.operation).toBe("logs");
		expect(payload.logs).toEqual([]);
		expect(payload.nextCommand).toBe(
			"refarm task status effort-abc --transport file",
		);
		spy.mockRestore();
	});

	it("prints log adapter failures as JSON without stderr", async () => {
		const adapter = createMockAdapter({
			logs: vi.fn().mockRejectedValue(new Error("HTTP 503")),
		});
		const session = createMockSessionRecorder();
		const taskCommand = createTaskCommand(
			() => adapter as unknown as ReturnType<typeof resolveAdapter>,
			session as unknown as TaskSessionRecorder,
		);
		const logs: string[] = [];
		const logSpy = vi.spyOn(console, "log").mockImplementation((value) => {
			logs.push(String(value));
		});
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		await taskCommand.commands
			.find((command) => command.name() === "logs")!
			.parseAsync(["effort-abc", "--transport", "http", "--json"], {
				from: "user",
			});

		expect(errorSpy).not.toHaveBeenCalled();
		expect(JSON.parse(logs.join("\n"))).toMatchObject({
			ok: false,
			command: "task",
			operation: "logs",
			error: "task-logs-failed",
			message: "HTTP 503",
			effortId: "effort-abc",
			transport: "http",
			statusCommand: "refarm task status effort-abc --transport http",
			nextAction: "refarm task status effort-abc --transport http",
			nextCommand: "refarm task status effort-abc --transport http",
			nextCommands: [
				"refarm task status effort-abc --transport http",
				"refarm doctor --next-command",
			],
		});
		expect(session.rememberLogs).not.toHaveBeenCalled();
		expect(process.exitCode).toBe(1);
		logSpy.mockRestore();
		errorSpy.mockRestore();
	});

	it("rejects invalid log tail values before querying adapters", async () => {
		const adapter = createMockAdapter();
		const session = createMockSessionRecorder();
		const resolver = vi.fn(
			() => adapter as unknown as ReturnType<typeof resolveAdapter>,
		);
		const taskCommand = createTaskCommand(
			resolver,
			session as unknown as TaskSessionRecorder,
		);
		const logsCommand = taskCommand.commands.find(
			(command) => command.name() === "logs",
		)!;
		logsCommand.exitOverride((error) => {
			throw error;
		});

		await expect(
			logsCommand.parseAsync(["effort-abc", "--tail", "many"], { from: "user" }),
		).rejects.toThrow("--tail must be a positive integer.");

		expect(resolver).not.toHaveBeenCalled();
		expect(adapter.logs).not.toHaveBeenCalled();
	});

	it("retry sets exitCode when rejected", async () => {
		const adapter = createMockAdapter({
			retry: vi.fn().mockResolvedValue(false),
		});
		const session = createMockSessionRecorder();
		const taskCommand = createTaskCommand(
			() => adapter as unknown as ReturnType<typeof resolveAdapter>,
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

	it("retry prints accepted result as JSON", async () => {
		const adapter = createMockAdapter({
			retry: vi.fn().mockResolvedValue(true),
		});
		const session = createMockSessionRecorder();
		const taskCommand = createTaskCommand(
			() => adapter as unknown as ReturnType<typeof resolveAdapter>,
			session as unknown as TaskSessionRecorder,
		);
		const logs: string[] = [];
		const spy = vi.spyOn(console, "log").mockImplementation((value) => {
			logs.push(String(value));
		});

		await taskCommand.commands
			.find((command) => command.name() === "retry")!
			.parseAsync(["effort-abc", "--transport", "http", "--json"], {
				from: "user",
			});

		const payload = JSON.parse(logs.join("\n")) as {
			ok: boolean;
			command: string;
			operation: string;
			effortId: string;
			transport: string;
			action: string;
			accepted: boolean;
			nextAction: string;
			nextCommand: string;
		};
		expect(payload).toMatchObject({
			ok: true,
			command: "task",
			operation: "retry",
			effortId: "effort-abc",
			transport: "http",
			action: "retry",
			accepted: true,
			nextCommand: "refarm task status effort-abc --transport http --watch",
		});
		expect(payload.nextAction).toContain("--watch");
		expect(session.rememberControl).toHaveBeenCalledWith({
			effortId: "effort-abc",
			transport: "http",
			action: "retry",
		});
		spy.mockRestore();
	});

	it("retry prints rejected result as JSON without stderr", async () => {
		const adapter = createMockAdapter({
			retry: vi.fn().mockResolvedValue(false),
		});
		const session = createMockSessionRecorder();
		const taskCommand = createTaskCommand(
			() => adapter as unknown as ReturnType<typeof resolveAdapter>,
			session as unknown as TaskSessionRecorder,
		);
		const logs: string[] = [];
		const logSpy = vi.spyOn(console, "log").mockImplementation((value) => {
			logs.push(String(value));
		});
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		await taskCommand.commands
			.find((command) => command.name() === "retry")!
			.parseAsync(["effort-abc", "--json"], { from: "user" });

		expect(errorSpy).not.toHaveBeenCalled();
		const payload = JSON.parse(logs.join("\n")) as {
			ok: boolean;
			error: string;
			accepted: boolean;
			nextAction: string;
			nextCommand: string;
			nextCommands: string[];
		};
		expect(payload).toMatchObject({
			ok: false,
			error: "task-retry-rejected",
			accepted: false,
			nextAction: "refarm task status effort-abc --transport file",
			nextCommand: "refarm task status effort-abc --transport file",
		});
		expect(payload.nextCommands).toContain("refarm doctor --next-command");
		expect(session.rememberControl).not.toHaveBeenCalled();
		expect(process.exitCode).toBe(1);
		logSpy.mockRestore();
		errorSpy.mockRestore();
	});

	it("retry prints adapter failures as JSON without stderr", async () => {
		const adapter = createMockAdapter({
			retry: vi.fn().mockRejectedValue(new Error("HTTP 503")),
		});
		const session = createMockSessionRecorder();
		const taskCommand = createTaskCommand(
			() => adapter as unknown as ReturnType<typeof resolveAdapter>,
			session as unknown as TaskSessionRecorder,
		);
		const logs: string[] = [];
		const logSpy = vi.spyOn(console, "log").mockImplementation((value) => {
			logs.push(String(value));
		});
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		await taskCommand.commands
			.find((command) => command.name() === "retry")!
			.parseAsync(["effort-abc", "--transport", "http", "--json"], {
				from: "user",
			});

		expect(errorSpy).not.toHaveBeenCalled();
		expect(JSON.parse(logs.join("\n"))).toMatchObject({
			ok: false,
			command: "task",
			operation: "retry",
			error: "task-retry-failed",
			message: "HTTP 503",
			effortId: "effort-abc",
			transport: "http",
			action: "retry",
			accepted: false,
			nextAction: "refarm task status effort-abc --transport http",
			nextCommand: "refarm task status effort-abc --transport http",
			nextCommands: [
				"refarm task status effort-abc --transport http",
				"refarm doctor --next-command",
				"refarm runtime ensure --wait --next-command",
			],
		});
		expect(session.rememberControl).not.toHaveBeenCalled();
		expect(process.exitCode).toBe(1);
		logSpy.mockRestore();
		errorSpy.mockRestore();
	});

	it("cancel requests cancellation", async () => {
		const adapter = createMockAdapter({
			cancel: vi.fn().mockResolvedValue(true),
		});
		const session = createMockSessionRecorder();
		const taskCommand = createTaskCommand(
			() => adapter as unknown as ReturnType<typeof resolveAdapter>,
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

	it("cancel prints accepted result as JSON", async () => {
		const adapter = createMockAdapter({
			cancel: vi.fn().mockResolvedValue(true),
		});
		const session = createMockSessionRecorder();
		const taskCommand = createTaskCommand(
			() => adapter as unknown as ReturnType<typeof resolveAdapter>,
			session as unknown as TaskSessionRecorder,
		);
		const logs: string[] = [];
		const spy = vi.spyOn(console, "log").mockImplementation((value) => {
			logs.push(String(value));
		});

		await taskCommand.commands
			.find((command) => command.name() === "cancel")!
			.parseAsync(["effort-abc", "--transport", "http", "--json"], {
				from: "user",
			});

		const payload = JSON.parse(logs.join("\n")) as {
			ok: boolean;
			command: string;
			operation: string;
			effortId: string;
			transport: string;
			action: string;
			accepted: boolean;
			nextAction: string;
			nextCommand: string;
		};
		expect(payload).toMatchObject({
			ok: true,
			command: "task",
			operation: "cancel",
			effortId: "effort-abc",
			transport: "http",
			action: "cancel",
			accepted: true,
			nextAction: "refarm task status effort-abc --transport http",
			nextCommand: "refarm task status effort-abc --transport http",
		});
		expect(session.rememberControl).toHaveBeenCalledWith({
			effortId: "effort-abc",
			transport: "http",
			action: "cancel",
		});
		spy.mockRestore();
	});

	it("cancel prints rejected result as JSON without stderr", async () => {
		const adapter = createMockAdapter({
			cancel: vi.fn().mockResolvedValue(false),
		});
		const session = createMockSessionRecorder();
		const taskCommand = createTaskCommand(
			() => adapter as unknown as ReturnType<typeof resolveAdapter>,
			session as unknown as TaskSessionRecorder,
		);
		const logs: string[] = [];
		const logSpy = vi.spyOn(console, "log").mockImplementation((value) => {
			logs.push(String(value));
		});
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		await taskCommand.commands
			.find((command) => command.name() === "cancel")!
			.parseAsync(["effort-abc", "--json"], { from: "user" });

		expect(errorSpy).not.toHaveBeenCalled();
		const payload = JSON.parse(logs.join("\n")) as {
			ok: boolean;
			error: string;
			accepted: boolean;
			nextAction: string;
			nextCommand: string;
			nextCommands: string[];
		};
		expect(payload).toMatchObject({
			ok: false,
			error: "task-cancel-rejected",
			accepted: false,
			nextAction: "refarm task status effort-abc --transport file",
			nextCommand: "refarm task status effort-abc --transport file",
		});
		expect(payload.nextCommands).toContain("refarm doctor --next-command");
		expect(session.rememberControl).not.toHaveBeenCalled();
		expect(process.exitCode).toBe(1);
		logSpy.mockRestore();
		errorSpy.mockRestore();
	});

	it("cancel prints adapter failures as JSON without stderr", async () => {
		const adapter = createMockAdapter({
			cancel: vi.fn().mockRejectedValue(new Error("HTTP 503")),
		});
		const session = createMockSessionRecorder();
		const taskCommand = createTaskCommand(
			() => adapter as unknown as ReturnType<typeof resolveAdapter>,
			session as unknown as TaskSessionRecorder,
		);
		const logs: string[] = [];
		const logSpy = vi.spyOn(console, "log").mockImplementation((value) => {
			logs.push(String(value));
		});
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		await taskCommand.commands
			.find((command) => command.name() === "cancel")!
			.parseAsync(["effort-abc", "--transport", "http", "--json"], {
				from: "user",
			});

		expect(errorSpy).not.toHaveBeenCalled();
		expect(JSON.parse(logs.join("\n"))).toMatchObject({
			ok: false,
			command: "task",
			operation: "cancel",
			error: "task-cancel-failed",
			message: "HTTP 503",
			effortId: "effort-abc",
			transport: "http",
			action: "cancel",
			accepted: false,
			nextAction: "refarm task status effort-abc --transport http",
			nextCommand: "refarm task status effort-abc --transport http",
			nextCommands: [
				"refarm task status effort-abc --transport http",
				"refarm doctor --next-command",
				"refarm runtime ensure --wait --next-command",
			],
		});
		expect(session.rememberControl).not.toHaveBeenCalled();
		expect(process.exitCode).toBe(1);
		logSpy.mockRestore();
		errorSpy.mockRestore();
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
			() => adapter as unknown as ReturnType<typeof resolveAdapter>,
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
			() => adapter as unknown as ReturnType<typeof resolveAdapter>,
			session as unknown as TaskSessionRecorder,
		);
		const spy = vi.spyOn(console, "log").mockImplementation(() => {});

		await taskCommand.commands
			.find((command) => command.name() === "resume")!
			.parseAsync(["--json"], { from: "user" });

		expect(spy).toHaveBeenCalledWith(
			expect.stringContaining('"activeEffortId": "effort-abc"'),
		);
		expect(spy).toHaveBeenCalledWith(expect.stringContaining('"command": "task"'));
		expect(spy).toHaveBeenCalledWith(
			expect.stringContaining('"operation": "resume"'),
		);
		spy.mockRestore();
	});

	it("documents local checkpoint behavior", () => {
		const taskCommand = createTaskCommand();
		const resumeCommand = taskCommand.commands.find(
			(command) => command.name() === "resume",
		);
		let help = "";
		resumeCommand?.configureOutput({
			writeOut: (value) => {
				help += value;
			},
		});

		resumeCommand?.outputHelp();

		expect(help).toContain("refarm task resume --json");
		expect(help).toContain("It does not contact the runtime by itself");
	});
});
