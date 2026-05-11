import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockSow, mockInquirerPrompt, mockSecretInput } = vi.hoisted(() => ({
	mockSow: vi.fn().mockResolvedValue({
		storagePath: "/home/user/.refarm/identity.json",
		github: { ok: true, count: 3 },
		cloudflare: { ok: true },
	}),
	mockInquirerPrompt: vi.fn(),
	mockSecretInput: vi.fn(),
}));

vi.mock("inquirer", () => ({ default: { prompt: mockInquirerPrompt } }));
vi.mock("../../src/prompts/secret-input.js", () => ({
	secretInput: mockSecretInput,
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
		// owner prompt via inquirer, then two secretInput calls
		mockInquirerPrompt.mockResolvedValueOnce({ owner: "refarm-dev" });
		mockSecretInput
			.mockResolvedValueOnce("ghp_test")
			.mockResolvedValueOnce("cf_test");
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

	it("prompts for owner via inquirer and credentials via secretInput", async () => {
		await sowCommand.parseAsync([], { from: "user" });
		expect(mockInquirerPrompt).toHaveBeenCalledWith(
			expect.arrayContaining([expect.objectContaining({ name: "owner" })]),
		);
		expect(mockSecretInput).toHaveBeenCalledTimes(2);
		expect(mockSecretInput).toHaveBeenNthCalledWith(
			1,
			expect.objectContaining({ message: "Paste the value:" }),
		);
		expect(mockSecretInput).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({ message: "Paste the value:" }),
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
