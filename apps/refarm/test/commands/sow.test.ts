import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockSow, mockInquirerPrompt } = vi.hoisted(() => ({
	mockSow: vi.fn().mockResolvedValue({
		storagePath: "/home/user/.refarm/identity.json",
		github: { ok: true, count: 3 },
		cloudflare: { ok: true },
	}),
	mockInquirerPrompt: vi.fn(),
}));

vi.mock("inquirer", () => ({ default: { prompt: mockInquirerPrompt } }));

vi.mock("@refarm.dev/sower", () => ({
	SowerCore: vi.fn().mockImplementation(function () {
		return { sow: mockSow };
	}),
}));

vi.mock("@refarm.dev/silo", () => ({
	SiloCore: vi.fn().mockImplementation(function () {
		return {};
	}),
}));

vi.mock("@refarm.dev/windmill", () => ({
	Windmill: vi.fn().mockImplementation(function () {
		return {};
	}),
}));

import { sowCommand } from "../../src/commands/sow.js";

describe("sowCommand", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		// Three separate prompt calls: owner, githubToken, cloudflareToken
		mockInquirerPrompt
			.mockResolvedValueOnce({ owner: "refarm-dev" })
			.mockResolvedValueOnce({ githubToken: "ghp_test" })
			.mockResolvedValueOnce({ cloudflareToken: "cf_test" });
	});

	it("calls sower.sow with tokens from prompts", async () => {
		await sowCommand.parseAsync([], { from: "user" });
		expect(mockSow).toHaveBeenCalledWith(
			expect.objectContaining({
				githubToken: "ghp_test",
				cloudflareToken: "cf_test",
			}),
			expect.objectContaining({ owner: "refarm-dev" }),
		);
	});

	it("prompts for github token, cloudflare token, and owner separately", async () => {
		await sowCommand.parseAsync([], { from: "user" });
		expect(mockInquirerPrompt).toHaveBeenCalledTimes(3);
		expect(mockInquirerPrompt).toHaveBeenNthCalledWith(
			1,
			expect.arrayContaining([expect.objectContaining({ name: "owner" })]),
		);
		expect(mockInquirerPrompt).toHaveBeenNthCalledWith(
			2,
			expect.arrayContaining([expect.objectContaining({ name: "githubToken" })]),
		);
		expect(mockInquirerPrompt).toHaveBeenNthCalledWith(
			3,
			expect.arrayContaining([
				expect.objectContaining({ name: "cloudflareToken" }),
			]),
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
