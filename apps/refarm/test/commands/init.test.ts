import { beforeEach, describe, expect, it, vi } from "vitest";

// vi.hoisted() runs before vi.mock() hoisting, allowing mock factories to reference these variables.
const {
  mockScaffold,
  mockBootstrapIdentity,
  mockExistsSync,
  mockMkdirSync,
  mockWriteFileSync,
  mockOperatorAsk,
} = vi.hoisted(() => ({
  mockScaffold: vi.fn().mockResolvedValue({ config: { type: "app" }, tier: "persistent" }),
  mockBootstrapIdentity: vi.fn().mockResolvedValue({
    publicKey: "pk_test",
    timestamp: "2026-01-01T00:00:00.000Z",
  }),
  mockExistsSync: vi.fn().mockReturnValue(false),
  mockMkdirSync: vi.fn(),
  mockWriteFileSync: vi.fn(),
  mockOperatorAsk: vi.fn().mockResolvedValue("workspace"),
}));

vi.mock("@refarm.dev/prompt-contract-v1", () => ({
  createStdioOperatorChannel: vi.fn(() => ({ ask: mockOperatorAsk })),
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
    mockOperatorAsk.mockResolvedValue("workspace");
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
    expect(help).toContain("refarm init my-workspace --template workspace --json");
    expect(help).toContain("--force reinitializes");
    expect(help).toContain("--template skips the interactive template prompt");
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

  it("writes .refarm/config.json with correct brand name and slug", async () => {
    await runInit();
    const call = mockWriteFileSync.mock.calls.find(([p]) =>
      (p as string).replaceAll("\\", "/").endsWith(".refarm/config.json")
    );
    expect(call).toBeDefined();
    const content = JSON.parse(call![1] as string);
    expect(content.brand.name).toBe("test-workspace");
    expect(content.brand.slug).toBe("test-workspace");
  });

  it("passes the selected template as the first argument to scaffold", async () => {
    await runInit();
    expect(mockOperatorAsk).toHaveBeenCalledWith({
      type: "select",
      question: "Choose a template to start with",
      default: "workspace",
      options: [
        { label: "Workspace App", value: "workspace" },
        { label: "Rust Plugin (Heartwood)", value: "rust-plugin" },
      ],
    });
    expect(mockScaffold).toHaveBeenCalledWith(
      "workspace",
      expect.objectContaining({ name: "test-workspace" })
    );
  });

  it("uses --template without prompting", async () => {
    await initCommand.parseAsync(["test-workspace", "--template", "rust-plugin"], { from: "user" });

    expect(mockOperatorAsk).not.toHaveBeenCalled();
    expect(mockScaffold).toHaveBeenCalledWith(
      "rust-plugin",
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
      nextAction: string;
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
    expect(payload.nextAction).toContain("refarm sow --json");
    expect(payload.nextAction).toContain("test-workspace");
    expect(payload.nextCommand).toContain("refarm sow --json");
    expect(payload.nextCommand).toContain("test-workspace");
    expect(payload.nextCommands[0]).toContain("refarm sow --json");
    expect(payload.nextActions[0]).toBe(payload.nextCommands[0]);
    expect(payload.nextCommands).toContainEqual(
      expect.stringContaining("refarm model current --json"),
    );
    expect(payload.nextActions).toContainEqual(
      expect.stringContaining("refarm model current --json"),
    );
    expect(payload.nextCommands).toContainEqual(
      expect.stringContaining("refarm guide --json"),
    );
    logSpy.mockRestore();
  });

  it("quotes initialization handoffs for workspace names with spaces", async () => {
    const logs: string[] = [];
    const logSpy = vi.spyOn(console, "log").mockImplementation((value) => {
      logs.push(String(value));
    });

    await initCommand.parseAsync(["space workspace", "--json"], { from: "user" });

    const payload = JSON.parse(logs.join("\n")) as {
      nextAction: string;
      nextActions: string[];
      nextCommand: string;
      nextCommands: string[];
    };
    expect(payload.nextAction).toMatch(/^cd '.*space workspace' && refarm sow --json$/);
    expect(payload.nextCommand).toMatch(/^cd '.*space workspace' && refarm sow --json$/);
    expect(payload.nextActions[0]).toBe(payload.nextCommand);
    expect(payload.nextCommands[0]).toBe(payload.nextCommand);
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
      nextAction: "refarm init 'test-workspace' --force",
      nextCommand: "refarm init 'test-workspace' --force",
    });
    logSpy.mockRestore();
  });
});
