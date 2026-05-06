import { describe, expect, it, vi } from "vitest";
import {
	openHostBrowserUrl,
	resolveBrowserOpenCandidates,
	resolveBrowserOpenSpec,
} from "../../src/commands/browser-open.js";

describe("resolveBrowserOpenSpec", () => {
	it("maps browser opener command by platform", () => {
		expect(resolveBrowserOpenSpec("http://localhost:4321", "darwin")).toEqual(
			expect.objectContaining({
				command: "open",
				args: ["http://localhost:4321"],
			}),
		);
		expect(resolveBrowserOpenSpec("http://localhost:4321", "win32")).toEqual(
			expect.objectContaining({
				command: "cmd",
				args: ["/c", "start", "", "http://localhost:4321"],
			}),
		);
		expect(resolveBrowserOpenSpec("http://localhost:4321", "linux")).toEqual(
			expect.objectContaining({
				command: "xdg-open",
				args: ["http://localhost:4321"],
			}),
		);
	});
});

describe("resolveBrowserOpenCandidates", () => {
	it("prioritizes VS Code and WSL helpers in devcontainer-like environments", () => {
		const candidates = resolveBrowserOpenCandidates("https://github.com/login/device", {
			platform: "linux",
			env: {
				TERM_PROGRAM: "vscode",
				WSL_DISTRO_NAME: "Ubuntu",
			},
		});

		expect(candidates.map((candidate) => candidate.command)).toEqual([
			"code",
			"wslview",
			"xdg-open",
			"x-www-browser",
			"www-browser",
		]);
	});

	it("allows an explicit REFARM_BROWSER_OPEN_COMMAND override", () => {
		const candidates = resolveBrowserOpenCandidates("https://example.test/auth", {
			platform: "linux",
			env: {
				REFARM_BROWSER_OPEN_COMMAND: "custom-open --flag",
			},
		});

		expect(candidates[0]).toEqual({
			command: "custom-open",
			args: ["--flag", "https://example.test/auth"],
			display: "custom-open --flag https://example.test/auth",
		});
	});
});

describe("openHostBrowserUrl", () => {
	it("tries candidates until one succeeds", async () => {
		const run = vi
			.fn()
			.mockRejectedValueOnce(new Error("missing"))
			.mockResolvedValueOnce(undefined);

		const result = await openHostBrowserUrl("https://example.test/auth", {
			platform: "linux",
			env: { TERM_PROGRAM: "vscode" },
			run,
		});

		expect(run).toHaveBeenCalledTimes(2);
		expect(result.candidate.command).toBe("xdg-open");
	});

	it("returns a manual fallback message when every opener fails", async () => {
		await expect(
			openHostBrowserUrl("https://example.test/auth", {
				platform: "linux",
				env: {},
				run: vi.fn().mockRejectedValue(new Error("not found")),
			}),
		).rejects.toThrow(/Open this URL manually: https:\/\/example\.test\/auth/);
	});
});
