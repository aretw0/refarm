import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:child_process", () => ({
	spawnSync: vi.fn(),
}));

import { spawnSync } from "node:child_process";
import { createTreeCommand } from "../../src/commands/tree.js";
import { GIT_LINE, makeSpawnResult } from "./tree.fixtures.js";

const spawnSyncMock = vi.mocked(spawnSync);

describe("refarm tree fork", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		process.exitCode = undefined;
	});

	afterEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
	});
	it("creates a non-switching git branch from a tree fork", async () => {
		spawnSyncMock
			.mockReturnValueOnce(makeSpawnResult(0, GIT_LINE))
			.mockReturnValueOnce(makeSpawnResult(1))
			.mockReturnValueOnce(makeSpawnResult(0, "main\n"))
			.mockReturnValueOnce(makeSpawnResult(0))
			.mockReturnValueOnce(makeSpawnResult(0, "main\n"));
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		const command = createTreeCommand();
		await command.commands
			.find((c) => c.name() === "fork")!
			.parseAsync(
				["abcdef", "--scope", "git", "--name", "safe/fork", "--json"],
				{
					from: "user",
				},
			);

		expect(spawnSyncMock).toHaveBeenNthCalledWith(
			2,
			"git",
			["show-ref", "--verify", "--quiet", "refs/heads/safe/fork"],
			{ encoding: "utf8" },
		);
		expect(spawnSyncMock).toHaveBeenNthCalledWith(
			3,
			"git",
			["rev-parse", "--abbrev-ref", "HEAD"],
			{ encoding: "utf8" },
		);
		expect(spawnSyncMock).toHaveBeenNthCalledWith(
			4,
			"git",
			["branch", "safe/fork", "abcdef1234567890abcdef1234567890abcdef12"],
			{ encoding: "utf8" },
		);
		expect(spawnSyncMock).toHaveBeenNthCalledWith(
			5,
			"git",
			["rev-parse", "--abbrev-ref", "HEAD"],
			{ encoding: "utf8" },
		);
		const payload = JSON.parse(logSpy.mock.calls[0]![0] as string);
		expect(payload).toMatchObject({
			schemaVersion: 1,
			command: "tree",
			scope: "git",
			operation: "fork",
			reason: "executed",
			result: {
				kind: "git-branch",
				destructive: false,
				worktreeSwitched: false,
				currentRefBefore: "main",
				currentRefAfter: "main",
				branchName: "safe/fork",
				baseCommit: "abcdef1234567890abcdef1234567890abcdef12",
				command: "git branch safe/fork abcdef123456",
			},
		});
	});

	it("fails closed if a git tree fork changes the current ref", async () => {
		spawnSyncMock
			.mockReturnValueOnce(makeSpawnResult(0, GIT_LINE))
			.mockReturnValueOnce(makeSpawnResult(1))
			.mockReturnValueOnce(makeSpawnResult(0, "main\n"))
			.mockReturnValueOnce(makeSpawnResult(0))
			.mockReturnValueOnce(makeSpawnResult(0, "safe/fork\n"));
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		const command = createTreeCommand();
		await command.commands
			.find((c) => c.name() === "fork")!
			.parseAsync(["abcdef", "--scope", "git", "--name", "safe/fork"], {
				from: "user",
			});

		expect(errorSpy).toHaveBeenCalledWith(
			expect.stringContaining(
				'Git worktree changed from "main" to "safe/fork" during tree fork.',
			),
		);
		expect(process.exitCode).toBe(1);
	});

	it("fails closed before branch creation when current ref cannot be read", async () => {
		spawnSyncMock
			.mockReturnValueOnce(makeSpawnResult(0, GIT_LINE))
			.mockReturnValueOnce(makeSpawnResult(1))
			.mockReturnValueOnce(makeSpawnResult(128, "", "fatal: ambiguous HEAD"));
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		const command = createTreeCommand();
		await command.commands
			.find((c) => c.name() === "fork")!
			.parseAsync(["abcdef", "--scope", "git", "--name", "safe/fork"], {
				from: "user",
			});

		expect(errorSpy).toHaveBeenCalledWith(
			expect.stringContaining("fatal: ambiguous HEAD"),
		);
		expect(process.exitCode).toBe(1);
		expect(spawnSyncMock).toHaveBeenCalledTimes(3);
	});

	it("rejects git tree forks when the branch already exists", async () => {
		spawnSyncMock
			.mockReturnValueOnce(makeSpawnResult(0, GIT_LINE))
			.mockReturnValueOnce(makeSpawnResult(0));
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		const command = createTreeCommand();
		await command.commands
			.find((c) => c.name() === "fork")!
			.parseAsync(["abcdef", "--scope", "git", "--name", "safe/fork"], {
				from: "user",
			});

		expect(errorSpy).toHaveBeenCalledWith(
			expect.stringContaining('Git branch "safe/fork" already exists.'),
		);
		expect(process.exitCode).toBe(1);
		expect(spawnSyncMock).toHaveBeenCalledTimes(2);
	});

	it("rejects entry selectors for git tree forks before git execution", async () => {
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		const command = createTreeCommand();
		await command.commands
			.find((c) => c.name() === "fork")!
			.parseAsync(
				[
					"abcdef",
					"--scope",
					"git",
					"--name",
					"safe/fork",
					"--at",
					"entry-1",
				],
				{ from: "user" },
			);

		expect(errorSpy).toHaveBeenCalledWith(
			expect.stringContaining("--at is only supported for session timelines"),
		);
		expect(process.exitCode).toBe(1);
		expect(spawnSyncMock).not.toHaveBeenCalled();
	});

	it("rejects entry selectors for git tree forks before branch-name validation", async () => {
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		const command = createTreeCommand();
		await command.commands
			.find((c) => c.name() === "fork")!
			.parseAsync(
				[
					"abcdef",
					"--scope",
					"git",
					"--name",
					"unsafe..name",
					"--at",
					"entry-1",
				],
				{ from: "user" },
			);

		expect(errorSpy).toHaveBeenCalledWith(
			expect.stringContaining("--at is only supported for session timelines"),
		);
		expect(process.exitCode).toBe(1);
		expect(spawnSyncMock).not.toHaveBeenCalled();
	});

	it("rejects session tree forks until session execution is explicit", async () => {
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		const command = createTreeCommand();
		await command.commands
			.find((c) => c.name() === "fork")!
			.parseAsync(["abc123", "--name", "safe/fork"], { from: "user" });

		expect(errorSpy).toHaveBeenCalledWith(
			expect.stringContaining(
				"refarm tree fork currently supports --scope git only",
			),
		);
		expect(process.exitCode).toBe(1);
		expect(spawnSyncMock).not.toHaveBeenCalled();
	});

	it("rejects session tree forks before branch-name validation", async () => {
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		const command = createTreeCommand();
		await command.commands
			.find((c) => c.name() === "fork")!
			.parseAsync(["abc123", "--name", "unsafe..name"], { from: "user" });

		expect(errorSpy).toHaveBeenCalledWith(
			expect.stringContaining(
				"refarm tree fork currently supports --scope git only",
			),
		);
		expect(process.exitCode).toBe(1);
		expect(spawnSyncMock).not.toHaveBeenCalled();
	});

});
