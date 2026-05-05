import { describe, it, expect, vi, beforeEach } from "vitest";

// vi.hoisted() runs before vi.mock() hoisting, allowing mock factories to reference these variables.
const {
  mockScaffold,
  mockBootstrapIdentity,
  mockExistsSync,
  mockMkdirSync,
  mockWriteFileSync,
  mockInquirerPrompt,
} = vi.hoisted(() => ({
  mockScaffold: vi.fn().mockResolvedValue({ config: { type: "app" }, tier: "citizen" }),
  mockBootstrapIdentity: vi.fn().mockResolvedValue({
    publicKey: "pk_test",
    timestamp: "2026-01-01T00:00:00.000Z",
  }),
  mockExistsSync: vi.fn().mockReturnValue(false),
  mockMkdirSync: vi.fn(),
  mockWriteFileSync: vi.fn(),
  mockInquirerPrompt: vi.fn().mockResolvedValue({ template: "courier" }),
}));

vi.mock("inquirer", () => ({
  default: { prompt: mockInquirerPrompt },
}));

vi.mock("@refarm.dev/sower", () => ({
  SowerCore: vi.fn().mockImplementation(function () { return { scaffold: mockScaffold }; }),
}));

vi.mock("@refarm.dev/silo", () => ({
  SiloCore: vi.fn().mockImplementation(function () { return { bootstrapIdentity: mockBootstrapIdentity }; }),
}));

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal() as any;
  return {
    ...actual,
    existsSync: mockExistsSync,
    mkdirSync: mockMkdirSync,
    writeFileSync: mockWriteFileSync,
    default: {
      ...actual.default,
      existsSync: mockExistsSync,
      mkdirSync: mockMkdirSync,
      writeFileSync: mockWriteFileSync,
    }
  };
});

import { initCommand } from "../../src/commands/init.js";

describe("initCommand — mocked initialization flow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Re-apply return values cleared by clearAllMocks()
    mockExistsSync.mockReturnValue(false);
    mockScaffold.mockResolvedValue({ config: { type: "app" }, tier: "citizen" });
    mockBootstrapIdentity.mockResolvedValue({
      publicKey: "pk_test",
      timestamp: "2026-01-01T00:00:00.000Z",
    });
    mockInquirerPrompt.mockResolvedValue({ template: "courier" });
  });

  async function runInit(name = "test-farm") {
    // Invoke the action directly on the subcommand — from:"user" means no argv[0]/argv[1] stripping.
    await initCommand.parseAsync([name], { from: "user" });
  }

  it("creates project and .refarm directories with { recursive: true }", async () => {
    await runInit();
    expect(mockMkdirSync).toHaveBeenCalledWith(
      expect.stringContaining("test-farm"),
      { recursive: true }
    );
    expect(mockMkdirSync).toHaveBeenCalledWith(
      expect.stringContaining(".refarm"),
      { recursive: true }
    );
  });

  it("writes identity.json with publicKey and bootstrappedAt", async () => {
    await runInit();
    const call = mockWriteFileSync.mock.calls.find(([p]) =>
      (p as string).includes("identity.json")
    );
    expect(call).toBeDefined();
    const content = JSON.parse(call![1] as string);
    expect(content.publicKey).toBe("pk_test");
    expect(content.bootstrappedAt).toBe("2026-01-01T00:00:00.000Z");
  });

  it("writes refarm.config.json with correct brand name and slug", async () => {
    await runInit();
    const call = mockWriteFileSync.mock.calls.find(([p]) =>
      (p as string).includes("refarm.config.json")
    );
    expect(call).toBeDefined();
    const content = JSON.parse(call![1] as string);
    expect(content.brand.name).toBe("test-farm");
    expect(content.brand.slug).toBe("test-farm");
  });

  it("passes the selected template as the first argument to scaffold", async () => {
    await runInit();
    expect(mockScaffold).toHaveBeenCalledWith(
      "courier",
      expect.objectContaining({ name: "test-farm" })
    );
  });
});
