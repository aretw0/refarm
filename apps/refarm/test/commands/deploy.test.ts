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
});
