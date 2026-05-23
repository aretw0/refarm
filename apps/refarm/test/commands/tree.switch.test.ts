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
		const exitSpy = vi.spyOn(process, "exit").mockImplementation(((
			code?: string | number | null | undefined,
		) => {
			throw new Error(`exit:${code ?? 0}`);
		}) as never);

		const command = createTreeCommand();
		await expect(
			command.commands
				.find((c) => c.name() === "switch")!
				.parseAsync(["safe/fork", "--scope", "git"], { from: "user" }),
		).rejects.toThrow("exit:1");

		expect(errorSpy).toHaveBeenCalledWith(
			expect.stringContaining('Git branch "safe/fork" does not exist.'),
		);
		expect(exitSpy).toHaveBeenCalledWith(1);
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
		const exitSpy = vi.spyOn(process, "exit").mockImplementation(((
			code?: string | number | null | undefined,
		) => {
			throw new Error(`exit:${code ?? 0}`);
		}) as never);

		const command = createTreeCommand();
		await expect(
			command.commands
				.find((c) => c.name() === "switch")!
				.parseAsync(["safe/fork", "--scope", "git"], { from: "user" }),
		).rejects.toThrow("exit:1");

		expect(errorSpy).toHaveBeenCalledWith(
			expect.stringContaining("Git worktree must be clean before tree switch"),
		);
		expect(exitSpy).toHaveBeenCalledWith(1);
		expect(spawnSyncMock).toHaveBeenCalledTimes(3);
	});

	it("rejects git tree switches when the target branch is already active", async () => {
		spawnSyncMock
			.mockReturnValueOnce(makeSpawnResult(0))
			.mockReturnValueOnce(makeSpawnResult(0, "safe/fork\n"));
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		const exitSpy = vi.spyOn(process, "exit").mockImplementation(((
			code?: string | number | null | undefined,
		) => {
			throw new Error(`exit:${code ?? 0}`);
		}) as never);

		const command = createTreeCommand();
		await expect(
			command.commands
				.find((c) => c.name() === "switch")!
				.parseAsync(["safe/fork", "--scope", "git"], { from: "user" }),
		).rejects.toThrow("exit:1");

		expect(errorSpy).toHaveBeenCalledWith(
			expect.stringContaining('Git branch "safe/fork" is already active.'),
		);
		expect(exitSpy).toHaveBeenCalledWith(1);
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
		const exitSpy = vi.spyOn(process, "exit").mockImplementation(((
			code?: string | number | null | undefined,
		) => {
			throw new Error(`exit:${code ?? 0}`);
		}) as never);

		const command = createTreeCommand();
		await expect(
			command.commands
				.find((c) => c.name() === "switch")!
				.parseAsync(["abc123"], { from: "user" }),
		).rejects.toThrow("exit:1");

		expect(writeSpy).toHaveBeenCalledWith(
			expect.stringContaining(".refarm/session.lock"),
			SESSION["@id"],
			"utf-8",
		);
		expect(errorSpy).toHaveBeenCalledWith(
			expect.stringContaining("Session switch expected active session"),
		);
		expect(exitSpy).toHaveBeenCalledWith(1);
		expect(spawnSyncMock).not.toHaveBeenCalled();
	});

	it("rejects already-active session tree switches before writing", async () => {
		vi.stubGlobal("fetch", makeJsonFetch(HISTORY));
		vi.spyOn(fs, "readFileSync").mockReturnValue(SESSION["@id"]);
		const writeSpy = vi
			.spyOn(fs, "writeFileSync")
			.mockImplementation(() => undefined);
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		const exitSpy = vi.spyOn(process, "exit").mockImplementation(((
			code?: string | number | null | undefined,
		) => {
			throw new Error(`exit:${code ?? 0}`);
		}) as never);

		const command = createTreeCommand();
		await expect(
			command.commands
				.find((c) => c.name() === "switch")!
				.parseAsync(["abc123"], { from: "user" }),
		).rejects.toThrow("exit:1");

		expect(errorSpy).toHaveBeenCalledWith(
			expect.stringContaining('Session "abc123def456" is already active.'),
		);
		expect(exitSpy).toHaveBeenCalledWith(1);
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

	it.each([
		"0",
		"201",
		"1abc",
	])("fails closed for invalid session list limit %s", async (limit) => {
		const fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		const command = createTreeCommand();
		await command.commands
			.find((c) => c.name() === "list")!
			.parseAsync(["--scope", "session", "--limit", limit, "--json"], {
				from: "user",
			});

		expect(errorSpy).toHaveBeenCalledWith(
			expect.stringContaining(`Invalid --limit "${limit}"`),
		);
		expect(process.exitCode).toBe(1);
		expect(fetchMock).not.toHaveBeenCalled();
		expect(spawnSyncMock).not.toHaveBeenCalled();
	});

	it.each([
		"0",
		"201",
		"1abc",
	])("fails closed for invalid all list limit %s", async (limit) => {
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		const command = createTreeCommand();
		await command.commands
			.find((c) => c.name() === "list")!
			.parseAsync(["--scope", "all", "--limit", limit, "--json"], {
				from: "user",
			});

		expect(errorSpy).toHaveBeenCalledWith(
			expect.stringContaining(`Invalid --limit "${limit}"`),
		);
		expect(process.exitCode).toBe(1);
		expect(spawnSyncMock).not.toHaveBeenCalled();
	});

	it.each([
		"0",
		"201",
		"1abc",
	])("fails closed for invalid git list limit %s", async (limit) => {
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		const command = createTreeCommand();
		await command.commands
			.find((c) => c.name() === "list")!
			.parseAsync(["--scope", "git", "--limit", limit, "--json"], {
				from: "user",
			});

		expect(errorSpy).toHaveBeenCalledWith(
			expect.stringContaining(`Invalid --limit "${limit}"`),
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

});
