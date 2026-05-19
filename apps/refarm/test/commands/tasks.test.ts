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
		const exitSpy = vi
			.spyOn(process, "exit")
			.mockImplementation(((code?: string | number | null | undefined) => {
				throw new Error(`exit:${code ?? 0}`);
			}) as never);

		const command = createTasksCommand();
		await expect(
			command.commands
				.find((child) => child.name() === "show")!
				.parseAsync(["aaa"], { from: "user" }),
		).rejects.toThrow("exit:1");

		expect(errorSpy).toHaveBeenCalledWith(
			expect.stringContaining("Ambiguous prefix"),
		);
		expect(errorSpy).toHaveBeenCalledWith(
			expect.stringContaining("urn:refarm:task:v1:aaa111"),
		);
		expect(exitSpy).toHaveBeenCalledWith(1);
	});
});
