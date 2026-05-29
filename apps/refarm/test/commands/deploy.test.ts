import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockDeploy, mockProvision } = vi.hoisted(() => ({
  mockDeploy: vi.fn().mockResolvedValue({ status: "dry-run" }),
  mockProvision: vi.fn().mockReturnValue({}),
}));

vi.mock("@refarm.dev/silo", () => ({
  SiloCore: vi.fn().mockImplementation(function () {
    return { provision: mockProvision };
  }),
}));

vi.mock("@refarm.dev/windmill", () => ({
  Windmill: vi.fn().mockImplementation(function () {
    return { deploy: mockDeploy };
  }),
}));

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    existsSync: vi.fn().mockReturnValue(true),
    readFileSync: vi.fn().mockReturnValue(JSON.stringify({ brand: { slug: "my-farm" } })),
    default: {
      ...actual,
      existsSync: vi.fn().mockReturnValue(true),
      readFileSync: vi.fn().mockReturnValue(JSON.stringify({ brand: { slug: "my-farm" } })),
    },
  };
});

import { deployCommand } from "../../src/commands/deploy.js";

describe("deployCommand", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.exitCode = undefined;
  });

  it("documents dry-run and configuration requirements in help", () => {
    let help = "";
    deployCommand.configureOutput({
      writeOut: (value) => {
        help += value;
      },
    });
    deployCommand.outputHelp();

    expect(help).toContain("refarm deploy --dry-run");
    expect(help).toContain("refarm deploy --dry-run --json");
    expect(help).toContain("refarm.config.json");
    expect(help).toContain("Use --dry-run first");
  });

  it("calls windmill.deploy with the given target", async () => {
    await deployCommand.parseAsync(["--target", "github", "--dry-run"], { from: "user" });
    expect(mockDeploy).toHaveBeenCalledWith("github");
  });

  it("rejects unknown deploy targets before calling windmill", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await deployCommand.parseAsync(["--target", "workers", "--dry-run"], {
      from: "user",
    });

    expect(mockDeploy).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Invalid deploy target "workers"'),
    );
    expect(process.exitCode).toBe(1);
    errorSpy.mockRestore();
  });

  it("does not throw on dry-run success", async () => {
    await expect(
      deployCommand.parseAsync(["--dry-run"], { from: "user" })
    ).resolves.not.toThrow();
  });

  it("prints dry-run deployment result as JSON", async () => {
    mockDeploy.mockResolvedValueOnce({ status: "dry-run", url: "https://example.invalid" });
    const logs: string[] = [];
    const logSpy = vi.spyOn(console, "log").mockImplementation((value) => {
      logs.push(String(value));
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await deployCommand.parseAsync(["--target", "github", "--dry-run", "--json"], {
      from: "user",
    });

    expect(errorSpy).not.toHaveBeenCalled();
    const payload = JSON.parse(logs.join("\n")) as {
      command: string;
      operation: string;
      target: string;
      dryRun: boolean;
      ok: boolean;
      status: string;
      nextCommand: string;
      nextCommands: string[];
    };
    expect(payload).toMatchObject({
      command: "deploy",
      operation: "deploy",
      target: "github",
      dryRun: true,
      ok: true,
      status: "dry-run",
      nextCommand: "refarm deploy --target github",
      nextCommands: ["refarm deploy --target github"],
    });

    logSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it("prints live deployment success as JSON with a health observation handoff", async () => {
    mockDeploy.mockResolvedValueOnce({ status: "success", url: "https://example.invalid" });
    const logs: string[] = [];
    const logSpy = vi.spyOn(console, "log").mockImplementation((value) => {
      logs.push(String(value));
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await deployCommand.parseAsync(["--target", "cloudflare", "--json"], {
      from: "user",
    });

    expect(errorSpy).not.toHaveBeenCalled();
    const payload = JSON.parse(logs.join("\n")) as {
      ok: boolean;
      operation: string;
      status: string;
      nextCommand: string;
      nextCommands: string[];
    };
    expect(payload).toMatchObject({
      ok: true,
      operation: "deploy",
      status: "success",
      nextAction: "refarm health --next-action --json",
      nextCommand: "refarm health --next-action --json",
      nextCommands: ["refarm health --next-action --json"],
    });

    logSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it("prints deploy failures as JSON without operator stderr", async () => {
    mockDeploy.mockResolvedValueOnce({ status: "failure", message: "upload failed" });
    const logs: string[] = [];
    const logSpy = vi.spyOn(console, "log").mockImplementation((value) => {
      logs.push(String(value));
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await deployCommand.parseAsync(["--target", "cloudflare", "--json"], {
      from: "user",
    });

    expect(errorSpy).not.toHaveBeenCalled();
    const payload = JSON.parse(logs.join("\n")) as {
      ok: boolean;
      error: string;
      operation: string;
      status: string;
      nextAction: string;
      nextCommand: string;
      nextCommands: string[];
    };
    expect(payload).toMatchObject({
      ok: false,
      error: "deploy-failed",
      operation: "deploy",
      status: "failure",
      nextAction: "refarm deploy --target cloudflare --dry-run",
      nextCommand: "refarm deploy --target cloudflare --dry-run",
      nextCommands: ["refarm deploy --target cloudflare --dry-run"],
    });
    expect(process.exitCode).toBe(1);

    logSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it("prints invalid deploy targets as JSON before calling windmill", async () => {
    const logs: string[] = [];
    const logSpy = vi.spyOn(console, "log").mockImplementation((value) => {
      logs.push(String(value));
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await deployCommand.parseAsync(["--target", "workers", "--dry-run", "--json"], {
      from: "user",
    });

    expect(mockDeploy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
    const payload = JSON.parse(logs.join("\n")) as {
      ok: boolean;
      status: string;
      error: string;
      message: string;
      nextCommand: string;
    };
    expect(payload).toMatchObject({
      ok: false,
      error: "deploy-failed",
      status: "error",
    });
    expect(payload.message).toContain('Invalid deploy target "workers"');
    expect(payload.nextCommand).toBe("refarm deploy --dry-run");
    expect(process.exitCode).toBe(1);

    logSpy.mockRestore();
    errorSpy.mockRestore();
  });
});
