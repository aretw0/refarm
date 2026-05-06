import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTreeCommand } from "../../src/commands/tree.js";

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
		await command.commands.find((c) => c.name() === "list")!.parseAsync(["--json"], {
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

	it("shows a session timeline node with entries", async () => {
		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			status: 200,
			json: async () => HISTORY,
		});
		vi.stubGlobal("fetch", fetchMock as any);
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		const command = createTreeCommand();
		await command.commands.find((c) => c.name() === "show")!.parseAsync(["abc123", "--json"], {
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
		await command.commands.find((c) => c.name() === "preview")!.parseAsync(["abc123", "--json"], {
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
				recommendedCommand: "refarm sessions fork abc123def456 --name <branch-name>",
			},
		});
	});

	it("fails closed for unsupported scopes", async () => {
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		const exitSpy = vi
			.spyOn(process, "exit")
			.mockImplementation(((code?: string | number | null | undefined) => {
				throw new Error(`exit:${code ?? 0}`);
			}) as never);

		const command = createTreeCommand();
		await expect(
			command.commands.find((c) => c.name() === "list")!.parseAsync(["--scope", "git"], {
				from: "user",
			}),
		).rejects.toThrow("exit:1");

		expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("--scope session only"));
		expect(exitSpy).toHaveBeenCalledWith(1);
	});
});
