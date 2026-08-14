import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
	mockSaveTokens,
	mockSaveSecret,
	mockLoadTokens,
	mockOperatorAsk,
	mockGithubCollect,
	mockCloudflareCollect,
	mockModelCollect,
} = vi.hoisted(() => ({
	mockSaveTokens: vi.fn().mockResolvedValue({}),
	mockSaveSecret: vi.fn().mockResolvedValue({}),
	mockLoadTokens: vi.fn().mockResolvedValue({}),
	mockOperatorAsk: vi.fn().mockResolvedValue("my-org"),
	mockGithubCollect: vi.fn().mockResolvedValue("gho_test_github"),
	mockCloudflareCollect: vi.fn().mockResolvedValue("cf_test_cloudflare"),
	mockModelCollect: vi
		.fn()
		.mockResolvedValue({ provider: "anthropic", apiKey: "sk-ant-test" }),
}));

vi.mock("@refarm.dev/prompt-contract-v1", () => ({
	OperatorPromptCancelledError: class OperatorPromptCancelledError extends Error {
		constructor(message = "Operator prompt cancelled") {
			super(message);
			this.name = "OperatorPromptCancelledError";
		}
	},
	createStdioOperatorChannel: vi.fn(() => ({ ask: mockOperatorAsk })),
}));

vi.mock("../../src/credentials/index.js", () => ({
	githubCredentialProvider: {
		id: "github",
		label: "GitHub",
		namespace: "runtime",
		collect: mockGithubCollect,
	},
	cloudflareCredentialProvider: {
		id: "cloudflare",
		label: "Cloudflare",
		namespace: "runtime",
		collect: mockCloudflareCollect,
	},
	modelCredentialProvider: {
		id: "model",
		label: "Model Provider",
		namespace: "model",
		collect: vi.fn(),
		collectModel: mockModelCollect,
	},
}));

vi.mock("@refarm.dev/silo", () => ({
	SiloCore: vi.fn().mockImplementation(function () {
		return { saveTokens: mockSaveTokens, loadTokens: mockLoadTokens, saveSecret: mockSaveSecret };
	}),
}));

import { sowCommand } from "../../src/commands/sow.js";

afterEach(() => {
	process.exitCode = undefined;
	vi.restoreAllMocks();
});

