import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockSow, mockInquirerPrompt, mockGithubCollect, mockCloudflareCollect } =
	vi.hoisted(() => ({
		mockSow: vi.fn().mockResolvedValue({
			storagePath: "/home/user/.refarm/identity.json",
			github: { ok: true, count: 3 },
			cloudflare: { ok: true },
		}),
		mockInquirerPrompt: vi.fn(),
		mockGithubCollect: vi.fn().mockResolvedValue("gho_test_github"),
		mockCloudflareCollect: vi.fn().mockResolvedValue("cf_test_cloudflare"),
	}));

vi.mock("inquirer", () => ({ default: { prompt: mockInquirerPrompt } }));

vi.mock("../../src/credentials/index.js", () => ({
	githubCredentialProvider: {
		id: "github",
		label: "GitHub",
		collect: mockGithubCollect,
	},
	cloudflareCredentialProvider: {
		id: "cloudflare",
		label: "Cloudflare",
		collect: mockCloudflareCollect,
	},
}));

vi.mock("@refarm.dev/sower", () => ({
	SowerCore: vi.fn().mockImplementation(function () {
		return { sow: mockSow };
	}),
}));

import { sowCommand } from "../../src/commands/sow.js";

describe("sowCommand", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockInquirerPrompt.mockResolvedValueOnce({ owner: "refarm-dev" });
		mockGithubCollect.mockResolvedValue("gho_test_github");
		mockCloudflareCollect.mockResolvedValue("cf_test_cloudflare");
	});

	it("calls sower.sow with tokens collected from each provider", async () => {
		await sowCommand.parseAsync([], { from: "user" });
		expect(mockSow).toHaveBeenCalledWith(
			expect.objectContaining({
				githubToken: "gho_test_github",
				cloudflareToken: "cf_test_cloudflare",
			}),
			expect.objectContaining({ owner: "refarm-dev" }),
		);
	});

	it("collects credentials from each provider in order", async () => {
		await sowCommand.parseAsync([], { from: "user" });
		expect(mockGithubCollect).toHaveBeenCalledOnce();
		expect(mockCloudflareCollect).toHaveBeenCalledOnce();
	});

	it("passes tryOpenUrl context to each provider", async () => {
		await sowCommand.parseAsync([], { from: "user" });
		expect(mockGithubCollect).toHaveBeenCalledWith(
			expect.objectContaining({ tryOpenUrl: expect.any(Function) }),
		);
		expect(mockCloudflareCollect).toHaveBeenCalledWith(
			expect.objectContaining({ tryOpenUrl: expect.any(Function) }),
		);
	});

	it("exits gracefully on SIGINT (ExitPromptError)", async () => {
		const { ExitPromptError } = await import("@inquirer/core");
		mockInquirerPrompt.mockReset();
		mockInquirerPrompt.mockRejectedValueOnce(
			new ExitPromptError("User force closed the prompt with SIGINT"),
		);
		const exitSpy = vi
			.spyOn(process, "exit")
			.mockImplementation((() => {}) as () => never);
		await sowCommand.parseAsync([], { from: "user" });
		expect(exitSpy).toHaveBeenCalledWith(0);
		exitSpy.mockRestore();
	});
});
