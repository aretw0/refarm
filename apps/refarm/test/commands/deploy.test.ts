import { describe, it, expect, vi, beforeEach } from "vitest";

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
  const actual = await importOriginal() as any;
  return {
    ...actual,
    existsSync: vi.fn().mockReturnValue(true),
    readFileSync: vi.fn().mockReturnValue(JSON.stringify({ brand: { slug: "my-farm" } })),
    default: {
      ...actual.default,
      existsSync: vi.fn().mockReturnValue(true),
      readFileSync: vi.fn().mockReturnValue(JSON.stringify({ brand: { slug: "my-farm" } })),
    },
  };
});

import { deployCommand } from "../../src/commands/deploy.js";

describe("deployCommand", () => {
  beforeEach(() => vi.clearAllMocks());

  it("calls windmill.deploy with the given target", async () => {
    await deployCommand.parseAsync(["--target", "github", "--dry-run"], { from: "user" });
    expect(mockDeploy).toHaveBeenCalledWith("github");
  });

  it("does not throw on dry-run success", async () => {
    await expect(
      deployCommand.parseAsync(["--dry-run"], { from: "user" })
    ).resolves.not.toThrow();
  });
});