describe("sowCommand — default (no flags)", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		process.exitCode = undefined;
		mockLoadTokens.mockResolvedValue({});
		mockModelCollect.mockResolvedValue({
			provider: "anthropic",
			apiKey: "sk-ant-test",
		});
	});

	it("prompts for model provider when not yet configured", async () => {
		await sowCommand.parseAsync([], { from: "user" });
		expect(mockModelCollect).toHaveBeenCalledOnce();
	});

	it("saves modelProvider and modelApiKey", async () => {
		await sowCommand.parseAsync([], { from: "user" });
		expect(mockSaveTokens).toHaveBeenCalledWith(
			expect.objectContaining({
				modelProvider: "anthropic",
				modelApiKey: "sk-ant-test",
			}),
		);
	});

	it("keeps subscription OAuth providers separate from API key providers", async () => {
		mockModelCollect.mockResolvedValue({
			provider: "openai-codex",
			apiKey: "oauth-access-test",
			oauthCredentials: {
				access: "oauth-access-test",
				refresh: "oauth-refresh-test",
				expires: Date.now() + 60_000,
				accountId: "chatgpt-account-test",
			},
		});

		await sowCommand.parseAsync([], { from: "user" });

		// THE SECRET NO LONGER TOUCHES THE TOKEN MAP. It goes to the silo's `model` namespace under
		// an opaque credential id, which is what lets a second account of one provider exist. The
		// token map keeps only the DECISIONS — which provider is active — and those are not secret.
		expect(mockSaveTokens).toHaveBeenCalledWith(
			expect.objectContaining({
				modelProvider: "openai-codex",
				oauthProvider: "openai-codex",
			}),
		);
		expect(JSON.stringify(mockSaveTokens.mock.calls)).not.toContain("oauth-access-test");
		expect(mockSaveSecret).toHaveBeenCalledWith(
			"model",
			expect.stringMatching(/^model-account:/u),
			expect.stringContaining("oauth-access-test"),
		);
	});

	it("sets provider/model without prompting when a full model ref is passed", async () => {
		mockLoadTokens.mockResolvedValue({ modelProvider: "openai" });
		await sowCommand.parseAsync(["--model", "openai/gpt-5.5"], {
			from: "user",
		});
		expect(mockModelCollect).not.toHaveBeenCalled();
		expect(mockSaveTokens).toHaveBeenCalledWith({
			modelProvider: "openai",
			modelId: "gpt-5.5",
		});
	});

	it("prints a structured model route update with --json", async () => {
		mockLoadTokens.mockResolvedValue({ modelProvider: "openai" });
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await sowCommand.parseAsync(["--model", "openai/gpt-5.5", "--json"], {
			from: "user",
		});

		const payload = JSON.parse(String(logSpy.mock.calls[0]?.[0])) as {
			command: string;
			operation: string;
			ok: boolean;
			status: string;
			modelRoute: { provider: string; modelId: string };
			nextActions: string[];
			nextCommand: string;
			nextCommands: string[];
		};
		expect(payload).toMatchObject({
			command: "sow",
			operation: "credentials",
			ok: true,
			status: "updated",
			modelRoute: { provider: "openai", modelId: "gpt-5.5" },
		});
		expect(payload.nextActions).toContain("refarm model current --json");
		expect(payload.nextCommand).toBe("refarm check --next-action --json");
		expect(payload.nextCommands[0]).toBe("refarm check --next-action --json");
		expect(payload.nextCommands).toContain("refarm model current --json");
		expect(payload.nextCommands).toContain("refarm model providers --json");
		expect(mockModelCollect).not.toHaveBeenCalled();
		expect(mockSaveTokens).toHaveBeenCalledWith({
			modelProvider: "openai",
			modelId: "gpt-5.5",
		});
	});

	it("reports configured credential status as JSON without prompting", async () => {
		mockLoadTokens.mockResolvedValue({
			modelProvider: "anthropic",
			modelApiKey: "sk-ant-existing",
		});
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await sowCommand.parseAsync(["--json"], { from: "user" });

		const payload = JSON.parse(String(logSpy.mock.calls[0]?.[0])) as {
			ok: boolean;
			status: string;
			credentials: { model: boolean; github: boolean; cloudflare: boolean };
			nextActions: string[];
		};
		expect(payload).toMatchObject({
			ok: true,
			status: "configured",
			credentials: { model: true, github: false, cloudflare: false },
			nextCommand: "refarm check --next-action --json",
			nextCommands: [
				"refarm check --next-action --json",
				"refarm model current --json",
			],
		});
		expect(mockModelCollect).not.toHaveBeenCalled();
		expect(mockSaveTokens).not.toHaveBeenCalled();
	});

	it("reports interactive credential collection as a JSON next action", async () => {
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		await sowCommand.parseAsync(["--json"], { from: "user" });

		expect(errorSpy).not.toHaveBeenCalled();
		const payload = JSON.parse(String(logSpy.mock.calls[0]?.[0])) as {
			ok: boolean;
			status: string;
			prompts: string[];
			handoffs: {
				interactive: string;
				inspectCurrent: string;
				inspectProviders: string;
				localNoKeyModel?: string;
				openExternalLinks: string;
			};
			nextAction: string;
			nextCommand: string;
			nextCommands: string[];
		};
		expect(payload).toMatchObject({
			command: "sow",
			operation: "credentials",
			ok: false,
			status: "interactive-required",
			prompts: ["model"],
			nextAction: "refarm sow",
			nextCommand: "refarm sow",
		});
		expect(payload.nextCommands).toContain("refarm sow");
		expect(payload.nextCommands).toContain("refarm model providers --json");
		expect(payload.nextCommands).toContain(
			"refarm config get operator.openExternalLinks --json",
		);
		expect(payload.nextCommands).toContain(
			"refarm sow --model ollama/llama3.2 --json",
		);
		expect(payload.handoffs).toEqual({
			interactive: "refarm sow",
			inspectCurrent: "refarm model current --json",
			inspectProviders: "refarm model providers --json",
			localNoKeyModel: "refarm sow --model ollama/llama3.2 --json",
			openExternalLinks: "refarm config get operator.openExternalLinks --json",
		});
		expect(process.exitCode).toBe(1);
		expect(mockModelCollect).not.toHaveBeenCalled();
		expect(mockSaveTokens).not.toHaveBeenCalled();
	});

	it("sets exitCode when --model is empty", async () => {
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		await sowCommand.parseAsync(["--model", ""], { from: "user" });

		expect(errorSpy).toHaveBeenCalledWith(
			expect.stringContaining("--model cannot be empty"),
		);
		expect(process.exitCode).toBe(1);
		expect(mockModelCollect).not.toHaveBeenCalled();
		expect(mockSaveTokens).not.toHaveBeenCalled();
	});

	it("prints empty model recovery as executable JSON", async () => {
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await sowCommand.parseAsync(["--model", "", "--json"], { from: "user" });

		const payload = JSON.parse(String(logSpy.mock.calls[0]?.[0])) as {
			command: string;
			operation: string;
			ok: boolean;
			error: string;
			nextAction: string;
			nextCommand: string;
		};
		expect(payload).toMatchObject({
			command: "sow",
			operation: "credentials",
			ok: false,
			error: "empty-model",
			nextAction: "refarm sow",
			nextCommand: "refarm sow",
		});
		expect(process.exitCode).toBe(1);
		expect(mockModelCollect).not.toHaveBeenCalled();
		expect(mockSaveTokens).not.toHaveBeenCalled();

		logSpy.mockRestore();
	});

	it("prints missing model provider recovery as executable JSON", async () => {
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await sowCommand.parseAsync(["--model", "custom-local-model", "--json"], {
			from: "user",
		});

		const payload = JSON.parse(String(logSpy.mock.calls[0]?.[0])) as {
			command: string;
			operation: string;
			ok: boolean;
			error: string;
			nextAction: string;
			nextCommand: string;
		};
		expect(payload).toMatchObject({
			command: "sow",
			operation: "credentials",
			ok: false,
			error: "model-provider-required",
			nextAction: "refarm sow",
			nextCommand: "refarm sow",
		});
		expect(process.exitCode).toBe(1);
		expect(mockModelCollect).not.toHaveBeenCalled();
		expect(mockSaveTokens).not.toHaveBeenCalled();

		logSpy.mockRestore();
	});

	it("clears stale model credentials when --model changes provider", async () => {
		mockLoadTokens.mockResolvedValue({
			modelProvider: "anthropic",
			modelApiKey: "sk-ant-old",
			oauthProvider: "anthropic",
		});

		await sowCommand.parseAsync(["--model", "openai/gpt-5.5"], {
			from: "user",
		});

		expect(mockModelCollect).not.toHaveBeenCalled();
		expect(mockSaveTokens).toHaveBeenCalledWith({
			modelProvider: "openai",
			modelId: "gpt-5.5",
			modelApiKey: undefined,
			oauthProvider: undefined,
		});
	});

	it("sets provider/model without prompting even when no provider is configured", async () => {
		await sowCommand.parseAsync(["--model", "ollama/llama3.2"], {
			from: "user",
		});
		expect(mockModelCollect).not.toHaveBeenCalled();
		expect(mockSaveTokens).toHaveBeenCalledWith({
			modelProvider: "ollama",
			modelId: "llama3.2",
		});
	});

	it("uses the configured provider when --model receives only a model id", async () => {
		mockLoadTokens.mockResolvedValue({ modelProvider: "openai" });
		await sowCommand.parseAsync(["--model", "gpt-5.5"], { from: "user" });
		expect(mockModelCollect).not.toHaveBeenCalled();
		expect(mockSaveTokens).toHaveBeenCalledWith({
			modelProvider: "openai",
			modelId: "gpt-5.5",
		});
	});

	it("treats slash refs as provider/model even when another provider is configured", async () => {
		mockLoadTokens.mockResolvedValue({ modelProvider: "openai" });
		await sowCommand.parseAsync(
			["--model", "vllm/Qwen3-Coder-480B-A35B-Instruct"],
			{ from: "user" },
		);
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
		mockLoadTokens.mockResolvedValue({
			modelProvider: "anthropic",
			modelApiKey: "sk-ant-existing",
		});
		await sowCommand.parseAsync([], { from: "user" });
		expect(mockModelCollect).not.toHaveBeenCalled();
		expect(mockSaveTokens).not.toHaveBeenCalled();
	});

	/**
	 * AN EXPIRED CREDENTIAL IS NOT A CONFIGURED ONE (ISS-121).
	 *
	 * Measured on the operator's node 2026-08-12: the `openai-codex` OAuth token had expired five
	 * days earlier and `refarm sow` reported "Model: already configured — skipped". The single
	 * command an operator runs to fix their login declined to do anything, because the check asked
	 * whether a credential was PRESENT.
	 */
	it("re-authenticates when the stored OAuth credential has EXPIRED", async () => {
		mockLoadTokens.mockResolvedValue({
			modelProvider: "openai-codex",
			oauthProvider: "openai-codex",
			oauthCredentials: { "openai-codex": { expires: Date.now() - 5 * 86_400_000 } },
		});
		await sowCommand.parseAsync([], { from: "user" });
		expect(mockModelCollect).toHaveBeenCalled();
	});

	it("says WHY it is asking again, rather than re-prompting without explanation", async () => {
		// Two different facts land on the same prompt — never configured, and configured-then-died.
		// An operator who is asked to log in again without being told which is being told nothing.
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		mockLoadTokens.mockResolvedValue({
			modelProvider: "openai-codex",
			oauthProvider: "openai-codex",
			oauthCredentials: { "openai-codex": { expires: Date.now() - 5 * 86_400_000 } },
		});
		await sowCommand.parseAsync([], { from: "user" });
		const output = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
		expect(output).toContain("EXPIRED");
		logSpy.mockRestore();
	});

	it("leaves a LIVE OAuth credential alone", async () => {
		// The other side of the boundary. A wizard that re-prompted for a healthy credential would
		// have traded a silent skip for a standing nag.
		mockLoadTokens.mockResolvedValue({
			modelProvider: "openai-codex",
			oauthProvider: "openai-codex",
			oauthCredentials: { "openai-codex": { expires: Date.now() + 86_400_000 } },
		});
		await sowCommand.parseAsync([], { from: "user" });
		expect(mockModelCollect).not.toHaveBeenCalled();
	});

	it("does not re-prompt a keyed provider that records no expiry at all", async () => {
		// `unknown` is the third state and it must not collapse into `expired`. An API-key provider
		// carries no `expires`; treating that absence as a failure would re-prompt on every run.
		mockLoadTokens.mockResolvedValue({
			modelProvider: "anthropic",
			modelApiKey: "sk-ant-existing",
		});
		await sowCommand.parseAsync([], { from: "user" });
		expect(mockModelCollect).not.toHaveBeenCalled();
	});

	it("warns before replacing a LIVE credential, because the slot is irreversible", async () => {
		// ISS-122: `oauthCredentials` holds one slot per provider, so `--reconfigure` on a working
		// credential destroys it with no copy kept. An operator with Copilot personal AND corporate
		// has no way to learn that from the wizard's own output.
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		mockLoadTokens.mockResolvedValue({
			modelProvider: "openai-codex",
			oauthProvider: "openai-codex",
			oauthCredentials: { "openai-codex": { expires: Date.now() + 86_400_000 } },
		});
		await sowCommand.parseAsync(["--reconfigure"], { from: "user" });
		const output = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
		expect(output).toContain("LIVE");
		expect(output).toContain("cannot be recovered");
		logSpy.mockRestore();
	});

	it("does NOT warn when replacing an already-expired credential", async () => {
		// Replacing something that authenticates nothing costs nothing, and a warning there would
		// be noise on the exact path today's expiry fix exists to make frictionless.
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		mockLoadTokens.mockResolvedValue({
			modelProvider: "openai-codex",
			oauthProvider: "openai-codex",
			oauthCredentials: { "openai-codex": { expires: Date.now() - 86_400_000 } },
		});
		await sowCommand.parseAsync([], { from: "user" });
		const output = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
		expect(output).not.toContain("cannot be recovered");
		expect(output).toContain("EXPIRED");
		logSpy.mockRestore();
	});

	/**
	 * `--model-provider` skips the picker. Named for the MODEL axis because `sow` already selects
	 * among credential providers (`--github`, `--cloudflare`), and the bare `--provider` is left
	 * unclaimed so a future Telegram or SSO credential can have it without a breaking change.
	 */
	describe("--model-provider", () => {
		it("goes straight to the named provider, without asking", async () => {
			// The operator's ask: log into openai-codex without walking the menu.
			mockLoadTokens.mockResolvedValue({});
			await sowCommand.parseAsync(["--model-provider", "openai-codex"], { from: "user" });
			expect(mockModelCollect).toHaveBeenCalledWith(
				expect.anything(),
				expect.objectContaining({ modelProvider: "openai-codex" }),
			);
		});

		it("overrides 'already configured', because naming a provider is an instruction", async () => {
			// Without this the flag would be silently ignored on a node that already has a working
			// credential — an instruction read as a question, which is the defect two commits back.
			mockLoadTokens.mockResolvedValue({
				modelProvider: "anthropic",
				modelApiKey: "sk-ant-existing",
			});
			await sowCommand.parseAsync(["--model-provider", "openai-codex"], { from: "user" });
			expect(mockModelCollect).toHaveBeenCalled();
		});

		it("ACCEPTS github-copilot, whose login exists as of 2026-08-14", async () => {
			// This test used to pin the opposite: copilot was the operator's corporate quota with no
			// login built (ISS-122), and `sow` refused it. The adapter now exists under refarm's own
			// OAuth App, so the refusal would be a lie. The `no-credential-flow` STATE is still
			// covered, against a synthetic inventory, in model-provider-selection.test.ts.
			mockLoadTokens.mockResolvedValue({});
			await sowCommand.parseAsync(["--model-provider", "github-copilot"], { from: "user" });
			expect(mockModelCollect).toHaveBeenCalled();
		});

		it("still refuses a provider it does not know at all, WITHOUT touching the silo", async () => {
			// The refusal-before-any-write guarantee this file has always asserted, now carried by the
			// case that is still true: a typo is not a provider.
			const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
			mockLoadTokens.mockResolvedValue({});
			await sowCommand.parseAsync(["--model-provider", "githbu-copilot"], { from: "user" });
			expect(mockModelCollect).not.toHaveBeenCalled();
			expect(mockSaveTokens).not.toHaveBeenCalled();
			expect(process.exitCode).toBe(1);
			errSpy.mockRestore();
			process.exitCode = 0;
		});

		it("refuses an ambiguous provider rather than choosing a billing path", async () => {
			const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
			mockLoadTokens.mockResolvedValue({});
			await sowCommand.parseAsync(["--model-provider", "anthropic"], { from: "user" });
			expect(mockModelCollect).not.toHaveBeenCalled();
			expect(errSpy.mock.calls.map((c) => String(c[0])).join("\n")).toContain("anthropic:subscription");
			errSpy.mockRestore();
			process.exitCode = 0;
		});

		it("names the valid values for a typo, as JSON when asked", async () => {
			const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
			mockLoadTokens.mockResolvedValue({});
			await sowCommand.parseAsync(["--model-provider", "opnai", "--json"], { from: "user" });
			const payload = JSON.parse(logSpy.mock.calls.at(-1)?.[0] as string);
			expect(payload.ok).toBe(false);
			expect(payload.error).toBe("unusable-model-provider");
			expect(payload.message).toContain("openai");
			logSpy.mockRestore();
			process.exitCode = 0;
		});
	});

	it("reconfigures model credentials when --reconfigure is explicit", async () => {
		mockLoadTokens.mockResolvedValue({
			modelProvider: "anthropic",
			modelApiKey: "sk-ant-old",
		});
		mockModelCollect.mockResolvedValue({
			provider: "anthropic",
			apiKey: "sk-ant-new",
		});

		await sowCommand.parseAsync(["--reconfigure"], { from: "user" });

		expect(mockModelCollect).toHaveBeenCalledOnce();
		expect(mockSaveTokens).toHaveBeenCalledWith(
			expect.objectContaining({
				modelProvider: "anthropic",
				modelApiKey: "sk-ant-new",
			}),
		);
	});

	it("prompts when provider is set but required credentials are missing", async () => {
		mockLoadTokens.mockResolvedValue({
			modelProvider: "openai",
			modelId: "gpt-5.5",
		});
		mockModelCollect.mockResolvedValue({
			provider: "openai",
			apiKey: "sk-openai-test",
		});

		await sowCommand.parseAsync([], { from: "user" });

		expect(mockModelCollect).toHaveBeenCalledOnce();
		expect(mockSaveTokens).toHaveBeenCalledWith(
			expect.objectContaining({
				modelProvider: "openai",
				modelApiKey: "sk-openai-test",
			}),
		);
	});

	it("does not prompt for GitHub or Cloudflare by default", async () => {
		await sowCommand.parseAsync([], { from: "user" });
		expect(mockGithubCollect).not.toHaveBeenCalled();
		expect(mockCloudflareCollect).not.toHaveBeenCalled();
	});

	it("prints configured status as JSON when already configured and --reconfigure is absent", async () => {
		mockLoadTokens.mockResolvedValue({
			modelProvider: "anthropic",
			modelApiKey: "sk-ant-existing",
		});
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await sowCommand.parseAsync(["--json"], { from: "user" });

		const payload = JSON.parse(String(logSpy.mock.calls[0]?.[0])) as {
			ok: boolean;
			status: string;
			nextActions: string[];
		};
		expect(payload).toMatchObject({
			ok: true,
			status: "configured",
		});
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
		expect(help).toContain("refarm sow --model openai/gpt-5.6-sol");
		expect(help).toContain("refarm sow --model openai/gpt-5.6-sol --json");
		expect(help).toContain("--json is non-interactive");
		expect(help).toContain(
			"nextAction describes any manual login/configuration",
		);
		expect(help).toContain(
			"nextCommand lists executable recovery or continuation commands",
		);
		expect(help).toContain("--reconfigure");
		expect(help).toContain("run plain refarm sow to configure credentials");
		expect(help).toContain("refarm model base-url http://127.0.0.1:8000");
	});
});

