import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockMirrorRepo, mockSiloResolve, mockInquirerPrompt } = vi.hoisted(() => ({
  mockMirrorRepo: vi.fn().mockResolvedValue({ status: "dry-run" }),
  mockSiloResolve: vi.fn().mockResolvedValue(new Map([
    ["REFARM_GITHUB_TOKEN", "ghp_test"],
  ])),
  mockInquirerPrompt: vi.fn().mockResolvedValue({ targetUrl: "https://github.com/user/fork.git" }),
}));

vi.mock("inquirer", () => ({ default: { prompt: mockInquirerPrompt } }));

vi.mock("@refarm.dev/silo", () => ({
  SiloCore: vi.fn().mockImplementation(function () {
    return { resolve: mockSiloResolve };
  }),
}));

vi.mock("@refarm.dev/windmill", () => ({
  Windmill: vi.fn().mockImplementation(function () {
    return { github: { mirrorRepo: mockMirrorRepo } };
  }),
}));

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal() as any;
  return {
    ...actual,
    existsSync: vi.fn().mockReturnValue(true),
    readFileSync: vi.fn().mockReturnValue(
      JSON.stringify({ brand: { slug: "my-farm", urls: { repository: "https://github.com/user/repo.git" } }, infrastructure: { gitHost: "github" } })
    ),
    default: {
      ...actual.default,
      existsSync: vi.fn().mockReturnValue(true),
      readFileSync: vi.fn().mockReturnValue(
        JSON.stringify({ brand: { slug: "my-farm", urls: { repository: "https://github.com/user/repo.git" } }, infrastructure: { gitHost: "github" } })
      ),
    },
  };
});

import { migrateCommand } from "../../src/commands/migrate.js";

describe("migrateCommand", () => {
  beforeEach(() => vi.clearAllMocks());

  it("calls mirrorRepo with provided --target URL", async () => {
    await migrateCommand.parseAsync(["--target", "https://github.com/user/fork.git", "--dry-run"], { from: "user" });
    expect(mockMirrorRepo).toHaveBeenCalledWith(
      expect.any(String),
      "https://github.com/user/fork.git",
      expect.objectContaining({ dryRun: true }),
    );
  });

  it("does not throw on dry-run success", async () => {
    await expect(
      migrateCommand.parseAsync(["--target", "https://github.com/user/fork.git", "--dry-run"], { from: "user" })
    ).resolves.not.toThrow();
  });
});
