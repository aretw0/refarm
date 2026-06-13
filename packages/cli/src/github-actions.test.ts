import { spawnSync } from "node:child_process";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setGitHubActionsSecret } from "./github-actions.js";

vi.mock("node:child_process", () => ({
	spawnSync: vi.fn(),
}));

const spawnSyncMock = vi.mocked(spawnSync);

describe("github actions cli helpers", () => {
	beforeEach(() => {
		spawnSyncMock.mockReset();
	});

	it("writes a GitHub Actions secret through gh stdin", () => {
		spawnSyncMock.mockReturnValueOnce({
			status: 0,
			stdout: "",
			stderr: "",
		} as ReturnType<typeof spawnSync>);

		setGitHubActionsSecret("TURBO_CACHE_TOKEN", "secret-value");

		expect(spawnSyncMock).toHaveBeenCalledWith(
			"gh",
			["secret", "set", "TURBO_CACHE_TOKEN"],
			{
				cwd: undefined,
				input: "secret-value",
				encoding: "utf-8",
				stdio: ["pipe", "pipe", "pipe"],
			},
		);
	});

	it("surfaces stderr from gh failures", () => {
		spawnSyncMock.mockReturnValueOnce({
			status: 1,
			stdout: "",
			stderr: "not authenticated",
		} as ReturnType<typeof spawnSync>);

		expect(() => setGitHubActionsSecret("TOKEN", "value")).toThrow(
			"not authenticated",
		);
	});
});