describe("sowCommand — --all flag", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		process.exitCode = undefined;
		mockLoadTokens.mockResolvedValue({ modelProvider: "anthropic" });
		mockOperatorAsk.mockResolvedValue("my-org");
		mockModelCollect.mockResolvedValue({
			provider: "openai",
			apiKey: "sk-openai-test",
		});
	});

	it("can also pin a provider/model ref without affecting credential collection", async () => {
		await sowCommand.parseAsync(["--all", "--model", "openai/gpt-5.5"], {
			from: "user",
		});
		expect(mockSaveTokens).toHaveBeenCalledWith(
			expect.objectContaining({
				modelProvider: "openai",
				modelId: "gpt-5.5",
			}),
		);
	});

	it("does not clear the newly collected credential when --model matches it", async () => {
		await sowCommand.parseAsync(["--all", "--model", "openai/gpt-5.5"], {
			from: "user",
		});

		expect(mockSaveTokens).toHaveBeenNthCalledWith(1, {
			modelProvider: "openai",
			modelApiKey: "sk-openai-test",
			oauthProvider: undefined,
		});
		expect(mockSaveTokens).toHaveBeenNthCalledWith(2, {
			modelProvider: "openai",
			modelId: "gpt-5.5",
		});
	});

	it("resolves a short --model id against the newly collected provider", async () => {
		await sowCommand.parseAsync(["--all", "--model", "gpt-5.5"], {
			from: "user",
		});

		expect(mockSaveTokens).toHaveBeenNthCalledWith(1, {
			modelProvider: "openai",
			modelApiKey: "sk-openai-test",
			oauthProvider: undefined,
		});
		expect(mockSaveTokens).toHaveBeenNthCalledWith(2, {
			modelProvider: "openai",
			modelId: "gpt-5.5",
		});
	});

	it("does not clear newly collected OAuth credentials when --model matches them", async () => {
		mockModelCollect.mockResolvedValue({
			provider: "anthropic",
			apiKey: null,
			oauthCredentials: { accessToken: "oauth-test" },
		});

		await sowCommand.parseAsync(
			["--all", "--model", "anthropic/claude-sonnet-4-6"],
			{ from: "user" },
		);

		// Decisions only, in the token map. The credential itself went to the namespaced store.
		expect(mockSaveTokens).toHaveBeenNthCalledWith(1, {
			modelProvider: "anthropic",
			oauthProvider: "anthropic",
		});
		expect(mockSaveSecret).toHaveBeenCalledWith(
			"model",
			expect.stringMatching(/^model-account:/u),
			expect.stringContaining("oauth-test"),
		);
		expect(mockSaveTokens).toHaveBeenNthCalledWith(2, {
			modelProvider: "anthropic",
			modelId: "claude-sonnet-4-6",
		});
	});
});

