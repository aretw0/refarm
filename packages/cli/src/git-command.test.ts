import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	readGitCommand,
	runGitCommand,
} from "./git-command.js";

vi.mock("node:child_process", () => ({
	spawnSync: vi.fn(),
}));

const spawnSyncMock = vi.mocked(spawnSync);

describe("git command helpers", () => {
	afterEach(() => {
		vi.clearAllMocks();
	});

	it("runs git commands with string output", () => {
		spawnSyncMock.mockReturnValueOnce({
			status: 0,
			stdout: "develop\n",
			stderr: "",
			output: [],
			pid: 0,
			signal: null,
		});

		expect(runGitCommand(["rev-parse", "--abbrev-ref", "HEAD"])).toEqual({
			status: 0,
			stdout: "develop\n",
			stderr: "",
		});
		expect(spawnSyncMock).toHaveBeenCalledWith(
			"git",
			["rev-parse", "--abbrev-ref", "HEAD"],
			{ encoding: "utf8" },
		);
	});

	it("reads trimmed stdout and throws with stderr details on failure", () => {
		spawnSyncMock
			.mockReturnValueOnce({
				status: 0,
				stdout: "main\n",
				stderr: "",
				output: [],
				pid: 0,
				signal: null,
			})
			.mockReturnValueOnce({
				status: 128,
				stdout: "",
				stderr: "fatal: not a git repository\n",
				output: [],
				pid: 0,
				signal: null,
			});

		expect(readGitCommand(["branch", "--show-current"])).toBe("main");
		expect(() => readGitCommand(["status"])).toThrow(
			/fatal: not a git repository/,
		);
	});
});
