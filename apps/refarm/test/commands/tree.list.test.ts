import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:child_process", () => ({
	spawnSync: vi.fn(),
}));

import { spawnSync } from "node:child_process";
import { createTreeCommand } from "../../src/commands/tree.js";
import {
	GIT_LINE,
	makeJsonFetch,
	makeSpawnResult,
	OLDER_SESSION,
	SAME_TIMESTAMP_GIT_LINE,
	SESSION,
} from "./tree.fixtures.js";

const spawnSyncMock = vi.mocked(spawnSync);

describe("refarm tree list", () => {
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

		expect(previewHelp).toContain("<target>");
		expect(previewHelp).toContain(
			"Session ID/prefix, git commit, or git branch",
		);
		expect(previewHelp).toContain("--switch");
		expect(previewHelp).toContain(
			"Preview switching to an existing session or git branch",
		);
	});

	it("describes list scope and limits without assuming git-only nodes", () => {
		const command = createTreeCommand();
		const listHelp = command.commands
			.find((c) => c.name() === "list")!
			.helpInformation();

		expect(listHelp).toContain("Timeline scope: session, git, or all");
		expect(listHelp).toContain("--limit <count>");
		expect(listHelp).toContain("Maximum timeline nodes to list");
		expect(listHelp).not.toContain("Maximum git commits");
	});

	it("describes non-list scopes without advertising all-scope mutation", () => {
		const command = createTreeCommand();
		for (const commandName of ["show", "preview", "switch"]) {
			const help = command.commands
				.find((c) => c.name() === commandName)!
				.helpInformation();
			expect(help).toContain("Timeline scope: session or git");
			expect(help).not.toContain("session, git, or all");
		}
	});

	it("describes tree fork as git-only execution", () => {
		const command = createTreeCommand();
		const forkHelp = command.commands
			.find((c) => c.name() === "fork")!
			.helpInformation();

		expect(forkHelp).toContain("Create an explicit non-switching git fork");
		expect(forkHelp).toContain("<commit>");
		expect(forkHelp).toContain("Git commit-ish to fork from");
		expect(forkHelp).toContain("Timeline scope: git for tree fork");
		expect(forkHelp).toContain("use refarm sessions");
		expect(forkHelp).toContain("fork for sessions");
		expect(forkHelp).not.toContain("session, git, or all");
		expect(forkHelp).not.toContain('(default: "session")');
	});

	it("lists session timeline nodes as renderer-independent JSON", async () => {
		vi.stubGlobal("fetch", makeJsonFetch({ sessions: [SESSION] }));
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		const command = createTreeCommand();
		await command.commands
			.find((c) => c.name() === "list")!
			.parseAsync(["--json"], {
				from: "user",
			});

		const payload = JSON.parse(logSpy.mock.calls[0]![0] as string);
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
		const fetchMock = makeJsonFetch({ sessions: [OLDER_SESSION, SESSION] });
		vi.stubGlobal("fetch", fetchMock);
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		const command = createTreeCommand();
		await command.commands
			.find((c) => c.name() === "list")!
			.parseAsync(["--limit", "1", "--json"], { from: "user" });

		expect(fetchMock).toHaveBeenCalledWith(
			"http://127.0.0.1:42001/sessions?limit=1",
		);
		const payload = JSON.parse(logSpy.mock.calls[0]![0] as string);
		expect(payload.nodes).toHaveLength(1);
		expect(payload.nodes[0]).toMatchObject({
			kind: "session",
			nodeId: SESSION["@id"],
		});
	});

	it("lists session timeline switch affordances in human output", async () => {
		vi.stubGlobal("fetch", makeJsonFetch({ sessions: [SESSION] }));
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
		spawnSyncMock.mockReturnValue(makeSpawnResult(0, GIT_LINE));
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		const command = createTreeCommand();
		await command.commands
			.find((c) => c.name() === "list")!
			.parseAsync(["--scope", "git", "--limit", "1", "--json"], {
				from: "user",
			});

		expect(spawnSyncMock).toHaveBeenCalledWith(
			"git",
			expect.arrayContaining(["log", "--max-count=1"]),
			{
				encoding: "utf8",
			},
		);
		const payload = JSON.parse(logSpy.mock.calls[0]![0] as string);
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
		vi.stubGlobal("fetch", makeJsonFetch({ sessions: [SESSION] }));
		spawnSyncMock.mockReturnValue(makeSpawnResult(0, GIT_LINE));
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		const command = createTreeCommand();
		await command.commands
			.find((c) => c.name() === "list")!
			.parseAsync(["--scope", "all", "--limit", "2", "--json"], {
				from: "user",
			});

		const payload = JSON.parse(logSpy.mock.calls[0]![0] as string);
		expect(payload).toMatchObject({
			schemaVersion: 1,
			command: "tree",
			scope: "all",
			operation: "list",
		});
		expect(payload).not.toHaveProperty("target");
		expect(payload).not.toHaveProperty("plan");
		expect(payload).not.toHaveProperty("result");
		expect(payload).not.toHaveProperty("reason");
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
		const fetchMock = makeJsonFetch({ sessions: [SESSION] });
		vi.stubGlobal("fetch", fetchMock);
		spawnSyncMock.mockReturnValue(makeSpawnResult(0, GIT_LINE));
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		const command = createTreeCommand();
		await command.commands
			.find((c) => c.name() === "list")!
			.parseAsync(["--scope", "all", "--limit", "1", "--json"], {
				from: "user",
			});

		expect(fetchMock).toHaveBeenCalledWith(
			"http://127.0.0.1:42001/sessions?limit=1",
		);
		expect(spawnSyncMock).toHaveBeenCalledWith(
			"git",
			expect.arrayContaining(["log", "--max-count=1"]),
			{
				encoding: "utf8",
			},
		);
		const payload = JSON.parse(logSpy.mock.calls[0]![0] as string);
		expect(payload.nodes).toHaveLength(1);
		expect(payload.nodes[0]).toMatchObject({
			kind: "git",
			nodeId: "abcdef1234567890abcdef1234567890abcdef12",
		});
	});

	it("orders all-scope timeline ties deterministically", async () => {
		vi.stubGlobal("fetch", makeJsonFetch({ sessions: [SESSION] }));
		spawnSyncMock.mockReturnValue(makeSpawnResult(0, SAME_TIMESTAMP_GIT_LINE));
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		const command = createTreeCommand();
		await command.commands
			.find((c) => c.name() === "list")!
			.parseAsync(["--scope", "all", "--limit", "2", "--json"], {
				from: "user",
			});

		const payload = JSON.parse(logSpy.mock.calls[0]![0] as string);
		expect(payload.nodes.map((node: { kind: string }) => node.kind)).toEqual([
			"git",
			"session",
		]);
	});

	it("lists all timeline nodes in human output", async () => {
		vi.stubGlobal("fetch", makeJsonFetch({ sessions: [SESSION] }));
		spawnSyncMock.mockReturnValue(makeSpawnResult(0, GIT_LINE));
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
		vi.stubGlobal("fetch", makeJsonFetch({ sessions: [] }));
		spawnSyncMock.mockReturnValue(makeSpawnResult(0));
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
		spawnSyncMock.mockReturnValue(makeSpawnResult(0, GIT_LINE));
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
			expect.stringContaining("refarm doctor"),
		);
		expect(exitSpy).toHaveBeenCalledWith(1);
	});

	it("lists git tree execution affordances in human output", async () => {
		spawnSyncMock.mockReturnValue(makeSpawnResult(0, GIT_LINE));
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

	it("lists a root git commit without a parent node ID", async () => {
		const rootCommitLine = [
			"deadbeef1234567890deadbeef1234567890dead",
			"",
			"HEAD -> main",
			"2026-01-01T00:00:00Z",
			"initial commit",
		].join("\x1f");
		spawnSyncMock.mockReturnValue(makeSpawnResult(0, rootCommitLine));
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		const command = createTreeCommand();
		await command.commands
			.find((c) => c.name() === "list")!
			.parseAsync(["--scope", "git", "--limit", "1", "--json"], {
				from: "user",
			});

		const payload = JSON.parse(logSpy.mock.calls[0]![0] as string);
		expect(payload.nodes[0]).toMatchObject({
			nodeId: "deadbeef1234567890deadbeef1234567890dead",
			kind: "git",
			label: "initial commit",
		});
		expect(payload.nodes[0].parentNodeId).toBeUndefined();
	});

	it("sorts all-scope timeline nodes with distinct timestamps newest-first", async () => {
		const newerGitLine = [
			"abcdef1234567890abcdef1234567890abcdef12",
			"1111111111111111111111111111111111111111",
			"HEAD -> main",
			"2026-05-08T00:00:00Z",
			"newer commit",
		].join("\x1f");
		vi.stubGlobal("fetch", makeJsonFetch({ sessions: [OLDER_SESSION] }));
		spawnSyncMock.mockReturnValue(makeSpawnResult(0, newerGitLine));
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		const command = createTreeCommand();
		await command.commands
			.find((c) => c.name() === "list")!
			.parseAsync(["--scope", "all", "--limit", "2", "--json"], {
				from: "user",
			});

		const payload = JSON.parse(logSpy.mock.calls[0]![0] as string);
		expect(payload.nodes).toHaveLength(2);
		expect(payload.nodes[0]).toMatchObject({ kind: "git" });
		expect(payload.nodes[1]).toMatchObject({ kind: "session" });
	});

	it("shows git error without sidecar guidance for all-scope git failures", async () => {
		vi.stubGlobal("fetch", makeJsonFetch({ sessions: [] }));
		spawnSyncMock.mockReturnValue(
			makeSpawnResult(128, "", "fatal: not a git repository"),
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
				.find((c) => c.name() === "list")!
				.parseAsync(["--scope", "all", "--json"], { from: "user" }),
		).rejects.toThrow("exit:1");

		expect(errorSpy).not.toHaveBeenCalledWith(
			expect.stringContaining("farmhand sidecar"),
		);
		expect(errorSpy).toHaveBeenCalledWith(
			expect.stringContaining("not a git repository"),
		);
		expect(exitSpy).toHaveBeenCalledWith(1);
	});
});
