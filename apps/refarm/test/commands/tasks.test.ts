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
		expect(help).toContain("refarm runtime ensure --wait --next-command");
		expect(help).toContain("refarm doctor --next-action");
		expect(help).toContain("refarm doctor");
		expect(help).toContain("Use refarm task for dispatch/retry/cancel operations");
	});

	it("lists tasks from the sidecar with filters", async () => {
		const fetchMock = vi.fn().mockResolvedValue(
			jsonResponse({
				tasks: [
					{
						"@id": "urn:sovereign:task:v1:abc123def456",
						"@type": "Task",
						title: "@refarm/agent.respond",
						status: "done",
						context_id: "urn:sovereign:session:v1:s1",
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
				"urn:sovereign:session:v1:s1",
				"--limit",
				"2",
			],
			{ from: "user" },
		);

		expect(fetchMock).toHaveBeenCalledWith(
			"http://127.0.0.1:42001/tasks?status=done&session_id=urn%3Asovereign%3Asession%3Av1%3As1&limit=2",
			expect.objectContaining({
				signal: expect.any(Object),
			}),
		);
		const output = logSpy.mock.calls.map((call) => String(call[0])).join("\n");
		expect(output).toContain("Tasks");
		expect(output).toContain("@refarm/agent.respond");
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

	it("prints empty state when the node says the record IS empty", async () => {
		// `truncated: false` is the node stating a measurement: nothing was left out, so the
		// zero rows are the whole answer. Only here is "No tasks yet" a true sentence.
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(
				jsonResponse({ tasks: [], stored: 0, truncated: false, offset: 0 }),
			),
		);
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		const command = createTasksCommand();
		await command.parseAsync([], { from: "user" });

		expect(logSpy).toHaveBeenCalledWith(
			expect.stringContaining("No tasks yet"),
		);
	});

	it("does NOT claim the record is empty when the node did not say so", async () => {
		// This fixture is not hypothetical — it is the exact body any sidecar built before
		// ISS-041 returns, and it was what this suite asserted "No tasks yet" against until the
		// endpoint learned to report. Zero rows plus no completeness is "nothing was found in
		// what I could see", which is a different fact from "there are none" and must not be
		// printed as one (the collapse ISS-045 and budget.ts were both fixed for).
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ tasks: [] })));
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		const command = createTasksCommand();
		await command.parseAsync([], { from: "user" });

		const printed = logSpy.mock.calls.map((call) => String(call[0])).join("\n");
		expect(printed).toContain("did not report how many exist");
		expect(printed).not.toContain("No tasks yet");
	});

	it("names the offset that reaches the rest when a page was cut", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(
				jsonResponse({
					tasks: [{ "@id": "urn:sovereign:task:v1:a", "@type": "Task", status: "done" }],
					stored: 9,
					truncated: true,
					offset: 4,
				}),
			),
		);
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		const command = createTasksCommand();
		await command.parseAsync(["--limit", "1", "--offset", "4"], { from: "user" });

		const printed = logSpy.mock.calls.map((call) => String(call[0])).join("\n");
		expect(printed).toContain("of 9 stored");
		// The remedy must be a command the operator can run, with the number to run it with —
		// the older wording said the rows were unreachable, which stopped being true the moment
		// `GET /nodes` and `GET /tasks` learned `offset` (ISS-042).
		expect(printed).toContain("--offset 5");
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

	it("prints runtime errors as JSON when task listing cannot reach the runtime", async () => {
		vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		const command = createTasksCommand();
		await command.parseAsync(["--json"], { from: "user" });

		expect(errorSpy).not.toHaveBeenCalled();
		expect(JSON.parse(String(logSpy.mock.calls[0]?.[0]))).toMatchObject({
			command: "tasks",
			operation: "list",
			ok: false,
			error: "runtime-unavailable",
			nextAction: "refarm runtime ensure --wait --next-command",
			nextCommand: "refarm runtime ensure --wait --next-command",
			nextCommands: [
				"refarm runtime ensure --wait --next-command",
				"refarm runtime start --wait",
				"refarm doctor --next-command",
			],
			recommendations: [
				expect.objectContaining({
					diagnostic: "runtime:unavailable",
					command: "refarm runtime ensure --wait --next-command",
				}),
			],
		});
		expect(process.exitCode).toBe(1);
	});

	it("prints task lists as machine-readable JSON", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(
				jsonResponse({
					tasks: [
						{
							"@id": "urn:sovereign:task:v1:abc123def456",
							"@type": "Task",
							title: "@refarm/agent.respond",
							status: "done",
						},
					],
					stored: 1,
					truncated: false,
					offset: 0,
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
			// ISS-077. The single mocked fetch answers `/efforts` with the same task page, which is
			// not an array — so `liveEffortIds` is NULL: the daemon could not be asked. That is the
			// distinction the field exists for, and `abandoned` must stay silent under it, because
			// treating "could not ask" as "owns nothing" would condemn every running task.
			liveEffortIds: null,
			abandoned: null,
			schemaVersion: 1,
			command: "tasks",
			operation: "list",
			ok: true,
			nextAction: null,
			nextActions: [],
			nextCommand:
				"refarm tasks show 'urn:sovereign:task:v1:abc123def456' --json",
			nextCommands: [
				"refarm tasks show 'urn:sovereign:task:v1:abc123def456' --json",
				"refarm tasks --json",
			],
			filters: {
				status: "done",
				session_id: "session-1",
				limit: 2,
				offset: 0,
			},
			tasks: [
				{
					"@id": "urn:sovereign:task:v1:abc123def456",
					"@type": "Task",
					title: "@refarm/agent.respond",
					status: "done",
				},
			],
			// The page facts, and the VERDICT beside them. A consumer reading `tasks` to decide
			// "that is all of them" needs to know which of three states produced the list; before
			// ISS-041 this envelope carried `total`, which was the page size dressed as a count.
			stored: 1,
			truncated: false,
			offset: 0,
			completeness: "complete",
		});
	});

	it("shows task details and events", async () => {
		const fetchMock = vi.fn().mockResolvedValue(
			jsonResponse({
				task: {
					"@id": "urn:sovereign:task:v1:abc123def456",
					"@type": "Task",
					title: "@refarm/agent.respond",
					status: "failed",
					context_id: "urn:sovereign:session:v1:s1",
					created_at_ns: Date.now() * 1_000_000,
				},
				events: [
					{
						"@id": "urn:sovereign:task-event:v1:e1",
						task_id: "urn:sovereign:task:v1:abc123def456",
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
			expect.objectContaining({
				signal: expect.any(Object),
			}),
		);
		const output = logSpy.mock.calls.map((call) => String(call[0])).join("\n");
		expect(output).toContain("Task");
		expect(output).toContain("@refarm/agent.respond");
		expect(output).toContain("urn:sovereign:session:v1:s1");
		expect(output).toContain("status_changed");
		expect(output).toContain("mock-model");
	});

	it("prints task details as machine-readable JSON", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(
				jsonResponse({
					task: {
						"@id": "urn:sovereign:task:v1:abc123def456",
						"@type": "Task",
						title: "@refarm/agent.respond",
						status: "active",
					},
					events: [
						{
							"@id": "urn:sovereign:task-event:v1:e1",
							task_id: "urn:sovereign:task:v1:abc123def456",
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
			ok: true,
			nextAction: null,
			nextActions: [],
			nextCommand: "refarm tasks --json",
			nextCommands: ["refarm tasks --json"],
			prefix: "abc123",
			task: {
				"@id": "urn:sovereign:task:v1:abc123def456",
				"@type": "Task",
				title: "@refarm/agent.respond",
				status: "active",
			},
			events: [
				{
					"@id": "urn:sovereign:task-event:v1:e1",
					task_id: "urn:sovereign:task:v1:abc123def456",
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
							"urn:sovereign:task:v1:aaa111",
							"urn:sovereign:task:v1:aaa222",
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
			expect.stringContaining("urn:sovereign:task:v1:aaa111"),
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
							"urn:sovereign:task:v1:aaa111",
							"urn:sovereign:task:v1:aaa222",
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
				"urn:sovereign:task:v1:aaa111",
				"urn:sovereign:task:v1:aaa222",
			],
			nextAction: "refarm tasks --json",
			nextActions: ["refarm tasks --json"],
			nextCommand: "refarm tasks --json",
			nextCommands: ["refarm tasks --json"],
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

	it("prints task detail endpoint failures as JSON with recovery commands", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(
				jsonResponse({ error: "task storage unavailable" }, 500),
			),
		);
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		const command = createTasksCommand();
		await command.commands
			.find((child) => child.name() === "show")!
			.parseAsync(["abc123", "--json"], { from: "user" });

		expect(errorSpy).not.toHaveBeenCalled();
		expect(JSON.parse(String(logSpy.mock.calls[0]?.[0]))).toMatchObject({
			schemaVersion: 1,
			command: "tasks",
			operation: "show",
			ok: false,
			error: "task-show-failed",
			message: "task storage unavailable",
			prefix: "abc123",
			nextAction: "refarm doctor --next-action",
			nextActions: [
				"refarm doctor --next-action",
				"refarm runtime status",
			],
			nextCommand: "refarm doctor --next-command",
			nextCommands: [
				"refarm doctor --next-command",
				"refarm runtime ensure --wait --next-command",
			],
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

	it("prints runtime errors as JSON when task details cannot reach the runtime", async () => {
		vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		const command = createTasksCommand();
		await command.commands
			.find((child) => child.name() === "show")!
			.parseAsync(["abc123", "--json"], { from: "user" });

		expect(errorSpy).not.toHaveBeenCalled();
		expect(JSON.parse(String(logSpy.mock.calls[0]?.[0]))).toMatchObject({
			command: "tasks",
			operation: "show",
			ok: false,
			error: "runtime-unavailable",
			nextAction: "refarm runtime ensure --wait --next-command",
		});
		expect(process.exitCode).toBe(1);
	});
});
