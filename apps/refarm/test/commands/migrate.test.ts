import { beforeEach, describe, expect, it, vi } from "vitest";

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
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    existsSync: vi.fn().mockReturnValue(true),
    readFileSync: vi.fn().mockReturnValue(
      JSON.stringify({ brand: { slug: "my-farm", urls: { repository: "https://github.com/user/repo.git" } }, infrastructure: { gitHost: "github" } })
    ),
    default: {
      ...actual,
      existsSync: vi.fn().mockReturnValue(true),
      readFileSync: vi.fn().mockReturnValue(
        JSON.stringify({ brand: { slug: "my-farm", urls: { repository: "https://github.com/user/repo.git" } }, infrastructure: { gitHost: "github" } })
      ),
    },
  };
});

import { migrateCommand } from "../../src/commands/migrate.js";

describe("migrateCommand", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.exitCode = undefined;
  });

  it("documents dry-run and mirror impact in help", () => {
    let help = "";
    migrateCommand.configureOutput({
      writeOut: (value) => {
        help += value;
      },
    });
    migrateCommand.outputHelp();

    expect(help).toContain("refarm migrate --target https://github.com/user/fork.git --dry-run");
    expect(help).toContain("refarm migrate --target https://github.com/user/fork.git --dry-run --json");
    expect(help).toContain("may push the full repository");
    expect(help).toContain(".git/config");
  });

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

  it("prints dry-run mirror result as JSON", async () => {
    mockMirrorRepo.mockResolvedValueOnce({ status: "dry-run" });
    const logs: string[] = [];
    const logSpy = vi.spyOn(console, "log").mockImplementation((value) => {
      logs.push(String(value));
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await migrateCommand.parseAsync(
      ["--target", "https://github.com/user/fork.git", "--dry-run", "--json"],
      { from: "user" },
    );

    expect(errorSpy).not.toHaveBeenCalled();
    const payload = JSON.parse(logs.join("\n")) as {
      command: string;
      operation: string;
      dryRun: boolean;
      ok: boolean;
      status: string;
      targetUrl: string;
      nextCommand: string;
      nextCommands: string[];
    };
    expect(payload).toMatchObject({
      command: "migrate",
      operation: "mirror",
      dryRun: true,
      ok: true,
      status: "dry-run",
      targetUrl: "https://github.com/user/fork.git",
      nextCommand:
        "refarm migrate --target 'https://github.com/user/fork.git'",
      nextCommands: [
        "refarm migrate --target 'https://github.com/user/fork.git'",
      ],
    });

    logSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it("prints live mirror success as JSON with a remote verification command", async () => {
    mockMirrorRepo.mockResolvedValueOnce({ status: "success" });
    const logs: string[] = [];
    const logSpy = vi.spyOn(console, "log").mockImplementation((value) => {
      logs.push(String(value));
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await migrateCommand.parseAsync(
      ["--target", "https://github.com/user/fork.git", "--json"],
      { from: "user" },
    );

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
      operation: "mirror",
      status: "success",
      nextAction: "git ls-remote 'https://github.com/user/fork.git' HEAD",
      nextCommand: "git ls-remote 'https://github.com/user/fork.git' HEAD",
      nextCommands: ["git ls-remote 'https://github.com/user/fork.git' HEAD"],
    });

    logSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it("reports missing target as JSON without prompting", async () => {
    const logs: string[] = [];
    const logSpy = vi.spyOn(console, "log").mockImplementation((value) => {
      logs.push(String(value));
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await migrateCommand.parseAsync(["--dry-run", "--json"], { from: "user" });

    expect(mockInquirerPrompt).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
    const payload = JSON.parse(logs.join("\n")) as {
      ok: boolean;
      error: string;
      nextAction: string;
      nextCommand: string | null;
      nextCommands: string[];
    };
    expect(payload).toMatchObject({
      ok: false,
      error: "missing-target-url",
      nextAction: "Provide a concrete target Git URL and run a dry-run migration.",
    });
    expect(payload.nextCommand).toBeNull();
    expect(payload.nextCommands).toEqual([]);
    expect(process.exitCode).toBe(1);

    logSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it("prints mirror failures with an executable dry-run recovery command", async () => {
    mockMirrorRepo.mockResolvedValueOnce({ status: "failure", message: "push failed" });
    const logs: string[] = [];
    const logSpy = vi.spyOn(console, "log").mockImplementation((value) => {
      logs.push(String(value));
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await migrateCommand.parseAsync(
      ["--target", "https://github.com/user/fork.git", "--json"],
      { from: "user" },
    );

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
      error: "migrate-failed",
      operation: "mirror",
      status: "failure",
      nextAction:
        "refarm migrate --target 'https://github.com/user/fork.git' --dry-run",
      nextCommand:
        "refarm migrate --target 'https://github.com/user/fork.git' --dry-run",
      nextCommands: [
        "refarm migrate --target 'https://github.com/user/fork.git' --dry-run",
      ],
    });
    expect(process.exitCode).toBe(1);

    logSpy.mockRestore();
    errorSpy.mockRestore();
  });
});
