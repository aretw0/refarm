import { beforeEach, describe, expect, it, vi } from "vitest";

// vi.hoisted() runs before vi.mock() hoisting, allowing mock factories to reference these variables.
const {
  mockScaffold,
  mockBootstrapIdentity,
  mockExistsSync,
  mockMkdirSync,
  mockWriteFileSync,
  mockInquirerPrompt,
} = vi.hoisted(() => ({
  mockScaffold: vi.fn().mockResolvedValue({ config: { type: "app" }, tier: "persistent" }),
  mockBootstrapIdentity: vi.fn().mockResolvedValue({
    publicKey: "pk_test",
    timestamp: "2026-01-01T00:00:00.000Z",
  }),
  mockExistsSync: vi.fn().mockReturnValue(false),
  mockMkdirSync: vi.fn(),
  mockWriteFileSync: vi.fn(),
  mockInquirerPrompt: vi.fn().mockResolvedValue({ template: "workspace" }),
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
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    existsSync: mockExistsSync,
    mkdirSync: mockMkdirSync,
    writeFileSync: mockWriteFileSync,
    default: {
      ...actual,
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
    mockScaffold.mockResolvedValue({ config: { type: "app" }, tier: "persistent" });
    mockBootstrapIdentity.mockResolvedValue({
      publicKey: "pk_test",
      timestamp: "2026-01-01T00:00:00.000Z",
    });
    mockInquirerPrompt.mockResolvedValue({ template: "workspace" });
    process.exitCode = undefined;
  });

  async function runInit(name = "test-workspace") {
    // Invoke the action directly on the subcommand — from:"user" means no argv[0]/argv[1] stripping.
    await initCommand.parseAsync([name], { from: "user" });
  }

  it("documents force behavior and next credential step in help", () => {
    let help = "";
    initCommand.configureOutput({
      writeOut: (value) => {
        help += value;
      },
    });
    initCommand.outputHelp();

    expect(help).toContain("refarm init my-workspace --force");
    expect(help).toContain("refarm init my-workspace --json");
    expect(help).toContain("--force reinitializes");
    expect(help).toContain("workspace identity is metadata");
    expect(help).toContain("~/.refarm/identity.json");
    expect(help).toContain("run refarm sow to configure model credentials");
    expect(help).toContain("refarm model current");
    expect(help).toContain("refarm guide");
  });

  it("creates project and .refarm directories with { recursive: true }", async () => {
    await runInit();
    expect(mockMkdirSync).toHaveBeenCalledWith(
      expect.stringContaining("test-workspace"),
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
    expect(content.brand.name).toBe("test-workspace");
    expect(content.brand.slug).toBe("test-workspace");
  });

  it("passes the selected template as the first argument to scaffold", async () => {
    await runInit();
    expect(mockScaffold).toHaveBeenCalledWith(
      "workspace",
      expect.objectContaining({ name: "test-workspace" })
    );
  });

  it("aborts re-run without --force when already initialized", async () => {
    mockExistsSync.mockReturnValue(true);
    await expect(runInit()).resolves.toBeUndefined();
    expect(mockBootstrapIdentity).not.toHaveBeenCalled();
    expect(mockWriteFileSync).not.toHaveBeenCalled();
    expect(process.exitCode).toBeUndefined();
  });

  it("reinitializes when --force is passed even if already initialized", async () => {
    mockExistsSync.mockReturnValue(true);
    await initCommand.parseAsync(["test-workspace", "--force"], { from: "user" });
    expect(mockBootstrapIdentity).toHaveBeenCalled();
  });

  it("prints initialization result as JSON", async () => {
    const logs: string[] = [];
    const logSpy = vi.spyOn(console, "log").mockImplementation((value) => {
      logs.push(String(value));
    });

    await initCommand.parseAsync(["test-workspace", "--json"], { from: "user" });

    const payload = JSON.parse(logs.join("\n")) as {
      command: string;
      ok: boolean;
      status: string;
      projectDir: string;
      nextActions: string[];
      nextCommand: string;
      nextCommands: string[];
    };
    expect(payload).toMatchObject({
      command: "init",
      ok: true,
      status: "initialized",
    });
    expect(payload.projectDir).toContain("test-workspace");
    expect(payload.nextActions).toContain("refarm model current");
    expect(payload.nextCommand).toContain("refarm sow");
    expect(payload.nextCommand).toContain("test-workspace");
    expect(payload.nextCommands).toContainEqual(
      expect.stringContaining("refarm guide --json"),
    );
    logSpy.mockRestore();
  });

  it("prints already-initialized result as JSON without overwriting", async () => {
    mockExistsSync.mockReturnValue(true);
    const logs: string[] = [];
    const logSpy = vi.spyOn(console, "log").mockImplementation((value) => {
      logs.push(String(value));
    });

    await initCommand.parseAsync(["test-workspace", "--json"], { from: "user" });

    expect(mockBootstrapIdentity).not.toHaveBeenCalled();
    expect(mockWriteFileSync).not.toHaveBeenCalled();
    const payload = JSON.parse(logs.join("\n")) as {
      ok: boolean;
      status: string;
      nextAction: string;
      nextCommand: string;
    };
    expect(payload).toMatchObject({
      ok: false,
      status: "already-initialized",
      nextAction: 'refarm init "test-workspace" --force',
      nextCommand: 'refarm init "test-workspace" --force',
    });
    logSpy.mockRestore();
  });
});
