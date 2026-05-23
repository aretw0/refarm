import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:child_process", () => ({
	spawnSync: vi.fn(),
}));

import { spawnSync } from "node:child_process";
import { createTreeCommand } from "../../src/commands/tree.js";
import { GIT_LINE, HISTORY, makeJsonFetch, makeSpawnResult, SESSION } from "./tree.fixtures.js";

const spawnSyncMock = vi.mocked(spawnSync);

describe("refarm tree show", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		process.exitCode = undefined;
	});

	afterEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
		process.exitCode = undefined;
	});
	it("shows a session timeline node with entries", async () => {
		vi.stubGlobal("fetch", makeJsonFetch(HISTORY));
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		const command = createTreeCommand();
		await command.commands
			.find((c) => c.name() === "show")!
			.parseAsync(["abc123", "--json"], {
				from: "user",
			});

		const payload = JSON.parse(logSpy.mock.calls[0]![0] as string);
		expect(payload).toMatchObject({
			schemaVersion: 1,
			command: "tree",
			scope: "session",
			operation: "show",
			total: 2,
			node: { nodeId: SESSION["@id"], kind: "session" },
		});
		expect(payload.entries).toHaveLength(2);
	});

	it("shows a git timeline node", async () => {
		spawnSyncMock.mockReturnValue(makeSpawnResult(0, GIT_LINE));
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		const command = createTreeCommand();
		await command.commands
			.find((c) => c.name() === "show")!
			.parseAsync(["abcdef", "--scope", "git", "--json"], { from: "user" });

		const payload = JSON.parse(logSpy.mock.calls[0]![0] as string);
		expect(payload).toMatchObject({
			schemaVersion: 1,
			command: "tree",
			scope: "git",
			operation: "show",
			node: {
				nodeId: "abcdef1234567890abcdef1234567890abcdef12",
				kind: "git",
			},
		});
	});

	it("sets exitCode when a session timeline node is not found", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({
				ok: false,
				status: 404,
				json: async () => ({ error: "not found" }),
			}),
		);
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		const command = createTreeCommand();
		await command.commands
			.find((c) => c.name() === "show")!
			.parseAsync(["missing"], { from: "user" });

		expect(errorSpy).toHaveBeenCalledWith(
			expect.stringContaining('No timeline node matching "missing"'),
		);
		expect(process.exitCode).toBe(1);
	});

	it("sets exitCode when session history cannot reach the runtime", async () => {
		vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		const command = createTreeCommand();
		await command.commands
			.find((c) => c.name() === "show")!
			.parseAsync(["abc123"], { from: "user" });

		const output = errorSpy.mock.calls.map((call) => String(call[0])).join("\n");
		expect(output).toContain("Refarm runtime is not running");
		expect(process.exitCode).toBe(1);
	});

});
