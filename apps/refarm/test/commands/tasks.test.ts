import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTasksCommand } from "../../src/commands/tasks.js";

function jsonResponse(body: unknown, status = 200) {
	return {
		ok: status >= 200 && status < 300,
		status,
		json: async () => body,
	};
}

describe("refarm tasks", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		process.exitCode = undefined;
	});

	afterEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
		process.exitCode = undefined;
	});

	it("documents task inspection and task command handoff in help", () => {
		let help = "";
		const command = createTasksCommand();
		command.configureOutput({
			writeOut: (value) => {
				help += value;
			},
		});
		command.outputHelp();

		expect(help).toContain("refarm tasks --status active");
		expect(help).toContain("refarm tasks show <task-id-prefix>");
		expect(help).toContain("refarm tasks show <task-id-prefix> --json");
		expect(help).toContain("refarm runtime status");
		expect(help).toContain("refarm runtime start --wait");
		expect(help).toContain("refarm doctor --next-action");
		expect(help).toContain("refarm doctor");
		expect(help).toContain("Use refarm task for dispatch/retry/cancel operations");
	});

	it("lists tasks from the sidecar with filters", async () => {
		const fetchMock = vi.fn().mockResolvedValue(
			jsonResponse({
				tasks: [
					{
						"@id": "urn:refarm:task:v1:abc123def456",
						"@type": "Task",
						title: "@refarm/pi-agent.respond",
						status: "done",
						context_id: "urn:refarm:session:v1:s1",
						created_at_ns: Date.now() * 1_000_000,
					},
				],
			}),
		);
		vi.stubGlobal("fetch", fetchMock);
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		const command = createTasksCommand();
		await command.parseAsync(
			[
				"--status",
				"done",
				"--session",
				"urn:refarm:session:v1:s1",
				"--limit",
				"2",
			],
			{ from: "user" },
		);

		expect(fetchMock).toHaveBeenCalledWith(
			"http://127.0.0.1:42001/tasks?status=done&session_id=urn%3Arefarm%3Asession%3Av1%3As1&limit=2",
		);
		const output = logSpy.mock.calls.map((call) => String(call[0])).join("\n");
		expect(output).toContain("Tasks");
		expect(output).toContain("@refarm/pi-agent.respond");
		expect(output).toContain("abc123def456");
	});

	it("rejects invalid limits before calling the sidecar", async () => {
		const fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);
		const command = createTasksCommand();
		command.exitOverride((error) => {
			throw error;
		});

		await expect(
			command.parseAsync(["--limit", "many"], { from: "user" }),
		).rejects.toThrow("--limit must be a positive integer.");
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("prints empty state when no tasks exist", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(jsonResponse({ tasks: [] })),
		);
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		const command = createTasksCommand();
		await command.parseAsync([], { from: "user" });

		expect(logSpy).toHaveBeenCalledWith(
			expect.stringContaining("No tasks yet"),
		);
	});

	it("sets exitCode when task listing cannot reach the runtime", async () => {
		vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		const command = createTasksCommand();
		await command.parseAsync([], { from: "user" });

		const output = errorSpy.mock.calls.map((call) => String(call[0])).join("\n");
		expect(output).toContain("Refarm runtime is not running");
		expect(process.exitCode).toBe(1);
	});

	it("prints task lists as machine-readable JSON", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(
				jsonResponse({
					tasks: [
						{
							"@id": "urn:refarm:task:v1:abc123def456",
							"@type": "Task",
							title: "@refarm/pi-agent.respond",
							status: "done",
						},
					],
				}),
			),
		);
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		const command = createTasksCommand();
		await command.parseAsync(
			["--json", "--status", "done", "--session", "session-1", "--limit", "2"],
			{ from: "user" },
		);

		const output = JSON.parse(String(logSpy.mock.calls[0]?.[0]));
		expect(output).toEqual({
			schemaVersion: 1,
			command: "tasks",
			operation: "list",
			filters: {
				status: "done",
				session_id: "session-1",
				limit: 2,
			},
			tasks: [
				{
					"@id": "urn:refarm:task:v1:abc123def456",
					"@type": "Task",
					title: "@refarm/pi-agent.respond",
					status: "done",
				},
			],
		});
	});

	it("shows task details and events", async () => {
		const fetchMock = vi.fn().mockResolvedValue(
			jsonResponse({
				task: {
					"@id": "urn:refarm:task:v1:abc123def456",
					"@type": "Task",
					title: "@refarm/pi-agent.respond",
					status: "failed",
					context_id: "urn:refarm:session:v1:s1",
					created_at_ns: Date.now() * 1_000_000,
				},
				events: [
					{
						"@id": "urn:refarm:task-event:v1:e1",
						task_id: "urn:refarm:task:v1:abc123def456",
						event: "status_changed",
						actor: "tester",
						timestamp_ns: Date.now() * 1_000_000,
						payload: {
							status: "failed",
							model: "mock-model",
							tokens_in: 7,
							tokens_out: 11,
						},
					},
				],
			}),
		);
		vi.stubGlobal("fetch", fetchMock);
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		const command = createTasksCommand();
		await command.commands
			.find((child) => child.name() === "show")!
			.parseAsync(["abc123"], { from: "user" });

		expect(fetchMock).toHaveBeenCalledWith(
			"http://127.0.0.1:42001/tasks/abc123",
		);
		const output = logSpy.mock.calls.map((call) => String(call[0])).join("\n");
		expect(output).toContain("Task");
		expect(output).toContain("@refarm/pi-agent.respond");
		expect(output).toContain("urn:refarm:session:v1:s1");
		expect(output).toContain("status_changed");
		expect(output).toContain("mock-model");
	});

	it("prints task details as machine-readable JSON", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(
				jsonResponse({
					task: {
						"@id": "urn:refarm:task:v1:abc123def456",
						"@type": "Task",
						title: "@refarm/pi-agent.respond",
						status: "active",
					},
					events: [
						{
							"@id": "urn:refarm:task-event:v1:e1",
							task_id: "urn:refarm:task:v1:abc123def456",
							event: "status_changed",
						},
					],
				}),
			),
		);
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		const command = createTasksCommand();
		await command.commands
			.find((child) => child.name() === "show")!
			.parseAsync(["abc123", "--json"], { from: "user" });

		const output = JSON.parse(String(logSpy.mock.calls[0]?.[0]));
		expect(output).toEqual({
			schemaVersion: 1,
			command: "tasks",
			operation: "show",
			prefix: "abc123",
			task: {
				"@id": "urn:refarm:task:v1:abc123def456",
				"@type": "Task",
				title: "@refarm/pi-agent.respond",
				status: "active",
			},
			events: [
				{
					"@id": "urn:refarm:task-event:v1:e1",
					task_id: "urn:refarm:task:v1:abc123def456",
					event: "status_changed",
				},
			],
		});
	});

	it("fails closed for ambiguous task prefixes", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(
				jsonResponse(
					{
						error: "ambiguous task prefix",
						matches: [
							"urn:refarm:task:v1:aaa111",
							"urn:refarm:task:v1:aaa222",
						],
					},
					409,
				),
			),
		);
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		const command = createTasksCommand();
		await command.commands
			.find((child) => child.name() === "show")!
			.parseAsync(["aaa"], { from: "user" });

		expect(errorSpy).toHaveBeenCalledWith(
			expect.stringContaining("Ambiguous prefix"),
		);
		expect(errorSpy).toHaveBeenCalledWith(
			expect.stringContaining("urn:refarm:task:v1:aaa111"),
		);
		expect(process.exitCode).toBe(1);
	});

	it("prints ambiguous task prefixes as JSON", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(
				jsonResponse(
					{
						error: "ambiguous task prefix",
						matches: [
							"urn:refarm:task:v1:aaa111",
							"urn:refarm:task:v1:aaa222",
						],
					},
					409,
				),
			),
		);
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		const command = createTasksCommand();
		await command.commands
			.find((child) => child.name() === "show")!
			.parseAsync(["aaa", "--json"], { from: "user" });

		expect(errorSpy).not.toHaveBeenCalled();
		expect(JSON.parse(String(logSpy.mock.calls[0]?.[0]))).toEqual({
			schemaVersion: 1,
			command: "tasks",
			operation: "show",
			ok: false,
			error: "ambiguous-task-prefix",
			message: "ambiguous task prefix",
			prefix: "aaa",
			matches: [
				"urn:refarm:task:v1:aaa111",
				"urn:refarm:task:v1:aaa222",
			],
			nextAction: "refarm tasks --json",
			nextActions: ["refarm tasks --json"],
		});
		expect(process.exitCode).toBe(1);
	});

	it("prints missing task prefixes as JSON", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(jsonResponse({ error: "missing" }, 404)),
		);
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		const command = createTasksCommand();
		await command.commands
			.find((child) => child.name() === "show")!
			.parseAsync(["missing", "--json"], { from: "user" });

		expect(errorSpy).not.toHaveBeenCalled();
		expect(JSON.parse(String(logSpy.mock.calls[0]?.[0]))).toMatchObject({
			schemaVersion: 1,
			command: "tasks",
			operation: "show",
			ok: false,
			error: "task-not-found",
			prefix: "missing",
			nextAction: "refarm tasks --json",
		});
		expect(process.exitCode).toBe(1);
	});

	it("sets exitCode when task details cannot reach the runtime", async () => {
		vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		const command = createTasksCommand();
		await command.commands
			.find((child) => child.name() === "show")!
			.parseAsync(["abc123"], { from: "user" });

		const output = errorSpy.mock.calls.map((call) => String(call[0])).join("\n");
		expect(output).toContain("Refarm runtime is not running");
		expect(process.exitCode).toBe(1);
	});
});
