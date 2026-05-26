import fs from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSessionsCommand } from "../../src/commands/sessions.js";

describe("refarm sessions", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		process.exitCode = undefined;
	});

	afterEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
		process.exitCode = undefined;
	});

	it("documents the common session workflows in help", () => {
		let help = "";
		const command = createSessionsCommand();
		command.configureOutput({
			writeOut: (value) => {
				help += value;
			},
		});
		command.outputHelp();

		expect(help).toContain("refarm sessions new --name planning");
		expect(help).toContain("refarm sessions fork <id-prefix> --name experiment");
		expect(help).toContain("refarm sessions fork <id-prefix> --name experiment --json");
		expect(help).toContain("refarm runtime status");
		expect(help).toContain("refarm runtime ensure --wait --next-command");
		expect(help).toContain("refarm doctor --next-action");
		expect(help).toContain("refarm doctor --next-command");
		expect(help).toContain("refarm doctor");
		expect(help).toContain("Use refarm ask --new");
	});

	it("sessions new creates session via sidecar and switches active session", async () => {
		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			status: 200,
			json: async () => ({
				session: {
					"@id": "urn:refarm:session:v1:abc123def456",
					"@type": "Session",
					name: "auth-refactor",
				},
			}),
		});
		vi.stubGlobal("fetch", fetchMock);

		const mkdirSpy = vi
			.spyOn(fs, "mkdirSync")
			.mockImplementation(() => undefined as string | undefined);
		const writeSpy = vi
			.spyOn(fs, "writeFileSync")
			.mockImplementation(() => undefined);
		vi.spyOn(fs, "readFileSync").mockReturnValue(
			"urn:refarm:session:v1:abc123def456",
		);
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		const command = createSessionsCommand();
		await command.commands
			.find((c) => c.name() === "new")!
			.parseAsync(["--name", "auth-refactor"], { from: "user" });

		expect(fetchMock).toHaveBeenCalledWith(
			"http://127.0.0.1:42001/sessions",
			expect.objectContaining({ method: "POST" }),
		);
		const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
		expect(init.body).toBe(JSON.stringify({ name: "auth-refactor" }));
		expect(mkdirSpy).toHaveBeenCalled();
		expect(writeSpy).toHaveBeenCalledWith(
			expect.stringContaining(".refarm/session.lock"),
			"urn:refarm:session:v1:abc123def456",
			"utf-8",
		);
		expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("Created session"));
	});

	it("sessions new prints created session as JSON", async () => {
		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			status: 200,
			json: async () => ({
				session: {
					"@id": "urn:refarm:session:v1:abc123def456",
					"@type": "Session",
					name: "auth-refactor",
				},
			}),
		});
		vi.stubGlobal("fetch", fetchMock);
		vi.spyOn(fs, "mkdirSync").mockImplementation(() => undefined as string | undefined);
		vi.spyOn(fs, "writeFileSync").mockImplementation(() => undefined);
		vi.spyOn(fs, "readFileSync").mockReturnValue(
			"urn:refarm:session:v1:abc123def456",
		);
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await createSessionsCommand()
			.commands
			.find((c) => c.name() === "new")!
			.parseAsync(["--name", "auth-refactor", "--json"], { from: "user" });

		expect(JSON.parse(String(logSpy.mock.calls[0]?.[0]))).toEqual({
			command: "sessions",
			operation: "new",
			action: "created",
			activeSessionId: "urn:refarm:session:v1:abc123def456",
			session: {
				"@id": "urn:refarm:session:v1:abc123def456",
				"@type": "Session",
				name: "auth-refactor",
			},
			ok: true,
			nextAction: null,
			nextActions: [],
			nextCommand:
				"refarm sessions show 'urn:refarm:session:v1:abc123def456' --json",
			nextCommands: [
				"refarm sessions show 'urn:refarm:session:v1:abc123def456' --json",
				"refarm sessions list --json",
			],
		});
	});

	it("lists sessions as JSON from the default command", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({
				ok: true,
				status: 200,
				json: async () => ({
					sessions: [
						{
							"@id": "urn:refarm:session:v1:older",
							"@type": "Session",
							name: "older",
							created_at_ns: 1,
						},
						{
							"@id": "urn:refarm:session:v1:newer",
							"@type": "Session",
							name: "newer",
							created_at_ns: 2,
						},
					],
				}),
			}),
		);
		vi.spyOn(fs, "readFileSync").mockReturnValue("urn:refarm:session:v1:newer");
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await createSessionsCommand().parseAsync(["--json"], { from: "user" });

		expect(JSON.parse(String(logSpy.mock.calls[0]?.[0]))).toEqual({
			command: "sessions",
			operation: "list",
			activeSessionId: "urn:refarm:session:v1:newer",
			sessions: [
				{
					"@id": "urn:refarm:session:v1:newer",
					"@type": "Session",
					name: "newer",
					created_at_ns: 2,
				},
				{
					"@id": "urn:refarm:session:v1:older",
					"@type": "Session",
					name: "older",
					created_at_ns: 1,
				},
			],
			ok: true,
			nextAction: null,
			nextActions: [],
			nextCommand:
				"refarm sessions show 'urn:refarm:session:v1:newer' --json",
			nextCommands: [
				"refarm sessions show 'urn:refarm:session:v1:newer' --json",
				"refarm sessions use 'urn:refarm:session:v1:newer' --json",
			],
		});
	});

	it("lists sessions as JSON from the list subcommand", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({
				ok: true,
				status: 200,
				json: async () => ({
					sessions: [
						{
							"@id": "urn:refarm:session:v1:abc123def456",
							"@type": "Session",
							name: "planning",
							created_at_ns: 1,
						},
					],
				}),
			}),
		);
		vi.spyOn(fs, "readFileSync").mockReturnValue(
			"urn:refarm:session:v1:abc123def456",
		);
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await createSessionsCommand()
			.commands
			.find((c) => c.name() === "list")!
			.parseAsync(["--json"], { from: "user" });

		expect(JSON.parse(String(logSpy.mock.calls[0]?.[0]))).toMatchObject({
			activeSessionId: "urn:refarm:session:v1:abc123def456",
			sessions: [
				{
					"@id": "urn:refarm:session:v1:abc123def456",
					name: "planning",
				},
			],
		});
	});

	it("prints runtime errors as JSON when session listing cannot reach the runtime", async () => {
		vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("fetch failed")));
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		await createSessionsCommand().parseAsync(["--json"], { from: "user" });

		expect(errorSpy).not.toHaveBeenCalled();
		expect(JSON.parse(String(logSpy.mock.calls[0]?.[0]))).toMatchObject({
			command: "sessions",
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

	it("sessions use fails closed when active pointer verification reads back the wrong session", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({
				ok: true,
				status: 200,
				json: async () => ({
					sessions: [
						{
							"@id": "urn:refarm:session:v1:abc123def456",
							"@type": "Session",
						},
					],
				}),
			}),
		);
		vi.spyOn(fs, "readFileSync")
			.mockReturnValueOnce("urn:refarm:session:v1:before000000")
			.mockReturnValueOnce("urn:refarm:session:v1:other0000000");
		vi.spyOn(fs, "mkdirSync").mockImplementation(() => undefined as string | undefined);
		const writeSpy = vi
			.spyOn(fs, "writeFileSync")
			.mockImplementation(() => undefined);
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		const command = createSessionsCommand();
		await command.commands
			.find((c) => c.name() === "use")!
			.parseAsync(["abc123"], { from: "user" });

		expect(writeSpy).toHaveBeenCalledWith(
			expect.stringContaining(".refarm/session.lock"),
			"urn:refarm:session:v1:abc123def456",
			"utf-8",
		);
		expect(errorSpy).toHaveBeenCalledWith(
			expect.stringContaining("Session switch expected active session"),
		);
		expect(process.exitCode).toBe(1);
	});

	it("sessions use prints active session update as JSON", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({
				ok: true,
				status: 200,
				json: async () => ({
					sessions: [
						{
							"@id": "urn:refarm:session:v1:abc123def456",
							"@type": "Session",
							name: "planning",
						},
					],
				}),
			}),
		);
		vi.spyOn(fs, "readFileSync").mockReturnValue(
			"urn:refarm:session:v1:abc123def456",
		);
		vi.spyOn(fs, "mkdirSync").mockImplementation(() => undefined as string | undefined);
		vi.spyOn(fs, "writeFileSync").mockImplementation(() => undefined);
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await createSessionsCommand()
			.commands
			.find((c) => c.name() === "use")!
			.parseAsync(["abc123", "--json"], { from: "user" });

		expect(JSON.parse(String(logSpy.mock.calls[0]?.[0]))).toEqual({
			command: "sessions",
			operation: "use",
			action: "switched",
			activeSessionId: "urn:refarm:session:v1:abc123def456",
			session: {
				"@id": "urn:refarm:session:v1:abc123def456",
				"@type": "Session",
				name: "planning",
			},
			ok: true,
			nextAction: null,
			nextActions: [],
			nextCommand:
				"refarm sessions show 'urn:refarm:session:v1:abc123def456' --json",
			nextCommands: [
				"refarm sessions show 'urn:refarm:session:v1:abc123def456' --json",
				"refarm sessions list --json",
			],
		});
	});

	it("sessions use prints prefix errors as JSON", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({
				ok: true,
				status: 200,
				json: async () => ({
					sessions: [],
				}),
			}),
		);
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		await createSessionsCommand()
			.commands
			.find((c) => c.name() === "use")!
			.parseAsync(["missing", "--json"], { from: "user" });

		expect(errorSpy).not.toHaveBeenCalled();
		expect(JSON.parse(String(logSpy.mock.calls[0]?.[0]))).toMatchObject({
			command: "sessions",
			operation: "use",
			action: "sessions",
			ok: false,
			error: "session-not-found",
			prefix: "missing",
			nextAction: "refarm sessions list --json",
			nextCommand: "refarm sessions list --json",
		});
		expect(process.exitCode).toBe(1);
	});

	it("sessions clear prints clear result as JSON", async () => {
		vi.spyOn(fs, "unlinkSync").mockImplementation(() => undefined);
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await createSessionsCommand()
			.commands
			.find((c) => c.name() === "clear")!
			.parseAsync(["--json"], { from: "user" });

		expect(JSON.parse(String(logSpy.mock.calls[0]?.[0]))).toEqual({
			command: "sessions",
			operation: "clear",
			action: "cleared",
			activeSessionId: null,
			cleared: true,
			ok: true,
			nextAction: null,
			nextActions: [],
			nextCommand: "refarm sessions list --json",
			nextCommands: ["refarm sessions list --json"],
		});
	});

	it("sessions show prints history as JSON", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({
				ok: true,
				status: 200,
				json: async () => ({
					session: {
						"@id": "urn:refarm:session:v1:abc123def456",
						"@type": "Session",
						name: "planning",
					},
					entries: [
						{
							id: "entry-1",
							kind: "user",
							content: "hello",
							timestamp_ns: 1,
						},
					],
					total: 1,
				}),
			}),
		);
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await createSessionsCommand()
			.commands
			.find((c) => c.name() === "show")!
			.parseAsync(["abc123", "--json"], { from: "user" });

		expect(JSON.parse(String(logSpy.mock.calls[0]?.[0]))).toEqual({
			command: "sessions",
			operation: "show",
			session: {
				"@id": "urn:refarm:session:v1:abc123def456",
				"@type": "Session",
				name: "planning",
			},
			entries: [
				{
					id: "entry-1",
					kind: "user",
					content: "hello",
					timestamp_ns: 1,
				},
			],
			total: 1,
			ok: true,
			nextAction: null,
			nextActions: [],
			nextCommand:
				"refarm sessions use 'urn:refarm:session:v1:abc123def456' --json",
			nextCommands: [
				"refarm sessions use 'urn:refarm:session:v1:abc123def456' --json",
				"refarm sessions list --json",
			],
		});
	});

	it("sessions show prints ambiguous prefix errors as JSON", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({
				ok: false,
				status: 409,
				json: async () => ({
					error: "ambiguous",
					matches: [
						"urn:refarm:session:v1:abc111",
						"urn:refarm:session:v1:abc222",
					],
				}),
			}),
		);
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		await createSessionsCommand()
			.commands
			.find((c) => c.name() === "show")!
			.parseAsync(["abc", "--json"], { from: "user" });

		expect(errorSpy).not.toHaveBeenCalled();
		expect(JSON.parse(String(logSpy.mock.calls[0]?.[0]))).toMatchObject({
			command: "sessions",
			operation: "show",
			action: "sessions",
			ok: false,
			error: "ambiguous-session-prefix",
			prefix: "abc",
			matches: [
				"urn:refarm:session:v1:abc111",
				"urn:refarm:session:v1:abc222",
			],
			nextAction: "refarm sessions list --json",
			nextCommand: "refarm sessions list --json",
		});
		expect(process.exitCode).toBe(1);
	});

	it("sessions fork prints fork result as JSON", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({
				ok: true,
				status: 200,
				json: async () => ({
					session: {
						"@id": "urn:refarm:session:v1:fork123",
						"@type": "Session",
						name: "experiment",
						parent_session_id: "urn:refarm:session:v1:parent123",
						leaf_entry_id: "entry-1",
					},
				}),
			}),
		);
		vi.spyOn(fs, "mkdirSync").mockImplementation(() => undefined as string | undefined);
		vi.spyOn(fs, "writeFileSync").mockImplementation(() => undefined);
		vi.spyOn(fs, "readFileSync").mockReturnValue(
			"urn:refarm:session:v1:fork123",
		);
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await createSessionsCommand()
			.commands
			.find((c) => c.name() === "fork")!
			.parseAsync(["parent", "--name", "experiment", "--json"], { from: "user" });

		expect(JSON.parse(String(logSpy.mock.calls[0]?.[0]))).toEqual({
			command: "sessions",
			operation: "fork",
			action: "forked",
			activeSessionId: "urn:refarm:session:v1:fork123",
			parentSessionId: "urn:refarm:session:v1:parent123",
			branchEntryId: "entry-1",
			session: {
				"@id": "urn:refarm:session:v1:fork123",
				"@type": "Session",
				name: "experiment",
				parent_session_id: "urn:refarm:session:v1:parent123",
				leaf_entry_id: "entry-1",
			},
			ok: true,
			nextAction: null,
			nextActions: [],
			nextCommand:
				"refarm sessions show 'urn:refarm:session:v1:fork123' --json",
			nextCommands: [
				"refarm sessions show 'urn:refarm:session:v1:fork123' --json",
				"refarm sessions list --json",
			],
		});
	});

	it("sessions fork prints prefix errors as JSON", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({
				ok: false,
				status: 404,
				json: async () => ({
					error: "not found",
				}),
			}),
		);
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		await createSessionsCommand()
			.commands
			.find((c) => c.name() === "fork")!
			.parseAsync(["missing", "--json"], { from: "user" });

		expect(errorSpy).not.toHaveBeenCalled();
		expect(JSON.parse(String(logSpy.mock.calls[0]?.[0]))).toMatchObject({
			command: "sessions",
			operation: "fork",
			action: "sessions",
			ok: false,
			error: "session-not-found",
			prefix: "missing",
			nextAction: "refarm sessions list --json",
			nextCommand: "refarm sessions list --json",
		});
		expect(process.exitCode).toBe(1);
	});

	it("sessions new exits with actionable message when sidecar is down", async () => {
		vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("fetch failed")));
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		const command = createSessionsCommand();
		await command.commands.find((c) => c.name() === "new")!.parseAsync([], {
			from: "user",
		});

		expect(errorSpy).toHaveBeenCalledWith(
			expect.stringContaining("Refarm runtime is not running"),
		);
		expect(errorSpy).toHaveBeenCalledWith(
			expect.stringContaining("Status:     refarm runtime status"),
		);
		expect(errorSpy).toHaveBeenCalledWith(
			expect.stringContaining("Start now:  refarm runtime start"),
		);
		expect(process.exitCode).toBe(1);
	});

	it("sessions new prints runtime errors as JSON when sidecar is down", async () => {
		vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("fetch failed")));
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		const command = createSessionsCommand();
		await command.commands
			.find((c) => c.name() === "new")!
			.parseAsync(["--json"], {
				from: "user",
			});

		expect(errorSpy).not.toHaveBeenCalled();
		expect(JSON.parse(String(logSpy.mock.calls[0]?.[0]))).toMatchObject({
			command: "sessions",
			operation: "new",
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

	it("sessions new shows upgrade hint when endpoint is missing (HTTP 404)", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({
				ok: false,
				status: 404,
				json: async () => ({}),
			}),
		);
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		const command = createSessionsCommand();
		await command.commands.find((c) => c.name() === "new")!.parseAsync([], {
			from: "user",
		});

		expect(errorSpy).toHaveBeenCalledWith(
			expect.stringContaining("Session creation endpoint is unavailable"),
		);
		expect(errorSpy).toHaveBeenCalledWith(
			expect.stringContaining("Restart or update backend"),
		);
		expect(errorSpy).toHaveBeenCalledWith(
			expect.stringContaining("refarm doctor --next-action"),
		);
		expect(process.exitCode).toBe(1);
	});

	it("sessions new prints missing endpoint errors as JSON", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({
				ok: false,
				status: 404,
				json: async () => ({}),
			}),
		);
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		const command = createSessionsCommand();
		await command.commands
			.find((c) => c.name() === "new")!
			.parseAsync(["--json"], {
				from: "user",
			});

		expect(errorSpy).not.toHaveBeenCalled();
		expect(JSON.parse(String(logSpy.mock.calls[0]?.[0]))).toMatchObject({
			command: "sessions",
			operation: "new",
			action: "sessions",
			ok: false,
			error: "session-create-unavailable",
			message: "Session creation endpoint is unavailable in this daemon.",
			endpoint: "/sessions",
			nextAction: "refarm doctor --next-action",
			nextCommand: "refarm doctor --next-command",
			nextCommands: [
				"refarm doctor --next-command",
				"refarm runtime ensure --wait --next-command",
			],
		});
		expect(process.exitCode).toBe(1);
	});

	it("sessions new prints endpoint failures as JSON", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({
				ok: false,
				status: 500,
				json: async () => ({ error: "database unavailable" }),
			}),
		);
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		const command = createSessionsCommand();
		await command.commands
			.find((c) => c.name() === "new")!
			.parseAsync(["--json"], {
				from: "user",
			});

		expect(errorSpy).not.toHaveBeenCalled();
		expect(JSON.parse(String(logSpy.mock.calls[0]?.[0]))).toMatchObject({
			command: "sessions",
			operation: "new",
			action: "sessions",
			ok: false,
			error: "session-create-failed",
			message: "database unavailable",
			endpoint: "/sessions",
			nextAction: "refarm doctor --next-action",
			nextCommand: "refarm doctor --next-command",
		});
		expect(process.exitCode).toBe(1);
	});
});
