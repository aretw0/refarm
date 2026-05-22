import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockProvision, mockLoadTokens, mockWriteFileSync } = vi.hoisted(() => ({
  mockProvision: vi.fn().mockResolvedValue({
    REFARM_GITHUB_TOKEN: "ghp_test",
    REFARM_CLOUDFLARE_API_TOKEN: undefined,
  }),
  mockLoadTokens: vi.fn().mockResolvedValue({
    modelProvider: "openai",
    modelApiKey: "sk-test",
  }),
  mockWriteFileSync: vi.fn(),
}));

vi.mock("@refarm.dev/config", () => ({
  DEFAULT_MODEL_PROVIDER: "openai",
  defaultProviderModelRef: vi.fn((provider: string) => `${provider}/gpt-5.5`),
  loadConfig: vi.fn().mockReturnValue({ brand: { name: "test-farm" } }),
  modelCredentialStatus: vi.fn(() => ({ state: "silo-api-key", envKey: "OPENAI_API_KEY" })),
}));

vi.mock("@refarm.dev/silo", () => ({
  SiloCore: vi.fn().mockImplementation(function () {
    return { provision: mockProvision, loadTokens: mockLoadTokens };
  }),
}));

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    writeFileSync: mockWriteFileSync,
    default: { ...actual, writeFileSync: mockWriteFileSync },
  };
});

import { guideCommand } from "../../src/commands/guide.js";

describe("guideCommand", () => {
  beforeEach(() => vi.clearAllMocks());

  it("documents the generated audit file in help", () => {
    let help = "";
    guideCommand.configureOutput({
      writeOut: (value) => {
        help += value;
      },
    });
    guideCommand.outputHelp();

    expect(help).toContain("refarm-audit.md");
    expect(help).toContain("refarm sow --cloudflare");
    expect(help).toContain("refarm model current");
    expect(help).toContain("model, GitHub, Cloudflare, and brand setup");
    expect(help).toContain("Use refarm health");
  });

  it("writes a markdown file", async () => {
    await guideCommand.parseAsync([], { from: "user" });
    expect(mockWriteFileSync).toHaveBeenCalledWith(
      expect.stringContaining(".md"),
      expect.stringContaining("# Setup Audit"),
    );
  });

  it("reflects token presence in the generated content", async () => {
    await guideCommand.parseAsync([], { from: "user" });
    const content = mockWriteFileSync.mock.calls[0]![1] as string;
    expect(content).toContain("GITHUB_TOKEN");
    expect(content).toContain("Model Credentials");
    expect(content).toContain("refarm model current");
    expect(content).toContain("refarm sow --cloudflare");
  });
});