describe("sowCommand — --github flag", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		process.exitCode = undefined;
		mockLoadTokens.mockResolvedValue({
			modelProvider: "anthropic",
			modelApiKey: "sk-ant-existing",
		});
		mockOperatorAsk.mockResolvedValue("my-org");
	});

	it("prompts for GitHub when --github is passed", async () => {
		await sowCommand.parseAsync(["--github"], { from: "user" });
		expect(mockOperatorAsk).toHaveBeenCalledWith({
			type: "text",
			question: "Your GitHub username or org",
			default: "refarm-dev",
		});
		expect(mockGithubCollect).toHaveBeenCalledOnce();
	});

	it("saves githubToken and githubOwner", async () => {
		await sowCommand.parseAsync(["--github"], { from: "user" });
		expect(mockSaveTokens).toHaveBeenCalledWith(
			expect.objectContaining({
				githubToken: "gho_test_github",
				githubOwner: "my-org",
			}),
		);
	});

	it("does not prompt for model when already configured", async () => {
		await sowCommand.parseAsync(["--github"], { from: "user" });
		expect(mockModelCollect).not.toHaveBeenCalled();
	});

	it("keeps JSON next commands non-interactive when GitHub collection is required", async () => {
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await sowCommand.parseAsync(["--github", "--json"], { from: "user" });

		const payload = JSON.parse(String(logSpy.mock.calls[0]?.[0])) as {
			handoffs: { localNoKeyModel?: string };
			nextAction: string;
			nextCommand: string;
			nextCommands: string[];
		};
		expect(payload.nextAction).toBe("refarm sow --github");
		expect(payload.nextCommand).toBe(
			"refarm config get operator.openExternalLinks --json",
		);
		expect(payload.nextCommands).not.toContain("refarm sow --github");
		expect(payload.nextCommands).toContain(
			"refarm config get operator.openExternalLinks --json",
		);
		expect(payload.handoffs.localNoKeyModel).toBeUndefined();
		expect(mockGithubCollect).not.toHaveBeenCalled();
	});
});

