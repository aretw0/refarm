import fs from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:child_process", () => ({
	spawnSync: vi.fn(),
}));

import { spawnSync } from "node:child_process";
import { createTreeCommand } from "../../src/commands/tree.js";

const spawnSyncMock = vi.mocked(spawnSync);

const SESSION = {
	"@id": "urn:refarm:session:v1:abc123def456",
	"@type": "Session",
	name: "auth-refactor",
	created_at_ns: 1_700_000_000_000_000_000,
	leaf_entry_id: "entry-2",
	parent_session_id: "urn:refarm:session:v1:parent00000001",
};

const OLDER_SESSION = {
	"@id": "urn:refarm:session:v1:older00000001",
	"@type": "Session",
	name: "older-branch",
	created_at_ns: 1_600_000_000_000_000_000,
	leaf_entry_id: "entry-old",
};

const HISTORY = {
	session: SESSION,
	entries: [
		{ id: "entry-1", kind: "user", content: "plan", timestamp_ns: 1 },
		{ id: "entry-2", kind: "assistant", content: "done", timestamp_ns: 2 },
	],
	total: 2,
};

const GIT_LINE = [
	"abcdef1234567890abcdef1234567890abcdef12",
	"1111111111111111111111111111111111111111",
	"HEAD -> develop, origin/develop",
	"2026-05-06T14:00:00+00:00",
	"feat(refarm): grow timeline tree",
].join("\u001f");

const SAME_TIMESTAMP_GIT_LINE = [
	"abcdef1234567890abcdef1234567890abcdef12",
	"1111111111111111111111111111111111111111",
	"HEAD -> develop, origin/develop",
	"2023-11-14T22:13:20.000Z",
	"feat(refarm): grow timeline tree",
].join("\u001f");

