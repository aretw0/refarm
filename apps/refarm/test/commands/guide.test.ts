import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
  effectiveModelRouteForScope: vi.fn((tokens: Record<string, unknown>, _scope: string, options: { env?: Record<string, string | undefined> }) => ({
    provider: options.env?.MODEL_PROVIDER ?? tokens.modelProvider ?? "openai",
    modelId: options.env?.MODEL_PROVIDER === "gemini" ? "gemini-3-flash-preview" : "gpt-5.5",
  })),
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
  const originalModelProvider = process.env.MODEL_PROVIDER;

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.MODEL_PROVIDER;
  });

  afterEach(() => {
    if (originalModelProvider === undefined) {
      delete process.env.MODEL_PROVIDER;
    } else {
      process.env.MODEL_PROVIDER = originalModelProvider;
    }
  });

  it("documents the generated audit file in help", () => {
    let help = "";
    guideCommand.configureOutput({
      writeOut: (value) => {
        help += value;
      },
    });
    guideCommand.outputHelp();

    expect(help).toContain("refarm guide --json");
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

  it("prints setup audit as JSON without writing markdown", async () => {
    const logs: string[] = [];
    const logSpy = vi.spyOn(console, "log").mockImplementation((value) => {
      logs.push(String(value));
    });

    await guideCommand.parseAsync(["--json"], { from: "user" });

    expect(mockWriteFileSync).not.toHaveBeenCalled();
    const payload = JSON.parse(logs.join("\n")) as {
      command: string;
      outputPath: string;
      ok: boolean;
      checks: Array<{ id: string; ok: boolean; status: string; actionCommand?: string }>;
      nextAction: string | null;
      nextActions: string[];
      nextCommand: string | null;
      nextCommands: string[];
    };
    expect(payload).toMatchObject({
      command: "guide",
      outputPath: "refarm-audit.md",
      ok: false,
    });
    expect(payload.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "model-credentials",
          ok: true,
          status: "ready",
          actionCommand: "refarm model current --json",
        }),
        expect.objectContaining({
          id: "cloudflare-token",
          ok: false,
          status: "missing",
          actionCommand: "refarm provision cloudflare turbo-cache --dry-run",
        }),
      ]),
    );
    expect(payload.nextAction).toBe("Run 'refarm sow --cloudflare' to add your API token.");
    expect(payload.nextActions).toContain(
      "Run 'refarm sow --cloudflare' to add your API token.",
    );
    expect(payload.nextCommand).toBe("refarm provision cloudflare turbo-cache --dry-run");
    expect(payload.nextCommands).toEqual(["refarm provision cloudflare turbo-cache --dry-run"]);

    logSpy.mockRestore();
  });

  it("uses environment model route overrides in the audit", async () => {
    process.env.MODEL_PROVIDER = "gemini";
    await guideCommand.parseAsync([], { from: "user" });

    const content = mockWriteFileSync.mock.calls[0]![1] as string;
    expect(content).toContain("gemini/gemini-3-flash-preview");
  });
});
