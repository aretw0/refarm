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

	it("sets provider/model without prompting when a full model ref is passed", async () => {
		mockLoadTokens.mockResolvedValue({ modelProvider: "openai" });
		await sowCommand.parseAsync(["--model", "openai/gpt-5.5"], { from: "user" });
		expect(mockModelCollect).not.toHaveBeenCalled();
		expect(mockSaveTokens).toHaveBeenCalledWith({ modelProvider: "openai", modelId: "gpt-5.5" });
	});

	it("sets provider/model without prompting even when no provider is configured", async () => {
		await sowCommand.parseAsync(["--model", "ollama/llama3.2"], { from: "user" });
		expect(mockModelCollect).not.toHaveBeenCalled();
		expect(mockSaveTokens).toHaveBeenCalledWith({ modelProvider: "ollama", modelId: "llama3.2" });
	});

	it("uses the configured provider when --model receives only a model id", async () => {
		mockLoadTokens.mockResolvedValue({ modelProvider: "openai" });
		await sowCommand.parseAsync(["--model", "gpt-5.5"], { from: "user" });
		expect(mockModelCollect).not.toHaveBeenCalled();
		expect(mockSaveTokens).toHaveBeenCalledWith({ modelProvider: "openai", modelId: "gpt-5.5" });
	});

	it("treats slash refs as provider/model even when another provider is configured", async () => {
		mockLoadTokens.mockResolvedValue({ modelProvider: "openai" });
		await sowCommand.parseAsync(["--model", "vllm/Qwen3-Coder-480B-A35B-Instruct"], { from: "user" });
		expect(mockModelCollect).not.toHaveBeenCalled();
		expect(mockSaveTokens).toHaveBeenCalledWith({
			modelProvider: "vllm",
			modelId: "Qwen3-Coder-480B-A35B-Instruct",
		});
	});

	it("saves only modelProvider when ollama is selected (no key)", async () => {
		mockModelCollect.mockResolvedValue({ provider: "ollama", apiKey: null });
		await sowCommand.parseAsync([], { from: "user" });
		expect(mockSaveTokens).toHaveBeenCalledWith({ modelProvider: "ollama" });
	});

	it("skips model prompt and exits cleanly when already configured", async () => {
		mockLoadTokens.mockResolvedValue({ modelProvider: "anthropic", modelApiKey: "sk-ant-existing" });
		await sowCommand.parseAsync([], { from: "user" });
		expect(mockModelCollect).not.toHaveBeenCalled();
		expect(mockSaveTokens).not.toHaveBeenCalled();
	});

	it("prompts when provider is set but required credentials are missing", async () => {
		mockLoadTokens.mockResolvedValue({ modelProvider: "openai", modelId: "gpt-5.5" });
		mockModelCollect.mockResolvedValue({ provider: "openai", apiKey: "sk-openai-test" });

		await sowCommand.parseAsync([], { from: "user" });

		expect(mockModelCollect).toHaveBeenCalledOnce();
		expect(mockSaveTokens).toHaveBeenCalledWith(
			expect.objectContaining({ modelProvider: "openai", modelApiKey: "sk-openai-test" }),
		);
	});

	it("does not prompt for GitHub or Cloudflare by default", async () => {
		await sowCommand.parseAsync([], { from: "user" });
		expect(mockGithubCollect).not.toHaveBeenCalled();
		expect(mockCloudflareCollect).not.toHaveBeenCalled();
	});

	it("documents runtime credential reload behavior in help", () => {
		let help = "";
		sowCommand.configureOutput({
			writeOut: (value) => {
				help += value;
			},
		});

		sowCommand.outputHelp();

		expect(help).toContain("The Refarm runtime reloads Silo credentials");
		expect(help).toContain("refarm sow --model openai/gpt-5.5");
		expect(help).toContain("refarm model base-url http://127.0.0.1:8000");
	});
});

describe("sowCommand — --all flag", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockLoadTokens.mockResolvedValue({ modelProvider: "anthropic" });
		mockInquirerPrompt.mockResolvedValue({ owner: "my-org" });
		mockModelCollect.mockResolvedValue({ provider: "openai", apiKey: "sk-openai-test" });
	});

	it("can also pin a provider/model ref without affecting credential collection", async () => {
		await sowCommand.parseAsync(["--all", "--model", "openai/gpt-5.5"], { from: "user" });
		expect(mockSaveTokens).toHaveBeenCalledWith(
			expect.objectContaining({
				modelProvider: "openai",
				modelId: "gpt-5.5",
			}),
		);
	});
});

describe("sowCommand — --github flag", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockLoadTokens.mockResolvedValue({ modelProvider: "anthropic", modelApiKey: "sk-ant-existing" });
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
		mockLoadTokens.mockResolvedValue({ modelProvider: "anthropic", modelApiKey: "sk-ant-existing" });
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

describe("sowCommand — --all credentials", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockLoadTokens.mockResolvedValue({ modelProvider: "anthropic", modelApiKey: "sk-ant-existing" });
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
