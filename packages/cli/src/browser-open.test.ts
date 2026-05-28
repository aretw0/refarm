import { describe, expect, it, vi } from "vitest";
import {
	BROWSER_OPEN_COMMAND_ENV_VAR,
	LEGACY_BROWSER_OPEN_COMMAND_ENV_VAR,
	openHostBrowserUrl,
	resolveBrowserOpenCandidates,
	resolveBrowserOpenSpec,
	splitBrowserOpenCommand,
} from "./browser-open.js";

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
	it("prioritizes VS Code server openExternal and WSL helpers in devcontainer-like environments", () => {
		const candidates = resolveBrowserOpenCandidates(
			"https://github.com/login/device",
			{
				platform: "linux",
				env: {
					TERM_PROGRAM: "vscode",
					WSL_DISTRO_NAME: "Ubuntu",
				},
			},
		);

		expect(candidates.map((candidate) => candidate.command)).toEqual([
			"sh",
			"wslview",
			"xdg-open",
			"sensible-browser",
			"x-www-browser",
			"www-browser",
		]);
		expect(candidates[0]?.display).toContain("VS Code server openExternal");
	});

	it("does not use code --open-url as an implicit Linux fallback", () => {
		const candidates = resolveBrowserOpenCandidates(
			"https://example.test/auth",
			{
				platform: "linux",
				env: {},
			},
		);

		expect(candidates).not.toContainEqual(
			expect.objectContaining({
				command: "code",
				args: ["--open-url", "https://example.test/auth"],
			}),
		);
	});

	it("allows an explicit BROWSER_OPEN_COMMAND override", () => {
		const candidates = resolveBrowserOpenCandidates(
			"https://example.test/auth",
			{
				platform: "linux",
				env: {
					[BROWSER_OPEN_COMMAND_ENV_VAR]: "custom-open --flag",
				},
			},
		);

		expect(candidates[0]).toEqual({
			command: "custom-open",
			args: ["--flag", "https://example.test/auth"],
			display: "custom-open --flag https://example.test/auth",
		});
	});

	it("keeps quoted BROWSER_OPEN_COMMAND words intact", () => {
		const candidates = resolveBrowserOpenCandidates(
			"https://example.test/auth",
			{
				platform: "linux",
				env: {
					[BROWSER_OPEN_COMMAND_ENV_VAR]:
						"\"/mnt/c/Program Files/Browser/open.exe\" --profile \"Refarm Dev\"",
				},
			},
		);

		expect(candidates[0]).toEqual({
			command: "/mnt/c/Program Files/Browser/open.exe",
			args: ["--profile", "Refarm Dev", "https://example.test/auth"],
			display:
				"\"/mnt/c/Program Files/Browser/open.exe\" --profile \"Refarm Dev\" https://example.test/auth",
		});
	});

	it("keeps REFARM_BROWSER_OPEN_COMMAND as a legacy override", () => {
		const candidates = resolveBrowserOpenCandidates(
			"https://example.test/auth",
			{
				platform: "linux",
				env: {
					[LEGACY_BROWSER_OPEN_COMMAND_ENV_VAR]: "legacy-open --flag",
				},
			},
		);

		expect(candidates[0]).toEqual({
			command: "legacy-open",
			args: ["--flag", "https://example.test/auth"],
			display: "legacy-open --flag https://example.test/auth",
		});
	});

	it("prefers BROWSER_OPEN_COMMAND over the legacy Refarm override", () => {
		const candidates = resolveBrowserOpenCandidates(
			"https://example.test/auth",
			{
				platform: "linux",
				env: {
					[BROWSER_OPEN_COMMAND_ENV_VAR]: "generic-open",
					[LEGACY_BROWSER_OPEN_COMMAND_ENV_VAR]: "legacy-open",
				},
			},
		);

		expect(candidates[0]).toEqual({
			command: "generic-open",
			args: ["https://example.test/auth"],
			display: "generic-open https://example.test/auth",
		});
	});
});

describe("splitBrowserOpenCommand", () => {
	it("supports quotes and escaped spaces", () => {
		expect(splitBrowserOpenCommand("custom\\ open --profile 'Refarm Dev'")).toEqual([
			"custom open",
			"--profile",
			"Refarm Dev",
		]);
	});

	it("rejects unterminated quotes", () => {
		expect(() => splitBrowserOpenCommand("custom-open 'broken")).toThrow(
			/Unterminated quote/,
		);
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
