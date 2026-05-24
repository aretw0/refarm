import fs from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:child_process", () => ({
	spawnSync: vi.fn(),
}));

import { spawnSync } from "node:child_process";
import { createTreeCommand } from "../../src/commands/tree.js";
import {
	expectPreviewPlanSubstrateFactsNested,
	GIT_LINE,
	HISTORY,
	makeJsonFetch,
	makeSpawnResult,
	SESSION,
} from "./tree.fixtures.js";

const spawnSyncMock = vi.mocked(spawnSync);

describe("refarm tree preview", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		process.exitCode = undefined;
	});

	afterEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
	});
	it("previews a non-destructive session fork plan", async () => {
		vi.stubGlobal("fetch", makeJsonFetch(HISTORY));
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		const command = createTreeCommand();
		await command.commands
			.find((c) => c.name() === "preview")!
			.parseAsync(["abc123", "--json"], {
				from: "user",
			});

		const payload = JSON.parse(logSpy.mock.calls[0]![0] as string);
		expectPreviewPlanSubstrateFactsNested(payload.plan);
		expect(payload).toMatchObject({
			schemaVersion: 1,
			command: "tree",
			scope: "session",
			operation: "preview",
			reason: "dry-run",
			nextAction:
				"Provide --name <branch-name> before executing session fork.",
			nextActions: [
				"Provide --name <branch-name> before executing session fork.",
			],
			nextCommand: null,
			nextCommands: [],
			plan: {
				action: "fork",
				destructive: false,
				readyToExecute: false,
				blockedReason:
					"Provide --name <branch-name> before executing session fork.",
				recommendedCommand:
					"refarm sessions fork abc123def456 --at entry-2 --name <branch-name>",
				effects: {
					activePointerChanged: true,
					branchCreated: true,
				},
				substrate: {
					kind: "session-fork",
					branchPointEntryId: "entry-2",
					branchName: "<branch-name>",
					activeSessionWillSwitch: true,
				},
			},
		});
	});

	it("previews a non-destructive session fork plan at a historical entry", async () => {
		vi.stubGlobal("fetch", makeJsonFetch(HISTORY));
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		const command = createTreeCommand();
		await command.commands
			.find((c) => c.name() === "preview")!
			.parseAsync(["abc123", "--at", "entry-1", "--json"], {
				from: "user",
			});

		const payload = JSON.parse(logSpy.mock.calls[0]![0] as string);
		expect(payload).toMatchObject({
			schemaVersion: 1,
			command: "tree",
			scope: "session",
			operation: "preview",
			reason: "dry-run",
			plan: {
				action: "fork",
				destructive: false,
				readyToExecute: false,
				recommendedCommand:
					"refarm sessions fork abc123def456 --at entry-1 --name <branch-name>",
				effects: {
					activePointerChanged: true,
					branchCreated: true,
				},
				substrate: {
					kind: "session-fork",
					branchPointEntryId: "entry-1",
					branchName: "<branch-name>",
					activeSessionWillSwitch: true,
				},
			},
		});
	});

	it("includes explicit branch names in session preview plans", async () => {
		vi.stubGlobal("fetch", makeJsonFetch(HISTORY));
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		const command = createTreeCommand();
		await command.commands
			.find((c) => c.name() === "preview")!
			.parseAsync(
				["abc123", "--at", "entry-1", "--name", "safe/fork", "--json"],
				{
					from: "user",
				},
			);

		const payload = JSON.parse(logSpy.mock.calls[0]![0] as string);
		expect(payload).toMatchObject({
			nextAction: "refarm sessions fork abc123def456 --at entry-1 --name safe/fork",
			nextActions: [
				"refarm sessions fork abc123def456 --at entry-1 --name safe/fork",
			],
			nextCommand: "refarm sessions fork abc123def456 --at entry-1 --name safe/fork",
			nextCommands: [
				"refarm sessions fork abc123def456 --at entry-1 --name safe/fork",
			],
		});
		expect(payload.plan).toMatchObject({
			action: "fork",
			readyToExecute: true,
			recommendedCommand:
				"refarm sessions fork abc123def456 --at entry-1 --name safe/fork",
			substrate: {
				kind: "session-fork",
				branchName: "safe/fork",
				branchPointEntryId: "entry-1",
			},
		});
	});

	it("fails closed for unsafe branch names", async () => {
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		const command = createTreeCommand();
		await command.commands
			.find((c) => c.name() === "preview")!
			.parseAsync(["abc123", "--name", "unsafe name"], { from: "user" });

		expect(errorSpy).toHaveBeenCalledWith(
			expect.stringContaining('Invalid branch name "unsafe name"'),
		);
		expect(process.exitCode).toBe(1);
	});

	it("fails closed for option-like branch names", async () => {
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		const command = createTreeCommand();
		await command.commands
			.find((c) => c.name() === "preview")!
			.parseAsync(["abc123", "--name", "-unsafe"], { from: "user" });

		expect(errorSpy).toHaveBeenCalledWith(
			expect.stringContaining('Invalid branch name "-unsafe"'),
		);
		expect(process.exitCode).toBe(1);
	});

	it.each([
		"unsafe..name",
		"refs/foo.lock",
		"refs/heads/foo",
		"safe/.hidden",
		"HEAD",
	])("fails closed for unsafe branch shape %s", async (name) => {
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		const command = createTreeCommand();
		await command.commands
			.find((c) => c.name() === "preview")!
			.parseAsync(["abc123", "--name", name], { from: "user" });

		expect(errorSpy).toHaveBeenCalledWith(
			expect.stringContaining(`Invalid branch name "${name}"`),
		);
		expect(process.exitCode).toBe(1);
	});

	it("fails closed when a session preview entry is missing", async () => {
		vi.stubGlobal("fetch", makeJsonFetch(HISTORY));
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		const command = createTreeCommand();
		await command.commands
			.find((c) => c.name() === "preview")!
			.parseAsync(["abc123", "--at", "missing-entry", "--json"], {
				from: "user",
			});

		expect(errorSpy).toHaveBeenCalledWith(
			expect.stringContaining('No entry "missing-entry"'),
		);
		expect(process.exitCode).toBe(1);
	});

	it("rejects --at for git previews", async () => {
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		const command = createTreeCommand();
		await command.commands
			.find((c) => c.name() === "preview")!
			.parseAsync(["abcdef", "--scope", "git", "--at", "entry-1"], {
				from: "user",
			});

		expect(errorSpy).toHaveBeenCalledWith(
			expect.stringContaining("--at is only supported for session timelines"),
		);
		expect(process.exitCode).toBe(1);
	});

	it("previews a non-destructive git branch plan", async () => {
		spawnSyncMock.mockReturnValue(makeSpawnResult(0, GIT_LINE));
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		const command = createTreeCommand();
		await command.commands
			.find((c) => c.name() === "preview")!
			.parseAsync(["abcdef", "--scope", "git", "--json"], { from: "user" });

		const payload = JSON.parse(logSpy.mock.calls[0]![0] as string);
		expectPreviewPlanSubstrateFactsNested(payload.plan);
		expect(payload).toMatchObject({
			schemaVersion: 1,
			command: "tree",
			scope: "git",
			operation: "preview",
			reason: "dry-run",
			nextAction: "Provide --name <branch-name> before executing tree fork.",
			nextActions: [
				"Provide --name <branch-name> before executing tree fork.",
			],
			nextCommand: null,
			nextCommands: [],
			plan: {
				action: "fork",
				destructive: false,
				readyToExecute: false,
				blockedReason:
					"Provide --name <branch-name> before executing tree fork.",
				recommendedCommand:
					"refarm tree fork --scope git abcdef123456 --name <branch-name>",
				effects: {
					activePointerChanged: false,
					branchCreated: true,
				},
				substrate: {
					kind: "git-branch",
					baseCommit: "abcdef1234567890abcdef1234567890abcdef12",
					branchName: "<branch-name>",
					worktreeSwitched: false,
				},
			},
		});
	});

	it("previews git switches without moving the worktree", async () => {
		spawnSyncMock
			.mockReturnValueOnce(makeSpawnResult(0))
			.mockReturnValueOnce(makeSpawnResult(0, "main\n"))
			.mockReturnValueOnce(makeSpawnResult(0))
			.mockReturnValueOnce(makeSpawnResult(0, GIT_LINE));
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		const command = createTreeCommand();
		await command.commands
			.find((c) => c.name() === "preview")!
			.parseAsync(["safe/fork", "--scope", "git", "--switch", "--json"], {
				from: "user",
			});

		const payload = JSON.parse(logSpy.mock.calls[0]![0] as string);
		expect(payload).toMatchObject({
			schemaVersion: 1,
			command: "tree",
			scope: "git",
			operation: "preview",
			reason: "dry-run",
			nextAction: "refarm tree switch --scope git safe/fork",
			nextActions: ["refarm tree switch --scope git safe/fork"],
			nextCommand: "refarm tree switch --scope git safe/fork",
			nextCommands: ["refarm tree switch --scope git safe/fork"],
			plan: {
				action: "switch",
				destructive: false,
				readyToExecute: true,
				recommendedCommand: "refarm tree switch --scope git safe/fork",
				effects: {
					activePointerChanged: true,
					branchCreated: false,
				},
				substrate: {
					kind: "git-switch",
					worktreeClean: true,
					currentRefBefore: "main",
					targetRefAfter: "safe/fork",
					targetCommit: "abcdef1234567890abcdef1234567890abcdef12",
					worktreeSwitched: true,
				},
			},
		});
		expect(spawnSyncMock).toHaveBeenCalledTimes(4);
	});

	it("previews already-active git switches as blocked", async () => {
		spawnSyncMock
			.mockReturnValueOnce(makeSpawnResult(0))
			.mockReturnValueOnce(makeSpawnResult(0, "safe/fork\n"))
			.mockReturnValueOnce(makeSpawnResult(0))
			.mockReturnValueOnce(makeSpawnResult(0, GIT_LINE));
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		const command = createTreeCommand();
		await command.commands
			.find((c) => c.name() === "preview")!
			.parseAsync(["safe/fork", "--scope", "git", "--switch", "--json"], {
				from: "user",
			});

		const payload = JSON.parse(logSpy.mock.calls[0]![0] as string);
		expect(payload).toMatchObject({
			nextAction: 'Git branch "safe/fork" is already active.',
			nextActions: ['Git branch "safe/fork" is already active.'],
			nextCommand: null,
			nextCommands: [],
		});
		expect(payload.plan).toMatchObject({
			action: "switch",
			readyToExecute: false,
			blockedReason: 'Git branch "safe/fork" is already active.',
			substrate: {
				kind: "git-switch",
				worktreeClean: true,
				currentRefBefore: "safe/fork",
				targetRefAfter: "safe/fork",
			},
		});
		expect(spawnSyncMock).toHaveBeenCalledTimes(4);
	});

	it("previews git switches against dirty worktrees without failing", async () => {
		spawnSyncMock
			.mockReturnValueOnce(makeSpawnResult(0))
			.mockReturnValueOnce(makeSpawnResult(0, "main\n"))
			.mockReturnValueOnce(
				makeSpawnResult(0, " M apps/refarm/src/commands/tree.ts\n"),
			)
			.mockReturnValueOnce(makeSpawnResult(0, GIT_LINE));
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		const command = createTreeCommand();
		await command.commands
			.find((c) => c.name() === "preview")!
			.parseAsync(["safe/fork", "--scope", "git", "--switch", "--json"], {
				from: "user",
			});

		const payload = JSON.parse(logSpy.mock.calls[0]![0] as string);
		expect(payload.plan).toMatchObject({
			action: "switch",
			readyToExecute: false,
			blockedReason: "Git worktree must be clean before tree switch execution.",
			substrate: {
				kind: "git-switch",
				worktreeClean: false,
				currentRefBefore: "main",
				targetRefAfter: "safe/fork",
			},
		});
		expect(spawnSyncMock).toHaveBeenCalledTimes(4);
	});

	it("rejects git switch previews with fork names before git execution", async () => {
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		const command = createTreeCommand();
		await command.commands
			.find((c) => c.name() === "preview")!
			.parseAsync(
				["safe/fork", "--scope", "git", "--switch", "--name", "other"],
				{ from: "user" },
			);

		expect(errorSpy).toHaveBeenCalledWith(
			expect.stringContaining("--name is only supported for fork previews"),
		);
		expect(process.exitCode).toBe(1);
		expect(spawnSyncMock).not.toHaveBeenCalled();
	});

	it("previews session switches without validating git branch-name shape", async () => {
		vi.stubGlobal("fetch", makeJsonFetch(HISTORY));
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		vi.spyOn(fs, "readFileSync").mockImplementation(() => {
			throw new Error("no active session");
		});

		const command = createTreeCommand();
		await command.commands
			.find((c) => c.name() === "preview")!
			.parseAsync(["abc123", "--switch", "--json"], { from: "user" });

		const payload = JSON.parse(logSpy.mock.calls[0]![0] as string);
		expect(payload).toMatchObject({
			schemaVersion: 1,
			command: "tree",
			scope: "session",
			operation: "preview",
			reason: "dry-run",
			plan: {
				action: "switch",
				destructive: false,
				readyToExecute: true,
				recommendedCommand: "refarm tree switch abc123def456",
				effects: {
					activePointerChanged: true,
					branchCreated: false,
				},
				substrate: {
					kind: "session-switch",
					targetSessionIdAfter: SESSION["@id"],
					activeSessionWillSwitch: true,
				},
			},
		});
		expect(spawnSyncMock).not.toHaveBeenCalled();
	});

	it("shows blocked session switch readiness in human preview output", async () => {
		vi.stubGlobal("fetch", makeJsonFetch(HISTORY));
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		vi.spyOn(fs, "readFileSync").mockReturnValue(SESSION["@id"]);
		const writeSpy = vi
			.spyOn(fs, "writeFileSync")
			.mockImplementation(() => undefined);

		const command = createTreeCommand();
		await command.commands
			.find((c) => c.name() === "preview")!
			.parseAsync(["abc123", "--switch"], { from: "user" });

		const output = logSpy.mock.calls.map((call) => String(call[0])).join("\n");
		expect(output).toContain(
			'Blocked: Session "abc123def456" is already active.',
		);
		expect(output).toContain("Command: refarm tree switch abc123def456");
		expect(writeSpy).not.toHaveBeenCalled();
	});

	it("previews already-active session switches as blocked", async () => {
		vi.stubGlobal("fetch", makeJsonFetch(HISTORY));
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		vi.spyOn(fs, "readFileSync").mockReturnValue(SESSION["@id"]);
		const writeSpy = vi
			.spyOn(fs, "writeFileSync")
			.mockImplementation(() => undefined);

		const command = createTreeCommand();
		await command.commands
			.find((c) => c.name() === "preview")!
			.parseAsync(["abc123", "--switch", "--json"], { from: "user" });

		const payload = JSON.parse(logSpy.mock.calls[0]![0] as string);
		expect(payload.plan).toMatchObject({
			action: "switch",
			readyToExecute: false,
			blockedReason: 'Session "abc123def456" is already active.',
			substrate: {
				kind: "session-switch",
				activeSessionIdBefore: SESSION["@id"],
				targetSessionIdAfter: SESSION["@id"],
			},
		});
		expect(writeSpy).not.toHaveBeenCalled();
		expect(spawnSyncMock).not.toHaveBeenCalled();
	});

	it.each([
		["--name", "other", "--name is only supported for fork previews"],
		["--at", "entry-1", "--at is only supported for session fork previews"],
	])("rejects session switch preview %s before sidecar calls", async (flag, value, expectedMessage) => {
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		const fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);

		const command = createTreeCommand();
		await command.commands
			.find((c) => c.name() === "preview")!
			.parseAsync(["abc123", "--switch", flag, value], { from: "user" });

		expect(errorSpy).toHaveBeenCalledWith(
			expect.stringContaining(expectedMessage),
		);
		expect(process.exitCode).toBe(1);
		expect(fetchMock).not.toHaveBeenCalled();
		expect(spawnSyncMock).not.toHaveBeenCalled();
	});

	it("includes explicit branch names in executable git preview plans", async () => {
		spawnSyncMock
			.mockReturnValueOnce(makeSpawnResult(0, GIT_LINE))
			.mockReturnValueOnce(makeSpawnResult(1));
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		const command = createTreeCommand();
		await command.commands
			.find((c) => c.name() === "preview")!
			.parseAsync(
				["abcdef", "--scope", "git", "--name", "safe/fork", "--json"],
				{
					from: "user",
				},
			);

		const payload = JSON.parse(logSpy.mock.calls[0]![0] as string);
		expect(payload.plan).toMatchObject({
			action: "fork",
			readyToExecute: true,
			recommendedCommand:
				"refarm tree fork --scope git abcdef123456 --name safe/fork",
			effects: {
				activePointerChanged: false,
				branchCreated: true,
			},
			substrate: {
				kind: "git-branch",
				branchName: "safe/fork",
				worktreeSwitched: false,
			},
		});
	});

	it("shows blocked git fork readiness in human preview output", async () => {
		spawnSyncMock
			.mockReturnValueOnce(makeSpawnResult(0, GIT_LINE))
			.mockReturnValueOnce(makeSpawnResult(0));
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		const command = createTreeCommand();
		await command.commands
			.find((c) => c.name() === "preview")!
			.parseAsync(["abcdef", "--scope", "git", "--name", "safe/fork"], {
				from: "user",
			});

		const output = logSpy.mock.calls.map((call) => String(call[0])).join("\n");
		expect(output).toContain('Blocked: Git branch "safe/fork" already exists.');
		expect(output).toContain(
			"Command: refarm tree fork --scope git abcdef123456 --name safe/fork",
		);
	});

	it("previews existing git fork targets as blocked", async () => {
		spawnSyncMock
			.mockReturnValueOnce(makeSpawnResult(0, GIT_LINE))
			.mockReturnValueOnce(makeSpawnResult(0));
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		const command = createTreeCommand();
		await command.commands
			.find((c) => c.name() === "preview")!
			.parseAsync(
				["abcdef", "--scope", "git", "--name", "safe/fork", "--json"],
				{
					from: "user",
				},
			);

		const payload = JSON.parse(logSpy.mock.calls[0]![0] as string);
		expect(payload.plan).toMatchObject({
			action: "fork",
			readyToExecute: false,
			blockedReason: 'Git branch "safe/fork" already exists.',
			substrate: {
				kind: "git-branch",
				branchName: "safe/fork",
			},
		});
	});

	it("shows ready session switch preview in human output", async () => {
		vi.stubGlobal("fetch", makeJsonFetch(HISTORY));
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		vi.spyOn(fs, "readFileSync").mockImplementation(() => {
			throw new Error("no active session");
		});

		const command = createTreeCommand();
		await command.commands
			.find((c) => c.name() === "preview")!
			.parseAsync(["abc123", "--switch"], { from: "user" });

		const output = logSpy.mock.calls.map((call) => String(call[0])).join("\n");
		expect(output).toContain("Ready: yes");
		expect(output).toContain("Command: refarm tree switch abc123def456");
		expect(spawnSyncMock).not.toHaveBeenCalled();
	});

});
