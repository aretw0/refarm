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
		const exitSpy = vi
			.spyOn(process, "exit")
			.mockImplementation(((code?: string | number | null | undefined) => {
				throw new Error(`exit:${code ?? 0}`);
			}) as never);

		const command = createSessionsCommand();
		await expect(
			command.commands
				.find((c) => c.name() === "use")!
				.parseAsync(["abc123"], { from: "user" }),
		).rejects.toThrow("exit:1");

		expect(writeSpy).toHaveBeenCalledWith(
			expect.stringContaining(".refarm/session.lock"),
			"urn:refarm:session:v1:abc123def456",
			"utf-8",
		);
		expect(errorSpy).toHaveBeenCalledWith(
			expect.stringContaining("Session switch expected active session"),
		);
		expect(exitSpy).toHaveBeenCalledWith(1);
	});

	it("sessions new exits with actionable message when sidecar is down", async () => {
		vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("fetch failed")));
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		const exitSpy = vi
			.spyOn(process, "exit")
			.mockImplementation(((code?: string | number | null | undefined) => {
				throw new Error(`exit:${code ?? 0}`);
			}) as never);

		const command = createSessionsCommand();
		await expect(
			command.commands.find((c) => c.name() === "new")!.parseAsync([], {
				from: "user",
			}),
		).rejects.toThrow("exit:1");

		expect(errorSpy).toHaveBeenCalledWith(
			expect.stringContaining("tractor is not running"),
		);
		expect(exitSpy).toHaveBeenCalledWith(1);
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
		const exitSpy = vi
			.spyOn(process, "exit")
			.mockImplementation(((code?: string | number | null | undefined) => {
				throw new Error(`exit:${code ?? 0}`);
			}) as never);

		const command = createSessionsCommand();
		await expect(
			command.commands.find((c) => c.name() === "new")!.parseAsync([], {
				from: "user",
			}),
		).rejects.toThrow("exit:1");

		expect(errorSpy).toHaveBeenCalledWith(
			expect.stringContaining("Session creation endpoint is unavailable"),
		);
		expect(errorSpy).toHaveBeenCalledWith(
			expect.stringContaining("Restart/update backend"),
		);
		expect(exitSpy).toHaveBeenCalledWith(1);
	});
});