describe("sowCommand — --cloudflare flag", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		process.exitCode = undefined;
		mockLoadTokens.mockResolvedValue({
			modelProvider: "anthropic",
			modelApiKey: "sk-ant-existing",
		});
	});

	it("does not print model skipped banner when explicit cloudflare setup is requested", async () => {
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await sowCommand.parseAsync(["--cloudflare"], { from: "user" });

		const joinedOutput = logSpy.mock.calls.map((call) => String(call[0])).join("\n");
		expect(joinedOutput).not.toContain("Model: already configured");
	});

	it("prompts for Cloudflare when --cloudflare is passed", async () => {
		await sowCommand.parseAsync(["--cloudflare"], { from: "user" });
		expect(mockCloudflareCollect).toHaveBeenCalledOnce();
	});

	it("saves cloudflareToken", async () => {
		await sowCommand.parseAsync(["--cloudflare"], { from: "user" });
		expect(mockSaveTokens).toHaveBeenCalledWith({
			cloudflareToken: "cf_test_cloudflare",
		});
	});
});

describe("sowCommand — --all credentials", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		process.exitCode = undefined;
		mockLoadTokens.mockResolvedValue({
			modelProvider: "anthropic",
			modelApiKey: "sk-ant-existing",
		});
		mockOperatorAsk.mockResolvedValue("my-org");
		mockModelCollect.mockResolvedValue({
			provider: "groq",
			apiKey: "gsk-test",
		});
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
	it("exits gracefully on legacy ExitPromptError-shaped cancellation", async () => {
		vi.clearAllMocks();
		process.exitCode = undefined;
		mockLoadTokens.mockResolvedValue({});
		const error = new Error("User force closed the prompt with SIGINT");
		error.name = "ExitPromptError";
		mockModelCollect.mockRejectedValueOnce(error);
		await sowCommand.parseAsync([], { from: "user" });
		expect(process.exitCode).toBe(130);
	});
});
