import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockSaveTokens, mockLoadTokens, mockInquirerPrompt, mockGithubCollect, mockCloudflareCollect, mockModelCollect } =
	vi.hoisted(() => ({
		mockSaveTokens: vi.fn().mockResolvedValue({}),
		mockLoadTokens: vi.fn().mockResolvedValue({}),
		mockInquirerPrompt: vi.fn(),
		mockGithubCollect: vi.fn().mockResolvedValue("gho_test_github"),
		mockCloudflareCollect: vi.fn().mockResolvedValue("cf_test_cloudflare"),
		mockModelCollect: vi.fn().mockResolvedValue({ provider: "anthropic", apiKey: "sk-ant-test" }),
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
	modelCredentialProvider: {
		id: "model",
		label: "Model Provider",
		collect: vi.fn(),
		collectModel: mockModelCollect,
	},
}));

vi.mock("@refarm.dev/silo", () => ({
	SiloCore: vi.fn().mockImplementation(function () {
		return { saveTokens: mockSaveTokens, loadTokens: mockLoadTokens };
	}),
}));

import { sowCommand } from "../../src/commands/sow.js";

describe("sowCommand — default (no flags)", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockLoadTokens.mockResolvedValue({});
		mockModelCollect.mockResolvedValue({ provider: "anthropic", apiKey: "sk-ant-test" });
	});

	it("prompts for model provider when not yet configured", async () => {
		await sowCommand.parseAsync([], { from: "user" });
		expect(mockModelCollect).toHaveBeenCalledOnce();
	});

	it("saves modelProvider and modelApiKey", async () => {
		await sowCommand.parseAsync([], { from: "user" });
		expect(mockSaveTokens).toHaveBeenCalledWith(
			expect.objectContaining({ modelProvider: "anthropic", modelApiKey: "sk-ant-test" }),
		);
	});

	it("saves only modelProvider when ollama is selected (no key)", async () => {
		mockModelCollect.mockResolvedValue({ provider: "ollama", apiKey: null });
		await sowCommand.parseAsync([], { from: "user" });
		expect(mockSaveTokens).toHaveBeenCalledWith({ modelProvider: "ollama" });
	});

	it("skips model prompt and exits cleanly when already configured", async () => {
		mockLoadTokens.mockResolvedValue({ modelProvider: "anthropic" });
		await sowCommand.parseAsync([], { from: "user" });
		expect(mockModelCollect).not.toHaveBeenCalled();
		expect(mockSaveTokens).not.toHaveBeenCalled();
	});

	it("does not prompt for GitHub or Cloudflare by default", async () => {
		await sowCommand.parseAsync([], { from: "user" });
		expect(mockGithubCollect).not.toHaveBeenCalled();
		expect(mockCloudflareCollect).not.toHaveBeenCalled();
	});
});

describe("sowCommand — --model flag", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockLoadTokens.mockResolvedValue({ modelProvider: "anthropic" });
		mockModelCollect.mockResolvedValue({ provider: "openai", apiKey: "sk-openai-test" });
	});

	it("reconfigures model provider even when already set", async () => {
		await sowCommand.parseAsync(["--model"], { from: "user" });
		expect(mockModelCollect).toHaveBeenCalledOnce();
	});

	it("saves updated modelProvider", async () => {
		await sowCommand.parseAsync(["--model"], { from: "user" });
		expect(mockSaveTokens).toHaveBeenCalledWith(
			expect.objectContaining({ modelProvider: "openai", modelApiKey: "sk-openai-test" }),
		);
	});
});

describe("sowCommand — --github flag", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockLoadTokens.mockResolvedValue({ modelProvider: "anthropic" });
		mockInquirerPrompt.mockResolvedValue({ owner: "my-org" });
	});

	it("prompts for GitHub when --github is passed", async () => {
		await sowCommand.parseAsync(["--github"], { from: "user" });
		expect(mockGithubCollect).toHaveBeenCalledOnce();
	});

	it("saves githubToken and githubOwner", async () => {
		await sowCommand.parseAsync(["--github"], { from: "user" });
		expect(mockSaveTokens).toHaveBeenCalledWith(
			expect.objectContaining({ githubToken: "gho_test_github", githubOwner: "my-org" }),
		);
	});

	it("does not prompt for model when already configured", async () => {
		await sowCommand.parseAsync(["--github"], { from: "user" });
		expect(mockModelCollect).not.toHaveBeenCalled();
	});
});

describe("sowCommand — --cloudflare flag", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockLoadTokens.mockResolvedValue({ modelProvider: "anthropic" });
	});

	it("prompts for Cloudflare when --cloudflare is passed", async () => {
		await sowCommand.parseAsync(["--cloudflare"], { from: "user" });
		expect(mockCloudflareCollect).toHaveBeenCalledOnce();
	});

	it("saves cloudflareToken", async () => {
		await sowCommand.parseAsync(["--cloudflare"], { from: "user" });
		expect(mockSaveTokens).toHaveBeenCalledWith({ cloudflareToken: "cf_test_cloudflare" });
	});
});

describe("sowCommand — --all flag", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockLoadTokens.mockResolvedValue({ modelProvider: "anthropic" });
		mockInquirerPrompt.mockResolvedValue({ owner: "my-org" });
		mockModelCollect.mockResolvedValue({ provider: "groq", apiKey: "gsk-test" });
	});

	it("reconfigures model even if already set", async () => {
		await sowCommand.parseAsync(["--all"], { from: "user" });
		expect(mockModelCollect).toHaveBeenCalledOnce();
	});

	it("collects GitHub and Cloudflare", async () => {
		await sowCommand.parseAsync(["--all"], { from: "user" });
		expect(mockGithubCollect).toHaveBeenCalledOnce();
		expect(mockCloudflareCollect).toHaveBeenCalledOnce();
	});
});

describe("sowCommand — SIGINT handling", () => {
	it("exits gracefully on ExitPromptError", async () => {
		vi.clearAllMocks();
		mockLoadTokens.mockResolvedValue({});
		const { ExitPromptError } = await import("@inquirer/core");
		mockModelCollect.mockRejectedValueOnce(
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
