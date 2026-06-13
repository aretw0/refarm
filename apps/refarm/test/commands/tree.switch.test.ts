import fs from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:child_process", () => ({
	spawnSync: vi.fn(),
}));

import { spawnSync } from "node:child_process";
import { createTreeCommand } from "../../src/commands/tree.js";
import { GIT_LINE, HISTORY, makeJsonFetch, makeSpawnResult, SESSION } from "./tree.fixtures.js";

const spawnSyncMock = vi.mocked(spawnSync);

describe("refarm tree switch and guards", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		process.exitCode = undefined;
	});

	afterEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
	});
	it("switches the active git worktree with an explicit envelope", async () => {
		spawnSyncMock
			.mockReturnValueOnce(makeSpawnResult(0))
			.mockReturnValueOnce(makeSpawnResult(0, "main\n"))
			.mockReturnValueOnce(makeSpawnResult(0))
			.mockReturnValueOnce(makeSpawnResult(0, GIT_LINE))
			.mockReturnValueOnce(makeSpawnResult(0))
			.mockReturnValueOnce(makeSpawnResult(0, "safe/fork\n"));
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		const command = createTreeCommand();
		await command.commands
			.find((c) => c.name() === "switch")!
			.parseAsync(["safe/fork", "--scope", "git", "--json"], {
				from: "user",
			});

		expect(spawnSyncMock).toHaveBeenNthCalledWith(
			1,
			"git",
			["show-ref", "--verify", "--quiet", "refs/heads/safe/fork"],
			{ encoding: "utf8" },
		);
		expect(spawnSyncMock).toHaveBeenNthCalledWith(
			3,
			"git",
			["status", "--porcelain"],
			{ encoding: "utf8" },
		);
		expect(spawnSyncMock).toHaveBeenNthCalledWith(
			5,
			"git",
			["switch", "safe/fork"],
			{ encoding: "utf8" },
		);
		const payload = JSON.parse(logSpy.mock.calls[0]![0] as string);
		expect(payload).toMatchObject({
			schemaVersion: 1,
			command: "tree",
			scope: "git",
			operation: "switch",
			reason: "executed",
			nextAction: "refarm tree show --scope git safe/fork --json",
			nextActions: ["refarm tree show --scope git safe/fork --json"],
			nextCommand: "refarm tree show --scope git safe/fork --json",
			nextCommands: [
				"refarm tree show --scope git safe/fork --json",
				"refarm tree list --scope git --json",
			],
			result: {
				kind: "git-switch",
				destructive: false,
				worktreeSwitched: true,
				currentRefBefore: "main",
				currentRefAfter: "safe/fork",
				branchName: "safe/fork",
				targetCommit: "abcdef1234567890abcdef1234567890abcdef12",
				command: "git switch safe/fork",
			},
		});
	});

	it("rejects git tree switches when the branch is missing", async () => {
		spawnSyncMock.mockReturnValueOnce(makeSpawnResult(1));
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		const command = createTreeCommand();
		await command.commands
			.find((c) => c.name() === "switch")!
			.parseAsync(["safe/fork", "--scope", "git"], { from: "user" });

		expect(errorSpy).toHaveBeenCalledWith(
			expect.stringContaining('Git branch "safe/fork" does not exist.'),
		);
		expect(process.exitCode).toBe(1);
		expect(spawnSyncMock).toHaveBeenCalledTimes(1);
	});

	it("rejects git tree switches when the worktree is dirty", async () => {
		spawnSyncMock
			.mockReturnValueOnce(makeSpawnResult(0))
			.mockReturnValueOnce(makeSpawnResult(0, "main\n"))
			.mockReturnValueOnce(
				makeSpawnResult(0, " M apps/refarm/src/commands/tree.ts\n"),
			);
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		const command = createTreeCommand();
		await command.commands
			.find((c) => c.name() === "switch")!
			.parseAsync(["safe/fork", "--scope", "git"], { from: "user" });

		expect(errorSpy).toHaveBeenCalledWith(
			expect.stringContaining("Git worktree must be clean before tree switch"),
		);
		expect(process.exitCode).toBe(1);
		expect(spawnSyncMock).toHaveBeenCalledTimes(3);
	});

	it("rejects git tree switches when the target branch is already active", async () => {
		spawnSyncMock
			.mockReturnValueOnce(makeSpawnResult(0))
			.mockReturnValueOnce(makeSpawnResult(0, "safe/fork\n"));
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		const command = createTreeCommand();
		await command.commands
			.find((c) => c.name() === "switch")!
			.parseAsync(["safe/fork", "--scope", "git"], { from: "user" });

		expect(errorSpy).toHaveBeenCalledWith(
			expect.stringContaining('Git branch "safe/fork" is already active.'),
		);
		expect(process.exitCode).toBe(1);
		expect(spawnSyncMock).toHaveBeenCalledTimes(2);
	});

	it("switches active session pointers explicitly", async () => {
		vi.stubGlobal("fetch", makeJsonFetch(HISTORY));
		vi.spyOn(fs, "readFileSync")
			.mockReturnValueOnce("urn:refarm:session:v1:previous0001")
			.mockReturnValueOnce(SESSION["@id"]);
		const mkdirSpy = vi
			.spyOn(fs, "mkdirSync")
			.mockImplementation(() => undefined as string | undefined);
		const writeSpy = vi
			.spyOn(fs, "writeFileSync")
			.mockImplementation(() => undefined);
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		const command = createTreeCommand();
		await command.commands
			.find((c) => c.name() === "switch")!
			.parseAsync(["abc123", "--json"], { from: "user" });

		expect(mkdirSpy).toHaveBeenCalled();
		expect(writeSpy).toHaveBeenCalledWith(
			expect.stringContaining(".refarm/session.lock"),
			SESSION["@id"],
			"utf-8",
		);
		const payload = JSON.parse(logSpy.mock.calls[0]![0] as string);
		expect(payload).toMatchObject({
			schemaVersion: 1,
			command: "tree",
			scope: "session",
			operation: "switch",
			reason: "executed",
			nextAction: "refarm tree show abc123def456 --json",
			nextActions: ["refarm tree show abc123def456 --json"],
			nextCommand: "refarm tree show abc123def456 --json",
			nextCommands: [
				"refarm tree show abc123def456 --json",
				"refarm tree list --scope session --json",
			],
			result: {
				kind: "session-switch",
				destructive: false,
				activePointerChanged: true,
				currentSessionIdBefore: "urn:refarm:session:v1:previous0001",
				currentSessionIdAfter: SESSION["@id"],
				targetSessionId: SESSION["@id"],
				command: "refarm tree switch abc123def456",
			},
		});
		expect(spawnSyncMock).not.toHaveBeenCalled();
	});

	it("fails closed when session switch verification reads the wrong pointer", async () => {
		vi.stubGlobal("fetch", makeJsonFetch(HISTORY));
		vi.spyOn(fs, "readFileSync")
			.mockReturnValueOnce("urn:refarm:session:v1:previous0001")
			.mockReturnValueOnce("urn:refarm:session:v1:other00000001");
		const writeSpy = vi
			.spyOn(fs, "writeFileSync")
			.mockImplementation(() => undefined);
		vi.spyOn(fs, "mkdirSync").mockImplementation(
			() => undefined as string | undefined,
		);
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		const command = createTreeCommand();
		await command.commands
			.find((c) => c.name() === "switch")!
			.parseAsync(["abc123"], { from: "user" });

		expect(writeSpy).toHaveBeenCalledWith(
			expect.stringContaining(".refarm/session.lock"),
			SESSION["@id"],
			"utf-8",
		);
		expect(errorSpy).toHaveBeenCalledWith(
			expect.stringContaining("Session switch expected active session"),
		);
		expect(process.exitCode).toBe(1);
		expect(spawnSyncMock).not.toHaveBeenCalled();
	});

	it("prints session switch verification failures as JSON", async () => {
		vi.stubGlobal("fetch", makeJsonFetch(HISTORY));
		vi.spyOn(fs, "readFileSync")
			.mockReturnValueOnce("urn:refarm:session:v1:previous0001")
			.mockReturnValueOnce("urn:refarm:session:v1:other00000001");
		vi.spyOn(fs, "writeFileSync").mockImplementation(() => undefined);
		vi.spyOn(fs, "mkdirSync").mockImplementation(
			() => undefined as string | undefined,
		);
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		const command = createTreeCommand();
		await command.commands
			.find((c) => c.name() === "switch")!
			.parseAsync(["abc123", "--json"], { from: "user" });

		expect(errorSpy).not.toHaveBeenCalled();
		expect(JSON.parse(String(logSpy.mock.calls[0]?.[0]))).toMatchObject({
			command: "tree",
			operation: "switch",
			scope: "session",
			ok: false,
			error: "session-tree-switch-failed",
			prefix: "abc123",
			sessionId: SESSION["@id"],
			currentSessionIdBefore: "urn:refarm:session:v1:previous0001",
			nextAction: "refarm tree preview abc123def456 --switch --json",
			nextCommand: "refarm tree preview abc123def456 --switch --json",
			nextCommands: [
				"refarm tree preview abc123def456 --switch --json",
				"refarm tree list --scope session --json",
			],
		});
		expect(process.exitCode).toBe(1);
		expect(spawnSyncMock).not.toHaveBeenCalled();
	});

	it("rejects already-active session tree switches before writing", async () => {
		vi.stubGlobal("fetch", makeJsonFetch(HISTORY));
		vi.spyOn(fs, "readFileSync").mockReturnValue(SESSION["@id"]);
		const writeSpy = vi
			.spyOn(fs, "writeFileSync")
			.mockImplementation(() => undefined);
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		const command = createTreeCommand();
		await command.commands
			.find((c) => c.name() === "switch")!
			.parseAsync(["abc123"], { from: "user" });

		expect(errorSpy).toHaveBeenCalledWith(
			expect.stringContaining('Session "abc123def456" is already active.'),
		);
		expect(process.exitCode).toBe(1);
		expect(writeSpy).not.toHaveBeenCalled();
		expect(spawnSyncMock).not.toHaveBeenCalled();
	});

	it("prints already-active session tree switches as JSON", async () => {
		vi.stubGlobal("fetch", makeJsonFetch(HISTORY));
		vi.spyOn(fs, "readFileSync").mockReturnValue(SESSION["@id"]);
		const writeSpy = vi
			.spyOn(fs, "writeFileSync")
			.mockImplementation(() => undefined);
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		const command = createTreeCommand();
		await command.commands
			.find((c) => c.name() === "switch")!
			.parseAsync(["abc123", "--json"], { from: "user" });

		expect(errorSpy).not.toHaveBeenCalled();
		expect(JSON.parse(String(logSpy.mock.calls[0]?.[0]))).toMatchObject({
			command: "tree",
			operation: "switch",
			scope: "session",
			ok: false,
			error: "session-tree-already-active",
			message: 'Session "abc123def456" is already active.',
			prefix: "abc123",
			sessionId: SESSION["@id"],
			nextAction: "refarm tree show abc123def456 --json",
			nextCommand: "refarm tree show abc123def456 --json",
		});
		expect(process.exitCode).toBe(1);
		expect(writeSpy).not.toHaveBeenCalled();
		expect(spawnSyncMock).not.toHaveBeenCalled();
	});

	it("rejects unsafe git tree switch targets before git execution", async () => {
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		const command = createTreeCommand();
		await command.commands
			.find((c) => c.name() === "switch")!
			.parseAsync(["HEAD", "--scope", "git"], { from: "user" });

		expect(errorSpy).toHaveBeenCalledWith(
			expect.stringContaining('Invalid branch name "HEAD"'),
		);
		expect(process.exitCode).toBe(1);
		expect(spawnSyncMock).not.toHaveBeenCalled();
	});

	it("prints unsafe git tree switch targets as JSON before git execution", async () => {
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		const command = createTreeCommand();
		await command.commands
			.find((c) => c.name() === "switch")!
			.parseAsync(["HEAD", "--scope", "git", "--json"], { from: "user" });

		expect(errorSpy).not.toHaveBeenCalled();
		expect(JSON.parse(String(logSpy.mock.calls[0]?.[0]))).toMatchObject({
			command: "tree",
			operation: "switch",
			ok: false,
			error: "invalid-tree-branch-name",
			message: expect.stringContaining('Invalid branch name "HEAD"'),
			nextCommand: "refarm tree list --scope all --json",
			nextCommands: ["refarm tree list --scope all --json"],
			branchName: "HEAD",
		});
		expect(process.exitCode).toBe(1);
		expect(spawnSyncMock).not.toHaveBeenCalled();
	});

	it.each([
		"0",
		"201",
		"1abc",
	])("prints structured JSON for invalid session list limit %s", async (limit) => {
		const fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		const command = createTreeCommand();
		await command.commands
			.find((c) => c.name() === "list")!
			.parseAsync(["--scope", "session", "--limit", limit, "--json"], {
				from: "user",
			});

		expect(JSON.parse(String(logSpy.mock.calls[0]?.[0]))).toEqual(
			expect.objectContaining({
				ok: false,
				command: "tree",
				operation: "list",
				error: "invalid-tree-list-limit",
				message: `Invalid --limit "${limit}". Use an integer from 1 to 200.`,
				limit,
				nextCommand: "refarm tree list --json",
			}),
		);
		expect(process.exitCode).toBe(1);
		expect(fetchMock).not.toHaveBeenCalled();
		expect(spawnSyncMock).not.toHaveBeenCalled();
	});

	it.each([
		"0",
		"201",
		"1abc",
	])("prints structured JSON for invalid all list limit %s", async (limit) => {
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		const command = createTreeCommand();
		await command.commands
			.find((c) => c.name() === "list")!
			.parseAsync(["--scope", "all", "--limit", limit, "--json"], {
				from: "user",
			});

		expect(JSON.parse(String(logSpy.mock.calls[0]?.[0]))).toEqual(
			expect.objectContaining({
				ok: false,
				command: "tree",
				operation: "list",
				error: "invalid-tree-list-limit",
				message: `Invalid --limit "${limit}". Use an integer from 1 to 200.`,
				limit,
				nextCommand: "refarm tree list --json",
			}),
		);
		expect(process.exitCode).toBe(1);
		expect(spawnSyncMock).not.toHaveBeenCalled();
	});

	it.each([
		"0",
		"201",
		"1abc",
	])("prints structured JSON for invalid git list limit %s", async (limit) => {
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		const command = createTreeCommand();
		await command.commands
			.find((c) => c.name() === "list")!
			.parseAsync(["--scope", "git", "--limit", limit, "--json"], {
				from: "user",
			});

		expect(JSON.parse(String(logSpy.mock.calls[0]?.[0]))).toEqual(
			expect.objectContaining({
				ok: false,
				command: "tree",
				operation: "list",
				error: "invalid-tree-list-limit",
				message: `Invalid --limit "${limit}". Use an integer from 1 to 200.`,
				limit,
				nextCommand: "refarm tree list --json",
			}),
		);
		expect(process.exitCode).toBe(1);
		expect(spawnSyncMock).not.toHaveBeenCalled();
	});

	it("fails closed for unsupported list scopes before adapters", async () => {
		const fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		const command = createTreeCommand();
		await command.commands
			.find((c) => c.name() === "list")!
			.parseAsync(["--scope", "crdt"], {
				from: "user",
			});

		expect(errorSpy).toHaveBeenCalledWith(
			expect.stringContaining("--scope session|git|all"),
		);
		expect(process.exitCode).toBe(1);
		expect(fetchMock).not.toHaveBeenCalled();
		expect(spawnSyncMock).not.toHaveBeenCalled();
	});

	it("prints structured JSON for unsupported list scopes", async () => {
		const fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		const command = createTreeCommand();
		await command.commands
			.find((c) => c.name() === "list")!
			.parseAsync(["--scope", "crdt", "--json"], {
				from: "user",
			});

		expect(JSON.parse(String(logSpy.mock.calls[0]?.[0]))).toEqual(
			expect.objectContaining({
				ok: false,
				command: "tree",
				operation: "list",
				error: "unsupported-tree-list-scope",
				message:
					'refarm tree list currently supports --scope session|git|all; received "crdt".',
				scope: "crdt",
				allowedScopes: ["session", "git", "all"],
				nextCommand: "refarm tree list --scope all --json",
			}),
		);
		expect(process.exitCode).toBe(1);
		expect(fetchMock).not.toHaveBeenCalled();
		expect(spawnSyncMock).not.toHaveBeenCalled();
	});

	it.each([
		["show", ["abc123", "--scope", "all"]],
		["preview", ["abc123", "--scope", "all"]],
		["fork", ["abc123", "--scope", "all", "--name", "safe/fork"]],
		["switch", ["abc123", "--scope", "all"]],
	] as const)("rejects all scope outside read-only list before adapters for %s", async (commandName, args) => {
		const fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		const command = createTreeCommand();
		await command.commands
			.find((c) => c.name() === commandName)!
			.parseAsync([...args], { from: "user" });

		expect(errorSpy).toHaveBeenCalledWith(
			expect.stringContaining("--scope session|git for this operation"),
		);
		expect(process.exitCode).toBe(1);
		expect(fetchMock).not.toHaveBeenCalled();
		expect(spawnSyncMock).not.toHaveBeenCalled();
	});

	it("prints structured JSON when all scope is used outside read-only list", async () => {
		const fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		const command = createTreeCommand();
		await command.commands
			.find((c) => c.name() === "show")!
			.parseAsync(["abc123", "--scope", "all", "--json"], { from: "user" });

		expect(JSON.parse(String(logSpy.mock.calls[0]?.[0]))).toEqual(
			expect.objectContaining({
				ok: false,
				command: "tree",
				operation: "show",
				error: "unsupported-tree-scope",
				message:
					'refarm tree currently supports --scope session|git for this operation; received "all".',
				scope: "all",
				allowedScopes: ["session", "git"],
				nextCommand: "refarm tree list --scope all --json",
			}),
		);
		expect(process.exitCode).toBe(1);
		expect(fetchMock).not.toHaveBeenCalled();
		expect(spawnSyncMock).not.toHaveBeenCalled();
	});

});
