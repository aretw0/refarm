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
			nextAction: "refarm resume --json",
			nextActions: ["refarm resume --json"],
			nextCommand: "refarm resume --json",
			nextCommands: ["refarm resume --json"],
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
			nextAction: null,
			nextActions: [],
			nextCommand: null,
			nextCommands: [],
			node: {
				nodeId: "abcdef1234567890abcdef1234567890abcdef12",
				kind: "git",
			},
		});
	});

	it("prints git timeline lookup failures as JSON", async () => {
		spawnSyncMock.mockReturnValue(
			makeSpawnResult(128, "", "fatal: bad revision 'missing'"),
		);
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		const command = createTreeCommand();
		await command.commands
			.find((c) => c.name() === "show")!
			.parseAsync(["missing", "--scope", "git", "--json"], {
				from: "user",
			});

		expect(errorSpy).not.toHaveBeenCalled();
		expect(JSON.parse(String(logSpy.mock.calls[0]?.[0]))).toMatchObject({
			command: "tree",
			operation: "show",
			scope: "git",
			ok: false,
			error: "git-tree-show-failed",
			message: "fatal: bad revision 'missing'",
			target: "missing",
			nextAction: "refarm tree list --scope git --json",
			nextCommand: "refarm tree list --scope git --json",
			nextCommands: [
				"refarm tree list --scope git --json",
				"refarm doctor --next-command",
			],
		});
		expect(process.exitCode).toBe(1);
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

	it("prints missing session timeline nodes as JSON", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({
				ok: false,
				status: 404,
				json: async () => ({ error: "not found" }),
			}),
		);
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		const command = createTreeCommand();
		await command.commands
			.find((c) => c.name() === "show")!
			.parseAsync(["missing", "--json"], { from: "user" });

		expect(errorSpy).not.toHaveBeenCalled();
		expect(JSON.parse(String(logSpy.mock.calls[0]?.[0]))).toMatchObject({
			command: "tree",
			operation: "show",
			scope: "session",
			ok: false,
			error: "session-tree-node-not-found",
			message: 'No timeline node matching "missing".',
			prefix: "missing",
			nextAction: "refarm tree list --scope session --json",
			nextCommand: "refarm tree list --scope session --json",
		});
		expect(process.exitCode).toBe(1);
	});

	it("prints ambiguous session timeline nodes as JSON", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({
				ok: false,
				status: 409,
				json: async () => ({
					error: "ambiguous prefix",
					matches: [
						"urn:refarm:session:v1:abc123def456",
						"urn:refarm:session:v1:abc123999999",
					],
				}),
			}),
		);
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		const command = createTreeCommand();
		await command.commands
			.find((c) => c.name() === "show")!
			.parseAsync(["abc123", "--json"], { from: "user" });

		expect(errorSpy).not.toHaveBeenCalled();
		expect(JSON.parse(String(logSpy.mock.calls[0]?.[0]))).toMatchObject({
			command: "tree",
			operation: "show",
			scope: "session",
			ok: false,
			error: "ambiguous-session-tree-node",
			message: "ambiguous prefix",
			prefix: "abc123",
			matches: [
				"urn:refarm:session:v1:abc123def456",
				"urn:refarm:session:v1:abc123999999",
			],
			nextCommand: "refarm tree list --scope session --json",
		});
		expect(process.exitCode).toBe(1);
	});

	it("prints session timeline endpoint failures as JSON", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({
				ok: false,
				status: 500,
				json: async () => ({ error: "history unavailable" }),
			}),
		);
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		const command = createTreeCommand();
		await command.commands
			.find((c) => c.name() === "show")!
			.parseAsync(["abc123", "--json"], { from: "user" });

		expect(errorSpy).not.toHaveBeenCalled();
		expect(JSON.parse(String(logSpy.mock.calls[0]?.[0]))).toMatchObject({
			command: "tree",
			operation: "show",
			scope: "session",
			ok: false,
			error: "session-tree-history-failed",
			message: "history unavailable",
			prefix: "abc123",
			statusCommand: "refarm runtime status",
			nextAction: "refarm doctor --next-action",
			nextCommand: "refarm doctor --next-command",
			nextCommands: [
				"refarm doctor --next-command",
				"refarm runtime ensure --wait --next-command",
			],
		});
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
