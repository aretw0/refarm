import fs from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:child_process", () => ({
	spawnSync: vi.fn(),
}));

import { spawnSync } from "node:child_process";
import { createTreeCommand } from "../../src/commands/tree.js";
import { HISTORY, SESSION } from "./tree.fixtures.js";

const spawnSyncMock = vi.mocked(spawnSync);

function jsonResponse(data: unknown, status = 200): Response {
	return {
		ok: status >= 200 && status < 300,
		status,
		json: async () => data,
	} as Response;
}

async function runTreeSubcommand(
	name: "list" | "show" | "preview",
	args: string[],
): Promise<void> {
	const command = createTreeCommand();
	const subcommand = command.commands.find((candidate) => candidate.name() === name);
	expect(subcommand).toBeDefined();
	await subcommand!.parseAsync(args, { from: "user" });
}

describe("refarm tree session reference driver contract", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		process.exitCode = undefined;
	});

	afterEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
		process.exitCode = undefined;
	});

	it("walks list, show, and switch preview without provider or git execution", async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(jsonResponse({ sessions: [SESSION] }))
			.mockResolvedValueOnce(jsonResponse(HISTORY))
			.mockResolvedValueOnce(jsonResponse(HISTORY));
		vi.stubGlobal("fetch", fetchMock);
		vi.spyOn(fs, "readFileSync").mockImplementation(() => {
			throw new Error("no active session");
		});
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await runTreeSubcommand("list", ["--scope", "session", "--json"]);
		await runTreeSubcommand("show", ["abc123", "--json"]);
		await runTreeSubcommand("preview", ["abc123", "--switch", "--json"]);

		const listPayload = JSON.parse(String(logSpy.mock.calls[0]![0]));
		const showPayload = JSON.parse(String(logSpy.mock.calls[1]![0]));
		const previewPayload = JSON.parse(String(logSpy.mock.calls[2]![0]));

		expect(fetchMock).toHaveBeenNthCalledWith(
			1,
			"http://127.0.0.1:42001/sessions?limit=20",
			expect.any(Object),
		);
		expect(fetchMock).toHaveBeenNthCalledWith(
			2,
			"http://127.0.0.1:42001/sessions/abc123/history",
			expect.any(Object),
		);
		expect(fetchMock).toHaveBeenNthCalledWith(
			3,
			"http://127.0.0.1:42001/sessions/abc123/history",
			expect.any(Object),
		);
		expect(spawnSyncMock).not.toHaveBeenCalled();
		expect(process.exitCode).toBeUndefined();

		expect(listPayload).toMatchObject({
			schemaVersion: 1,
			command: "tree",
			scope: "session",
			operation: "list",
			nextAction: null,
			nextCommand: null,
			nodes: [
				{
					kind: "session",
					nodeId: SESSION["@id"],
					metadata: {
						shortId: "abc123def456",
						hasHistory: true,
					},
				},
			],
		});
		expect(showPayload).toMatchObject({
			schemaVersion: 1,
			command: "tree",
			scope: "session",
			operation: "show",
			nextAction: "refarm resume --json",
			nextCommand: "refarm resume --json",
			node: {
				kind: "session",
				nodeId: SESSION["@id"],
			},
			total: 2,
		});
		expect(previewPayload).toMatchObject({
			schemaVersion: 1,
			command: "tree",
			scope: "session",
			operation: "preview",
			nextAction: "refarm tree switch abc123def456",
			nextCommand: "refarm tree switch abc123def456",
			plan: {
				action: "switch",
				destructive: false,
				readyToExecute: true,
				recommendedCommand: "refarm tree switch abc123def456",
				substrate: {
					kind: "session-switch",
					targetSessionIdAfter: SESSION["@id"],
					activeSessionWillSwitch: true,
				},
			},
		});
	});
});
