import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockLoadTokens, mockSetGitHubActionsSecret, mockSiloCore } = vi.hoisted(
	() => {
		const mockLoadTokens = vi.fn();
		const mockSetGitHubActionsSecret = vi.fn();
		return {
			mockLoadTokens,
			mockSetGitHubActionsSecret,
			mockSiloCore: vi.fn().mockImplementation(function () {
				return { loadTokens: mockLoadTokens };
			}),
		};
	},
);

vi.mock("@refarm.dev/cli/github-actions", () => ({
	setGitHubActionsSecret: mockSetGitHubActionsSecret,
}));

vi.mock("@refarm.dev/silo", () => ({
	SiloCore: mockSiloCore,
}));

import { configureCommand } from "../../src/commands/configure.js";

describe("configure command", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		process.exitCode = undefined;
	});

	it("writes available silo credentials to GitHub Actions secrets", async () => {
		mockLoadTokens.mockResolvedValue({
			githubToken: "ghp_testtoken",
			cloudflareToken: "cf_testtoken",
		});
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		await configureCommand.parseAsync(["github"], { from: "user" });

		expect(mockSetGitHubActionsSecret).toHaveBeenCalledTimes(3);
		expect(mockSetGitHubActionsSecret).toHaveBeenCalledWith(
			"GITHUB_TOKEN",
			"ghp_testtoken",
		);
		expect(mockSetGitHubActionsSecret).toHaveBeenCalledWith(
			"GH_TOKEN",
			"ghp_testtoken",
		);
		expect(mockSetGitHubActionsSecret).toHaveBeenCalledWith(
			"CLOUDFLARE_API_TOKEN",
			"cf_testtoken",
		);
		expect(errorSpy).not.toHaveBeenCalled();
		expect(logSpy).toHaveBeenCalledWith(
			expect.stringContaining("Wrote GitHub Actions secrets"),
		);

		logSpy.mockRestore();
		errorSpy.mockRestore();
	});

	it("reports JSON success payload for --json", async () => {
		mockLoadTokens.mockResolvedValue({ githubToken: "ghp_testtoken" });
		const logs: string[] = [];
		const logSpy = vi.spyOn(console, "log").mockImplementation((value) => {
			logs.push(String(value));
		});
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		await configureCommand.parseAsync(["github", "--json"], { from: "user" });

		expect(errorSpy).not.toHaveBeenCalled();
		const payload = JSON.parse(logs.join("\n"));
		expect(payload).toMatchObject({
			ok: true,
			command: "configure",
			operation: "github",
			target: "github",
			schemaVersion: 1,
			written: [
				{ secret: "GITHUB_TOKEN", source: "GitHub token" },
				{ secret: "GH_TOKEN", source: "GitHub token alias" },
			],
			skipped: ["Cloudflare API token"],
			nextCommand: "gh secret list",
		});

		logSpy.mockRestore();
		errorSpy.mockRestore();
	});

	it("fails when no relevant credentials exist", async () => {
		mockLoadTokens.mockResolvedValue({});
		const logs: string[] = [];
		const logSpy = vi.spyOn(console, "log").mockImplementation((value) => {
			logs.push(String(value));
		});
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		await configureCommand.parseAsync(["github", "--json"], { from: "user" });

		expect(mockSetGitHubActionsSecret).not.toHaveBeenCalled();
		expect(errorSpy).not.toHaveBeenCalled();
		const payload = JSON.parse(logs.join("\n"));
		expect(payload).toMatchObject({
			ok: false,
			error: "missing-credentials",
			nextCommand: "refarm sow --github --json",
		});
		expect(process.exitCode).toBe(1);

		logSpy.mockRestore();
		errorSpy.mockRestore();
	});

	it("reports failure when gh secret set fails", async () => {
		mockLoadTokens.mockResolvedValue({ githubToken: "ghp_testtoken" });
		mockSetGitHubActionsSecret.mockImplementation(() => {
			throw new Error("not authenticated");
		});
		const logs: string[] = [];
		const logSpy = vi.spyOn(console, "log").mockImplementation((value) => {
			logs.push(String(value));
		});
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		await configureCommand.parseAsync(["github", "--json"], { from: "user" });

		expect(errorSpy).not.toHaveBeenCalled();
		const payload = JSON.parse(logs.join("\n"));
		expect(payload).toMatchObject({
			ok: false,
			error: "github-secret-write-failed",
			nextAction: "gh auth status",
			nextCommand: "gh auth status",
		});
		expect(process.exitCode).toBe(1);

		logSpy.mockRestore();
		errorSpy.mockRestore();
	});
});
