import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:child_process", () => ({
	spawnSync: vi.fn(),
}));

import { spawnSync } from "node:child_process";
import { createTreeCommand } from "../../src/commands/tree.js";
import { GIT_LINE, HISTORY, SESSION } from "./tree.fixtures.js";

const spawnSyncMock = vi.mocked(spawnSync);

describe("refarm tree show", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		process.exitCode = undefined;
	});

	afterEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
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

});
