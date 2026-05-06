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

describe("refarm tree", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		process.exitCode = undefined;
	});

	afterEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
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
				kind: "session-fork",
				destructive: false,
				branchPointEntryId: "entry-2",
				recommendedCommand:
					"refarm sessions fork abc123def456 --at entry-2 --name <branch-name>",
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
				kind: "session-fork",
				destructive: false,
				branchPointEntryId: "entry-1",
				recommendedCommand:
					"refarm sessions fork abc123def456 --at entry-1 --name <branch-name>",
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
		expect(payload.plan.recommendedCommand).toBe(
			"refarm sessions fork abc123def456 --at entry-1 --name safe/fork",
		);
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
		"safe/.hidden",
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
				kind: "git-branch",
				destructive: false,
				worktreeSwitched: false,
				baseCommit: "abcdef1234567890abcdef1234567890abcdef12",
				recommendedCommand:
					"refarm tree fork --scope git abcdef123456 --name <branch-name>",
			},
		});
	});

	it("includes explicit branch names in git preview plans", async () => {
		spawnSyncMock.mockReturnValue({
			status: 0,
			stdout: GIT_LINE,
			stderr: "",
		} as any);
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
		expect(payload.plan.worktreeSwitched).toBe(false);
		expect(payload.plan.recommendedCommand).toBe(
			"refarm tree fork --scope git abcdef123456 --name safe/fork",
		);
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
			.mockReturnValueOnce({ status: 0, stdout: "safe/fork\n", stderr: "" } as any);
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

	it("fails closed for unsupported scopes", async () => {
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
			expect.stringContaining("--scope session|git"),
		);
		expect(exitSpy).toHaveBeenCalledWith(1);
	});
});
