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
			command: "tree",
			scope: "session",
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
			command: "tree",
			scope: "git",
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
			command: "tree",
			scope: "session",
			operation: "preview",
			reason: "dry-run",
			plan: {
				kind: "session-fork",
				destructive: false,
				branchPointEntryId: "entry-2",
				recommendedCommand:
					"refarm sessions fork abc123def456 --name <branch-name>",
			},
		});
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
			command: "tree",
			scope: "git",
			operation: "preview",
			reason: "dry-run",
			plan: {
				kind: "git-branch",
				destructive: false,
				baseCommit: "abcdef1234567890abcdef1234567890abcdef12",
				recommendedCommand: "git switch -c <branch-name> abcdef123456",
			},
		});
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