describe("refarm tree", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		process.exitCode = undefined;
	});

	afterEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
	});

	it("describes tree switch targets without assuming git-only branches", () => {
		const command = createTreeCommand();
		const switchHelp = command.commands
			.find((c) => c.name() === "switch")!
			.helpInformation();

		expect(switchHelp).toContain("<target>");
		expect(switchHelp).toContain("Session ID/prefix or existing git branch");
	});

	it("describes switch previews across session and git substrates", () => {
		const command = createTreeCommand();
		const previewHelp = command.commands
			.find((c) => c.name() === "preview")!
			.helpInformation();

		expect(previewHelp).toContain("--switch");
		expect(previewHelp).toContain(
			"Preview switching to an existing session or git branch",
		);
	});

	it("lists session timeline nodes as renderer-independent JSON", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({
				ok: true,
				status: 200,
				json: async () => ({ sessions: [SESSION] }),
			}) as any,
		);
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		const command = createTreeCommand();
		await command.commands
			.find((c) => c.name() === "list")!
			.parseAsync(["--json"], {
				from: "user",
			});

		const payload = JSON.parse(logSpy.mock.calls[0][0] as string);
		expect(payload).toMatchObject({
			schemaVersion: 1,
			command: "tree",
			scope: "session",
			operation: "list",
			nodes: [
				{
					timelineId: "session",
					nodeId: SESSION["@id"],
					parentNodeId: SESSION.parent_session_id,
					branchId: SESSION["@id"],
					kind: "session",
					label: "auth-refactor",
					metadata: {
						shortId: "abc123def456",
						leafEntryId: "entry-2",
						hasHistory: true,
					},
				},
			],
		});
	});

	it("applies session list limits after sorting sessions", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({
				ok: true,
				status: 200,
				json: async () => ({ sessions: [OLDER_SESSION, SESSION] }),
			}) as any,
		);
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		const command = createTreeCommand();
		await command.commands
			.find((c) => c.name() === "list")!
			.parseAsync(["--limit", "1", "--json"], { from: "user" });

		const payload = JSON.parse(logSpy.mock.calls[0][0] as string);
		expect(payload.nodes).toHaveLength(1);
		expect(payload.nodes[0]).toMatchObject({
			kind: "session",
			nodeId: SESSION["@id"],
		});
	});

	it("lists session timeline switch affordances in human output", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({
				ok: true,
				status: 200,
				json: async () => ({ sessions: [SESSION] }),
			}) as any,
		);
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		const command = createTreeCommand();
		await command.commands
			.find((c) => c.name() === "list")!
			.parseAsync([], { from: "user" });

		const output = logSpy.mock.calls.map((call) => String(call[0])).join("\n");
		expect(output).toContain("refarm tree preview <id-prefix> --switch");
		expect(output).toContain("refarm tree switch <id-prefix>");
	});

	it("lists git commits as timeline nodes", async () => {
		spawnSyncMock.mockReturnValue({
			status: 0,
			stdout: GIT_LINE,
			stderr: "",
		} as any);
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		const command = createTreeCommand();
		await command.commands
			.find((c) => c.name() === "list")!
			.parseAsync(["--scope", "git", "--limit", "1", "--json"], {
				from: "user",
			});

		expect(spawnSyncMock).toHaveBeenCalledWith(
			"git",
			expect.arrayContaining(["log"]),
			{
				encoding: "utf8",
			},
		);
		const payload = JSON.parse(logSpy.mock.calls[0][0] as string);
		expect(payload).toMatchObject({
			schemaVersion: 1,
			command: "tree",
			scope: "git",
			operation: "list",
			nodes: [
				{
					timelineId: "git",
					nodeId: "abcdef1234567890abcdef1234567890abcdef12",
					parentNodeId: "1111111111111111111111111111111111111111",
					branchId: "HEAD -> develop",
					kind: "git",
					label: "feat(refarm): grow timeline tree",
					metadata: {
						shortId: "abcdef123456",
						refs: ["HEAD -> develop", "origin/develop"],
					},
				},
			],
		});
	});

	it("lists all timeline nodes as a read-only combined envelope", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({
				ok: true,
				status: 200,
				json: async () => ({ sessions: [SESSION] }),
			}) as any,
		);
		spawnSyncMock.mockReturnValue({
			status: 0,
			stdout: GIT_LINE,
			stderr: "",
		} as any);
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		const command = createTreeCommand();
		await command.commands
			.find((c) => c.name() === "list")!
			.parseAsync(["--scope", "all", "--limit", "2", "--json"], {
				from: "user",
			});

		const payload = JSON.parse(logSpy.mock.calls[0][0] as string);
		expect(payload).toMatchObject({
			schemaVersion: 1,
			command: "tree",
			scope: "all",
			operation: "list",
		});
		expect(payload.nodes).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ kind: "session", nodeId: SESSION["@id"] }),
				expect.objectContaining({
					kind: "git",
					nodeId: "abcdef1234567890abcdef1234567890abcdef12",
				}),
			]),
		);
	});

	it("applies all-scope limit after combining timeline nodes", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({
				ok: true,
				status: 200,
				json: async () => ({ sessions: [SESSION] }),
			}) as any,
		);
		spawnSyncMock.mockReturnValue({
			status: 0,
			stdout: GIT_LINE,
			stderr: "",
		} as any);
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		const command = createTreeCommand();
		await command.commands
			.find((c) => c.name() === "list")!
			.parseAsync(["--scope", "all", "--limit", "1", "--json"], {
				from: "user",
			});

		const payload = JSON.parse(logSpy.mock.calls[0][0] as string);
		expect(payload.nodes).toHaveLength(1);
		expect(payload.nodes[0]).toMatchObject({
			kind: "git",
			nodeId: "abcdef1234567890abcdef1234567890abcdef12",
		});
	});

	it("orders all-scope timeline ties deterministically", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({
				ok: true,
				status: 200,
				json: async () => ({ sessions: [SESSION] }),
			}) as any,
		);
		spawnSyncMock.mockReturnValue({
			status: 0,
			stdout: SAME_TIMESTAMP_GIT_LINE,
			stderr: "",
		} as any);
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		const command = createTreeCommand();
		await command.commands
			.find((c) => c.name() === "list")!
			.parseAsync(["--scope", "all", "--limit", "2", "--json"], {
				from: "user",
			});

		const payload = JSON.parse(logSpy.mock.calls[0][0] as string);
		expect(payload.nodes.map((node: { kind: string }) => node.kind)).toEqual([
			"git",
			"session",
		]);
	});

	it("lists all timeline nodes in human output", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({
				ok: true,
				status: 200,
				json: async () => ({ sessions: [SESSION] }),
			}) as any,
		);
		spawnSyncMock.mockReturnValue({
			status: 0,
			stdout: GIT_LINE,
			stderr: "",
		} as any);
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		const command = createTreeCommand();
		await command.commands
			.find((c) => c.name() === "list")!
			.parseAsync(["--scope", "all", "--limit", "2"], { from: "user" });

		const output = logSpy.mock.calls.map((call) => String(call[0])).join("\n");
		expect(output).toContain("Tree timeline  (all scope)");
		expect(output).toContain("[session]");
		expect(output).toContain("[git]");
		expect(output).toContain("refarm tree show --scope git <commit>");
	});

	it("prints empty all-scope human output without mutating state", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({
				ok: true,
				status: 200,
				json: async () => ({ sessions: [] }),
			}) as any,
		);
		spawnSyncMock.mockReturnValue({ status: 0, stdout: "", stderr: "" } as any);
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		const command = createTreeCommand();
		await command.commands
			.find((c) => c.name() === "list")!
			.parseAsync(["--scope", "all"], { from: "user" });

		expect(logSpy).toHaveBeenCalledWith(
			expect.stringContaining("No session or git timeline nodes found."),
		);
		expect(spawnSyncMock).toHaveBeenCalledWith(
			"git",
			expect.arrayContaining(["log"]),
			{ encoding: "utf8" },
		);
	});

	it("prints sidecar guidance when all-scope session nodes are unavailable", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockRejectedValue(new Error("fetch failed")),
		);
		spawnSyncMock.mockReturnValue({
			status: 0,
			stdout: GIT_LINE,
			stderr: "",
		} as any);
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		const exitSpy = vi.spyOn(process, "exit").mockImplementation(((
			code?: string | number | null | undefined,
		) => {
			throw new Error(`exit:${code ?? 0}`);
		}) as never);

		const command = createTreeCommand();
		await expect(
			command.commands
				.find((c) => c.name() === "list")!
				.parseAsync(["--scope", "all", "--json"], { from: "user" }),
		).rejects.toThrow("exit:1");

		expect(errorSpy).toHaveBeenCalledWith(
			expect.stringContaining("farmhand sidecar is not running"),
		);
		expect(errorSpy).toHaveBeenCalledWith(
			expect.stringContaining("npm run farmhand:daemon"),
		);
		expect(exitSpy).toHaveBeenCalledWith(1);
	});

	it("lists git tree execution affordances in human output", async () => {
		spawnSyncMock.mockReturnValue({
			status: 0,
			stdout: GIT_LINE,
			stderr: "",
		} as any);
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		const command = createTreeCommand();
		await command.commands
			.find((c) => c.name() === "list")!
			.parseAsync(["--scope", "git", "--limit", "1"], { from: "user" });

		const output = logSpy.mock.calls.map((call) => String(call[0])).join("\n");
		expect(output).toContain(
			"refarm tree preview --scope git <commit> --name <branch>",
		);
		expect(output).toContain(
			"refarm tree fork --scope git <commit> --name <branch>",
		);
		expect(output).toContain(
			"refarm tree preview --scope git <branch> --switch",
		);
		expect(output).toContain("refarm tree switch --scope git <branch>");
	});

	it("shows a session timeline node with entries", async () => {
		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			status: 200,
			json: async () => HISTORY,
		});
		vi.stubGlobal("fetch", fetchMock as any);
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		const command = createTreeCommand();
		await command.commands
			.find((c) => c.name() === "show")!
			.parseAsync(["abc123", "--json"], {
				from: "user",
			});

		expect(fetchMock).toHaveBeenCalledWith(
			"http://127.0.0.1:42001/sessions/abc123/history",
		);
		const payload = JSON.parse(logSpy.mock.calls[0][0] as string);
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
		spawnSyncMock.mockReturnValue({
			status: 0,
			stdout: GIT_LINE,
			stderr: "",
		} as any);
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		const command = createTreeCommand();
		await command.commands
			.find((c) => c.name() === "show")!
			.parseAsync(["abcdef", "--scope", "git", "--json"], { from: "user" });

		const payload = JSON.parse(logSpy.mock.calls[0][0] as string);
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

	it("previews a non-destructive session fork plan", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({
				ok: true,
				status: 200,
				json: async () => HISTORY,
			}) as any,
		);
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		const command = createTreeCommand();
		await command.commands
			.find((c) => c.name() === "preview")!
			.parseAsync(["abc123", "--json"], {
				from: "user",
			});

		const payload = JSON.parse(logSpy.mock.calls[0][0] as string);
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
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({
				ok: true,
				status: 200,
				json: async () => HISTORY,
			}) as any,
		);
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		const command = createTreeCommand();
		await command.commands
			.find((c) => c.name() === "preview")!
			.parseAsync(["abc123", "--at", "entry-1", "--json"], {
				from: "user",
			});

		const payload = JSON.parse(logSpy.mock.calls[0][0] as string);
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
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({
				ok: true,
				status: 200,
				json: async () => HISTORY,
			}) as any,
		);
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

		const payload = JSON.parse(logSpy.mock.calls[0][0] as string);
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
		const exitSpy = vi.spyOn(process, "exit").mockImplementation(((
			code?: string | number | null | undefined,
		) => {
			throw new Error(`exit:${code ?? 0}`);
		}) as never);

		const command = createTreeCommand();
		await expect(
			command.commands
				.find((c) => c.name() === "preview")!
				.parseAsync(["abc123", "--name", "unsafe name"], { from: "user" }),
		).rejects.toThrow("exit:1");

		expect(errorSpy).toHaveBeenCalledWith(
			expect.stringContaining('Invalid branch name "unsafe name"'),
		);
		expect(exitSpy).toHaveBeenCalledWith(1);
	});

	it("fails closed for option-like branch names", async () => {
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		const exitSpy = vi.spyOn(process, "exit").mockImplementation(((
			code?: string | number | null | undefined,
		) => {
			throw new Error(`exit:${code ?? 0}`);
		}) as never);

		const command = createTreeCommand();
		await expect(
			command.commands
				.find((c) => c.name() === "preview")!
				.parseAsync(["abc123", "--name", "-unsafe"], { from: "user" }),
		).rejects.toThrow("exit:1");

		expect(errorSpy).toHaveBeenCalledWith(
			expect.stringContaining('Invalid branch name "-unsafe"'),
		);
		expect(exitSpy).toHaveBeenCalledWith(1);
	});

	it.each([
		"unsafe..name",
		"refs/foo.lock",
		"refs/heads/foo",
		"safe/.hidden",
		"HEAD",
	])("fails closed for unsafe branch shape %s", async (name) => {
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		const exitSpy = vi.spyOn(process, "exit").mockImplementation(((
			code?: string | number | null | undefined,
		) => {
			throw new Error(`exit:${code ?? 0}`);
		}) as never);

		const command = createTreeCommand();
		await expect(
			command.commands
				.find((c) => c.name() === "preview")!
				.parseAsync(["abc123", "--name", name], { from: "user" }),
		).rejects.toThrow("exit:1");

		expect(errorSpy).toHaveBeenCalledWith(
			expect.stringContaining(`Invalid branch name "${name}"`),
		);
		expect(exitSpy).toHaveBeenCalledWith(1);
	});

	it("fails closed when a session preview entry is missing", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({
				ok: true,
				status: 200,
				json: async () => HISTORY,
			}) as any,
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
				.find((c) => c.name() === "preview")!
				.parseAsync(["abc123", "--at", "missing-entry", "--json"], {
					from: "user",
				}),
		).rejects.toThrow("exit:1");

		expect(errorSpy).toHaveBeenCalledWith(
			expect.stringContaining('No entry "missing-entry"'),
		);
		expect(exitSpy).toHaveBeenCalledWith(1);
	});

	it("rejects --at for git previews", async () => {
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		const exitSpy = vi.spyOn(process, "exit").mockImplementation(((
			code?: string | number | null | undefined,
		) => {
			throw new Error(`exit:${code ?? 0}`);
		}) as never);

		const command = createTreeCommand();
		await expect(
			command.commands
				.find((c) => c.name() === "preview")!
				.parseAsync(["abcdef", "--scope", "git", "--at", "entry-1"], {
					from: "user",
				}),
		).rejects.toThrow("exit:1");

		expect(errorSpy).toHaveBeenCalledWith(
			expect.stringContaining("--at is only supported for session timelines"),
		);
		expect(exitSpy).toHaveBeenCalledWith(1);
	});

	it("previews a non-destructive git branch plan", async () => {
		spawnSyncMock.mockReturnValue({
			status: 0,
			stdout: GIT_LINE,
			stderr: "",
		} as any);
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		const command = createTreeCommand();
		await command.commands
			.find((c) => c.name() === "preview")!
			.parseAsync(["abcdef", "--scope", "git", "--json"], { from: "user" });

		const payload = JSON.parse(logSpy.mock.calls[0][0] as string);
		expect(payload).toMatchObject({
			schemaVersion: 1,
			command: "tree",
			scope: "git",
			operation: "preview",
			reason: "dry-run",
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
			.mockReturnValueOnce({ status: 0, stdout: "", stderr: "" } as any)
			.mockReturnValueOnce({ status: 0, stdout: "main\n", stderr: "" } as any)
			.mockReturnValueOnce({ status: 0, stdout: "", stderr: "" } as any)
			.mockReturnValueOnce({
				status: 0,
				stdout: GIT_LINE,
				stderr: "",
			} as any);
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		const command = createTreeCommand();
		await command.commands
			.find((c) => c.name() === "preview")!
			.parseAsync(["safe/fork", "--scope", "git", "--switch", "--json"], {
				from: "user",
			});

		const payload = JSON.parse(logSpy.mock.calls[0][0] as string);
		expect(payload).toMatchObject({
			schemaVersion: 1,
			command: "tree",
			scope: "git",
			operation: "preview",
			reason: "dry-run",
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
			.mockReturnValueOnce({ status: 0, stdout: "", stderr: "" } as any)
			.mockReturnValueOnce({
				status: 0,
				stdout: "safe/fork\n",
				stderr: "",
			} as any)
			.mockReturnValueOnce({ status: 0, stdout: "", stderr: "" } as any)
			.mockReturnValueOnce({
				status: 0,
				stdout: GIT_LINE,
				stderr: "",
			} as any);
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		const command = createTreeCommand();
		await command.commands
			.find((c) => c.name() === "preview")!
			.parseAsync(["safe/fork", "--scope", "git", "--switch", "--json"], {
				from: "user",
			});

		const payload = JSON.parse(logSpy.mock.calls[0][0] as string);
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
			.mockReturnValueOnce({ status: 0, stdout: "", stderr: "" } as any)
			.mockReturnValueOnce({ status: 0, stdout: "main\n", stderr: "" } as any)
			.mockReturnValueOnce({
				status: 0,
				stdout: " M apps/refarm/src/commands/tree.ts\n",
				stderr: "",
			} as any)
			.mockReturnValueOnce({
				status: 0,
				stdout: GIT_LINE,
				stderr: "",
			} as any);
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		const command = createTreeCommand();
		await command.commands
			.find((c) => c.name() === "preview")!
			.parseAsync(["safe/fork", "--scope", "git", "--switch", "--json"], {
				from: "user",
			});

		const payload = JSON.parse(logSpy.mock.calls[0][0] as string);
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
		const exitSpy = vi.spyOn(process, "exit").mockImplementation(((
			code?: string | number | null | undefined,
		) => {
			throw new Error(`exit:${code ?? 0}`);
		}) as never);

		const command = createTreeCommand();
		await expect(
			command.commands
				.find((c) => c.name() === "preview")!
				.parseAsync(
					["safe/fork", "--scope", "git", "--switch", "--name", "other"],
					{ from: "user" },
				),
		).rejects.toThrow("exit:1");

		expect(errorSpy).toHaveBeenCalledWith(
			expect.stringContaining("--name is only supported for fork previews"),
		);
		expect(exitSpy).toHaveBeenCalledWith(1);
		expect(spawnSyncMock).not.toHaveBeenCalled();
	});

	it("previews session switches without validating git branch-name shape", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({
				ok: true,
				status: 200,
				json: async () => HISTORY,
			}) as any,
		);
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		vi.spyOn(fs, "readFileSync").mockImplementation(() => {
			throw new Error("no active session");
		});

		const command = createTreeCommand();
		await command.commands
			.find((c) => c.name() === "preview")!
			.parseAsync(["abc123", "--switch", "--json"], { from: "user" });

		const payload = JSON.parse(logSpy.mock.calls[0][0] as string);
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
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({
				ok: true,
				status: 200,
				json: async () => HISTORY,
			}) as any,
		);
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
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({
				ok: true,
				status: 200,
				json: async () => HISTORY,
			}) as any,
		);
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		vi.spyOn(fs, "readFileSync").mockReturnValue(SESSION["@id"]);
		const writeSpy = vi
			.spyOn(fs, "writeFileSync")
			.mockImplementation(() => undefined);

		const command = createTreeCommand();
		await command.commands
			.find((c) => c.name() === "preview")!
			.parseAsync(["abc123", "--switch", "--json"], { from: "user" });

		const payload = JSON.parse(logSpy.mock.calls[0][0] as string);
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
		const exitSpy = vi.spyOn(process, "exit").mockImplementation(((
			code?: string | number | null | undefined,
		) => {
			throw new Error(`exit:${code ?? 0}`);
		}) as never);
		const fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock as any);

		const command = createTreeCommand();
		await expect(
			command.commands
				.find((c) => c.name() === "preview")!
				.parseAsync(["abc123", "--switch", flag, value], { from: "user" }),
		).rejects.toThrow("exit:1");

		expect(errorSpy).toHaveBeenCalledWith(
			expect.stringContaining(expectedMessage),
		);
		expect(exitSpy).toHaveBeenCalledWith(1);
		expect(fetchMock).not.toHaveBeenCalled();
		expect(spawnSyncMock).not.toHaveBeenCalled();
	});

	it("includes explicit branch names in executable git preview plans", async () => {
		spawnSyncMock
			.mockReturnValueOnce({
				status: 0,
				stdout: GIT_LINE,
				stderr: "",
			} as any)
			.mockReturnValueOnce({ status: 1, stdout: "", stderr: "" } as any);
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

		const payload = JSON.parse(logSpy.mock.calls[0][0] as string);
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
			.mockReturnValueOnce({
				status: 0,
				stdout: GIT_LINE,
				stderr: "",
			} as any)
			.mockReturnValueOnce({ status: 0, stdout: "", stderr: "" } as any);
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
			.mockReturnValueOnce({
				status: 0,
				stdout: GIT_LINE,
				stderr: "",
			} as any)
			.mockReturnValueOnce({ status: 0, stdout: "", stderr: "" } as any);
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

		const payload = JSON.parse(logSpy.mock.calls[0][0] as string);
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

	it("creates a non-switching git branch from a tree fork", async () => {
		spawnSyncMock
			.mockReturnValueOnce({
				status: 0,
				stdout: GIT_LINE,
				stderr: "",
			} as any)
			.mockReturnValueOnce({ status: 1, stdout: "", stderr: "" } as any)
			.mockReturnValueOnce({ status: 0, stdout: "main\n", stderr: "" } as any)
			.mockReturnValueOnce({ status: 0, stdout: "", stderr: "" } as any)
			.mockReturnValueOnce({ status: 0, stdout: "main\n", stderr: "" } as any);
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
		const payload = JSON.parse(logSpy.mock.calls[0][0] as string);
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
			.mockReturnValueOnce({
				status: 0,
				stdout: GIT_LINE,
				stderr: "",
			} as any)
			.mockReturnValueOnce({ status: 1, stdout: "", stderr: "" } as any)
			.mockReturnValueOnce({ status: 0, stdout: "main\n", stderr: "" } as any)
			.mockReturnValueOnce({ status: 0, stdout: "", stderr: "" } as any)
			.mockReturnValueOnce({
				status: 0,
				stdout: "safe/fork\n",
				stderr: "",
			} as any);
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		const exitSpy = vi.spyOn(process, "exit").mockImplementation(((
			code?: string | number | null | undefined,
		) => {
			throw new Error(`exit:${code ?? 0}`);
		}) as never);

		const command = createTreeCommand();
		await expect(
			command.commands
				.find((c) => c.name() === "fork")!
				.parseAsync(["abcdef", "--scope", "git", "--name", "safe/fork"], {
					from: "user",
				}),
		).rejects.toThrow("exit:1");

		expect(errorSpy).toHaveBeenCalledWith(
			expect.stringContaining(
				'Git worktree changed from "main" to "safe/fork" during tree fork.',
			),
		);
		expect(exitSpy).toHaveBeenCalledWith(1);
	});

	it("fails closed before branch creation when current ref cannot be read", async () => {
		spawnSyncMock
			.mockReturnValueOnce({
				status: 0,
				stdout: GIT_LINE,
				stderr: "",
			} as any)
			.mockReturnValueOnce({ status: 1, stdout: "", stderr: "" } as any)
			.mockReturnValueOnce({
				status: 128,
				stdout: "",
				stderr: "fatal: ambiguous HEAD",
			} as any);
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		const exitSpy = vi.spyOn(process, "exit").mockImplementation(((
			code?: string | number | null | undefined,
		) => {
			throw new Error(`exit:${code ?? 0}`);
		}) as never);

		const command = createTreeCommand();
		await expect(
			command.commands
				.find((c) => c.name() === "fork")!
				.parseAsync(["abcdef", "--scope", "git", "--name", "safe/fork"], {
					from: "user",
				}),
		).rejects.toThrow("exit:1");

		expect(errorSpy).toHaveBeenCalledWith(
			expect.stringContaining("fatal: ambiguous HEAD"),
		);
		expect(exitSpy).toHaveBeenCalledWith(1);
		expect(spawnSyncMock).toHaveBeenCalledTimes(3);
	});

	it("switches the active git worktree with an explicit envelope", async () => {
		spawnSyncMock
			.mockReturnValueOnce({ status: 0, stdout: "", stderr: "" } as any)
			.mockReturnValueOnce({ status: 0, stdout: "main\n", stderr: "" } as any)
			.mockReturnValueOnce({ status: 0, stdout: "", stderr: "" } as any)
			.mockReturnValueOnce({
				status: 0,
				stdout: GIT_LINE,
				stderr: "",
			} as any)
			.mockReturnValueOnce({ status: 0, stdout: "", stderr: "" } as any)
			.mockReturnValueOnce({
				status: 0,
				stdout: "safe/fork\n",
				stderr: "",
			} as any);
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
		const payload = JSON.parse(logSpy.mock.calls[0][0] as string);
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
		spawnSyncMock.mockReturnValueOnce({
			status: 1,
			stdout: "",
			stderr: "",
		} as any);
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
			.mockReturnValueOnce({ status: 0, stdout: "", stderr: "" } as any)
			.mockReturnValueOnce({ status: 0, stdout: "main\n", stderr: "" } as any)
			.mockReturnValueOnce({
				status: 0,
				stdout: " M apps/refarm/src/commands/tree.ts\n",
				stderr: "",
			} as any);
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
			.mockReturnValueOnce({ status: 0, stdout: "", stderr: "" } as any)
			.mockReturnValueOnce({
				status: 0,
				stdout: "safe/fork\n",
				stderr: "",
			} as any);
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
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({
				ok: true,
				status: 200,
				json: async () => HISTORY,
			}) as any,
		);
		vi.spyOn(fs, "readFileSync")
			.mockReturnValueOnce("urn:refarm:session:v1:previous0001")
			.mockReturnValueOnce(SESSION["@id"]);
		const mkdirSpy = vi
			.spyOn(fs, "mkdirSync")
			.mockImplementation(() => undefined as any);
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
		const payload = JSON.parse(logSpy.mock.calls[0][0] as string);
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
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({
				ok: true,
				status: 200,
				json: async () => HISTORY,
			}) as any,
		);
		vi.spyOn(fs, "readFileSync")
			.mockReturnValueOnce("urn:refarm:session:v1:previous0001")
			.mockReturnValueOnce("urn:refarm:session:v1:other00000001");
		const writeSpy = vi
			.spyOn(fs, "writeFileSync")
			.mockImplementation(() => undefined);
		vi.spyOn(fs, "mkdirSync").mockImplementation(() => undefined as any);
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
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({
				ok: true,
				status: 200,
				json: async () => HISTORY,
			}) as any,
		);
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
		const exitSpy = vi.spyOn(process, "exit").mockImplementation(((
			code?: string | number | null | undefined,
		) => {
			throw new Error(`exit:${code ?? 0}`);
		}) as never);

		const command = createTreeCommand();
		await expect(
			command.commands
				.find((c) => c.name() === "switch")!
				.parseAsync(["HEAD", "--scope", "git"], { from: "user" }),
		).rejects.toThrow("exit:1");

		expect(errorSpy).toHaveBeenCalledWith(
			expect.stringContaining('Invalid branch name "HEAD"'),
		);
		expect(exitSpy).toHaveBeenCalledWith(1);
		expect(spawnSyncMock).not.toHaveBeenCalled();
	});

	it("rejects git tree forks when the branch already exists", async () => {
		spawnSyncMock
			.mockReturnValueOnce({
				status: 0,
				stdout: GIT_LINE,
				stderr: "",
			} as any)
			.mockReturnValueOnce({ status: 0, stdout: "", stderr: "" } as any);
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		const exitSpy = vi.spyOn(process, "exit").mockImplementation(((
			code?: string | number | null | undefined,
		) => {
			throw new Error(`exit:${code ?? 0}`);
		}) as never);

		const command = createTreeCommand();
		await expect(
			command.commands
				.find((c) => c.name() === "fork")!
				.parseAsync(["abcdef", "--scope", "git", "--name", "safe/fork"], {
					from: "user",
				}),
		).rejects.toThrow("exit:1");

		expect(errorSpy).toHaveBeenCalledWith(
			expect.stringContaining('Git branch "safe/fork" already exists.'),
		);
		expect(exitSpy).toHaveBeenCalledWith(1);
		expect(spawnSyncMock).toHaveBeenCalledTimes(2);
	});

	it("rejects entry selectors for git tree forks before git execution", async () => {
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		const exitSpy = vi.spyOn(process, "exit").mockImplementation(((
			code?: string | number | null | undefined,
		) => {
			throw new Error(`exit:${code ?? 0}`);
		}) as never);

		const command = createTreeCommand();
		await expect(
			command.commands
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
				),
		).rejects.toThrow("exit:1");

		expect(errorSpy).toHaveBeenCalledWith(
			expect.stringContaining("--at is only supported for session timelines"),
		);
		expect(exitSpy).toHaveBeenCalledWith(1);
		expect(spawnSyncMock).not.toHaveBeenCalled();
	});

	it("rejects entry selectors for git tree forks before branch-name validation", async () => {
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		const exitSpy = vi.spyOn(process, "exit").mockImplementation(((
			code?: string | number | null | undefined,
		) => {
			throw new Error(`exit:${code ?? 0}`);
		}) as never);

		const command = createTreeCommand();
		await expect(
			command.commands
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
				),
		).rejects.toThrow("exit:1");

		expect(errorSpy).toHaveBeenCalledWith(
			expect.stringContaining("--at is only supported for session timelines"),
		);
		expect(exitSpy).toHaveBeenCalledWith(1);
		expect(spawnSyncMock).not.toHaveBeenCalled();
	});

	it("rejects session tree forks until session execution is explicit", async () => {
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		const exitSpy = vi.spyOn(process, "exit").mockImplementation(((
			code?: string | number | null | undefined,
		) => {
			throw new Error(`exit:${code ?? 0}`);
		}) as never);

		const command = createTreeCommand();
		await expect(
			command.commands
				.find((c) => c.name() === "fork")!
				.parseAsync(["abc123", "--name", "safe/fork"], { from: "user" }),
		).rejects.toThrow("exit:1");

		expect(errorSpy).toHaveBeenCalledWith(
			expect.stringContaining(
				"refarm tree fork currently supports --scope git only",
			),
		);
		expect(exitSpy).toHaveBeenCalledWith(1);
		expect(spawnSyncMock).not.toHaveBeenCalled();
	});

	it("rejects session tree forks before branch-name validation", async () => {
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		const exitSpy = vi.spyOn(process, "exit").mockImplementation(((
			code?: string | number | null | undefined,
		) => {
			throw new Error(`exit:${code ?? 0}`);
		}) as never);

		const command = createTreeCommand();
		await expect(
			command.commands
				.find((c) => c.name() === "fork")!
				.parseAsync(["abc123", "--name", "unsafe..name"], { from: "user" }),
		).rejects.toThrow("exit:1");

		expect(errorSpy).toHaveBeenCalledWith(
			expect.stringContaining(
				"refarm tree fork currently supports --scope git only",
			),
		);
		expect(exitSpy).toHaveBeenCalledWith(1);
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
		const exitSpy = vi.spyOn(process, "exit").mockImplementation(((
			code?: string | number | null | undefined,
		) => {
			throw new Error(`exit:${code ?? 0}`);
		}) as never);

		const command = createTreeCommand();
		await expect(
			command.commands
				.find((c) => c.name() === "list")!
				.parseAsync(["--scope", "session", "--limit", limit, "--json"], {
					from: "user",
				}),
		).rejects.toThrow("exit:1");

		expect(errorSpy).toHaveBeenCalledWith(
			expect.stringContaining(`Invalid --limit "${limit}"`),
		);
		expect(exitSpy).toHaveBeenCalledWith(1);
		expect(fetchMock).not.toHaveBeenCalled();
		expect(spawnSyncMock).not.toHaveBeenCalled();
	});

	it.each([
		"0",
		"201",
		"1abc",
	])("fails closed for invalid all list limit %s", async (limit) => {
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		const exitSpy = vi.spyOn(process, "exit").mockImplementation(((
			code?: string | number | null | undefined,
		) => {
			throw new Error(`exit:${code ?? 0}`);
		}) as never);

		const command = createTreeCommand();
		await expect(
			command.commands
				.find((c) => c.name() === "list")!
				.parseAsync(["--scope", "all", "--limit", limit, "--json"], {
					from: "user",
				}),
		).rejects.toThrow("exit:1");

		expect(errorSpy).toHaveBeenCalledWith(
			expect.stringContaining(`Invalid --limit "${limit}"`),
		);
		expect(exitSpy).toHaveBeenCalledWith(1);
		expect(spawnSyncMock).not.toHaveBeenCalled();
	});

	it.each([
		"0",
		"201",
		"1abc",
	])("fails closed for invalid git list limit %s", async (limit) => {
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		const exitSpy = vi.spyOn(process, "exit").mockImplementation(((
			code?: string | number | null | undefined,
		) => {
			throw new Error(`exit:${code ?? 0}`);
		}) as never);

		const command = createTreeCommand();
		await expect(
			command.commands
				.find((c) => c.name() === "list")!
				.parseAsync(["--scope", "git", "--limit", limit, "--json"], {
					from: "user",
				}),
		).rejects.toThrow("exit:1");

		expect(errorSpy).toHaveBeenCalledWith(
			expect.stringContaining(`Invalid --limit "${limit}"`),
		);
		expect(exitSpy).toHaveBeenCalledWith(1);
		expect(spawnSyncMock).not.toHaveBeenCalled();
	});

	it("fails closed for unsupported list scopes", async () => {
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		const exitSpy = vi.spyOn(process, "exit").mockImplementation(((
			code?: string | number | null | undefined,
		) => {
			throw new Error(`exit:${code ?? 0}`);
		}) as never);

		const command = createTreeCommand();
		await expect(
			command.commands
				.find((c) => c.name() === "list")!
				.parseAsync(["--scope", "crdt"], {
					from: "user",
				}),
		).rejects.toThrow("exit:1");

		expect(errorSpy).toHaveBeenCalledWith(
			expect.stringContaining("--scope session|git|all"),
		);
		expect(exitSpy).toHaveBeenCalledWith(1);
	});

	it.each([
		["show", ["abc123", "--scope", "all"]],
		["preview", ["abc123", "--scope", "all"]],
		["fork", ["abc123", "--scope", "all", "--name", "safe/fork"]],
		["switch", ["abc123", "--scope", "all"]],
	] as const)("rejects all scope outside read-only list for %s", async (commandName, args) => {
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		const exitSpy = vi.spyOn(process, "exit").mockImplementation(((
			code?: string | number | null | undefined,
		) => {
			throw new Error(`exit:${code ?? 0}`);
		}) as never);

		const command = createTreeCommand();
		await expect(
			command.commands
				.find((c) => c.name() === commandName)!
				.parseAsync([...args], { from: "user" }),
		).rejects.toThrow("exit:1");

		expect(errorSpy).toHaveBeenCalledWith(
			expect.stringContaining("--scope session|git for this operation"),
		);
		expect(exitSpy).toHaveBeenCalledWith(1);
	});
});
