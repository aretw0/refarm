import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  mockAudit,
  mockCheckResolutionStatus,
  mockFileSystemAuditor,
  mockProjectAuditor,
  mockRefarmProjectAuditor,
  mockExistsSync,
  mockReadFileSync,
} = vi.hoisted(() => ({
  mockAudit: vi.fn().mockResolvedValue({ git: [], builds: [], alignment: [] }),
  mockCheckResolutionStatus: vi.fn().mockResolvedValue([]),
  mockFileSystemAuditor: vi.fn(),
  mockProjectAuditor: vi.fn(),
  mockRefarmProjectAuditor: vi.fn(),
  mockExistsSync: vi.fn().mockReturnValue(false),
  mockReadFileSync: vi.fn(),
}));

vi.mock("@refarm.dev/health", () => ({
  HealthCore: vi.fn().mockImplementation(function () {
    return { register: vi.fn(), audit: mockAudit, checkResolutionStatus: mockCheckResolutionStatus };
  }),
  FileSystemAuditor: mockFileSystemAuditor,
  ProjectAuditor: mockProjectAuditor,
  RefarmProjectAuditor: mockRefarmProjectAuditor,
}));

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    existsSync: mockExistsSync,
    readFileSync: mockReadFileSync,
    default: {
      ...actual,
      existsSync: mockExistsSync,
      readFileSync: mockReadFileSync,
    },
  };
});

import {
  buildHealthReport,
  buildHealthRecommendations,
  healthCommand,
  resolveHealthPolicy,
} from "../../src/commands/health.js";

describe("buildHealthReport", () => {
  it("counts git, build and alignment issues", () => {
    const report = buildHealthReport(
      {
        git: [{ file: "src/ignored.ts", type: "ignored" }],
        builds: [{ package: "apps/missing-build", type: "missing_build_config" }],
        alignment: [{ package: "packages/local", entry: "src/", type: "local_alignment" }],
      },
      [{ package: "packages/local", mode: "LOCAL (src)" }],
    );

    expect(report.ok).toBe(false);
    expect(report.issueCount).toBe(3);
    expect(report.resolution).toEqual([{ package: "packages/local", mode: "LOCAL (src)" }]);
    expect(report.recommendations).toHaveLength(3);
  });
});

describe("buildHealthRecommendations", () => {
  it("creates stable actions for each health issue type", () => {
    expect(
      buildHealthRecommendations({
        git: [{ file: "src/generated.ts", type: "git_ignored" }],
        builds: [{ package: "packages/missing-build", type: "missing_build_config" }],
        alignment: [{ package: "packages/local", entry: "src/", type: "local_alignment" }],
      }),
    ).toEqual([
      {
        issueType: "git_ignored",
        target: "src/generated.ts",
        summary: "src/generated.ts is ignored by Git.",
        action: "Track the source file, or add an explicit health policy exclusion if it is generated.",
      },
      {
        issueType: "missing_build_config",
        target: "packages/missing-build",
        summary: "packages/missing-build is missing a build config.",
        action: "Add the package build configuration or mark the package exempt in the project health policy.",
      },
      {
        issueType: "local_alignment",
        target: "packages/local",
        summary: "packages/local resolves to src/ instead of its build output.",
        action: "Point package entrypoints at build output, or run the project's configured resolution-alignment workflow.",
      },
    ]);
  });
});

describe("healthCommand", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.exitCode = undefined;
    mockExistsSync.mockReturnValue(false);
    mockReadFileSync.mockReturnValue("{}");
    mockAudit.mockResolvedValue({ git: [], builds: [], alignment: [] });
    mockCheckResolutionStatus.mockResolvedValue([]);
  });

  it("runs audit and checkResolutionStatus", async () => {
    await healthCommand.parseAsync([], { from: "user" });
    expect(mockAudit).toHaveBeenCalled();
    expect(mockCheckResolutionStatus).toHaveBeenCalled();
  });

  it("uses the Refarm preset when no project health policy exists", async () => {
    await healthCommand.parseAsync([], { from: "user" });
    expect(mockFileSystemAuditor).toHaveBeenCalledWith({
      ignoredGitVisibilityPatterns: [
        "**/*.d.ts",
        "packages/pi-agent/src/bindings.rs",
      ],
    });
    expect(mockRefarmProjectAuditor).toHaveBeenCalledWith({
      preset: "refarm",
      ignoredGitVisibilityPatterns: [
        "**/*.d.ts",
        "packages/pi-agent/src/bindings.rs",
      ],
    });
    expect(mockProjectAuditor).not.toHaveBeenCalled();
  });

  it("uses generic workspace policy from refarm.config.json when configured", async () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(JSON.stringify({
      health: {
        workspaceRoots: ["modules"],
        exemptPackageIds: ["modules/meta"],
        ignoredGitVisibilityPatterns: ["**/*.generated.ts"],
        title: "Example Workspace Health",
      },
    }));

    await healthCommand.parseAsync([], { from: "user" });

    const expectedPolicy = {
      preset: "workspace",
      workspaceRoots: ["modules"],
      exemptPackageIds: ["modules/meta"],
      ignoredGitVisibilityPatterns: ["**/*.generated.ts"],
      title: "Example Workspace Health",
    };
    expect(mockFileSystemAuditor).toHaveBeenCalledWith({
      ignoredGitVisibilityPatterns: ["**/*.generated.ts"],
    });
    expect(mockProjectAuditor).toHaveBeenCalledWith(expectedPolicy);
    expect(mockRefarmProjectAuditor).not.toHaveBeenCalled();
  });

  it("does not throw when all checks pass", async () => {
    await expect(healthCommand.parseAsync([], { from: "user" })).resolves.not.toThrow();
  });

  it("does not throw when health issues are found", async () => {
    mockAudit.mockResolvedValue({
      git: [{ file: "src/missing.ts", type: "ignored" }],
      builds: [],
      alignment: [],
    });
    await expect(healthCommand.parseAsync([], { from: "user" })).resolves.not.toThrow();
  });

  it("emits machine-readable health report with --json", async () => {
    mockCheckResolutionStatus.mockResolvedValue([
      { package: "apps/refarm", mode: "LINKED (dist)" },
    ]);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await healthCommand.parseAsync(["--json"], { from: "user" });

    const output = String(logSpy.mock.calls[0]?.[0]);
    expect(output).toContain('"ok": true');
    expect(output).toContain('"issueCount": 0');
    expect(output).toContain('"recommendations"');
    expect(output).toContain('"resolution"');
    logSpy.mockRestore();
  });

  it("sets exit code with --fail-on-issues when issues are found", async () => {
    mockAudit.mockResolvedValue({
      git: [],
      builds: [{ package: "apps/missing-build", type: "missing_build_config" }],
      alignment: [],
    });
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await healthCommand.parseAsync(["--fail-on-issues"], { from: "user" });

    expect(process.exitCode).toBe(1);
    expect(logSpy.mock.calls.some(([message]) =>
      String(message).includes("Recommendations"),
    )).toBe(true);
    logSpy.mockRestore();
  });
});

describe("resolveHealthPolicy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExistsSync.mockReturnValue(false);
    mockReadFileSync.mockReturnValue("{}");
  });

  it("falls back to the Refarm policy when no config exists", () => {
    expect(resolveHealthPolicy("/tmp/project")).toEqual({
      preset: "refarm",
      ignoredGitVisibilityPatterns: [
        "**/*.d.ts",
        "packages/pi-agent/src/bindings.rs",
      ],
    });
  });

  it("normalizes health arrays and ignores invalid values", () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(JSON.stringify({
      health: {
        preset: "workspace",
        workspaceRoots: ["packages", 1, ""],
        exemptPackageIds: ["packages/meta", null],
        ignoredGitVisibilityPatterns: ["**/*.generated.ts", false],
        title: "Configured Health",
      },
    }));

    expect(resolveHealthPolicy("/tmp/project")).toEqual({
      preset: "workspace",
      workspaceRoots: ["packages"],
      exemptPackageIds: ["packages/meta"],
      ignoredGitVisibilityPatterns: ["**/*.generated.ts"],
      title: "Configured Health",
    });
  });

  it("keeps Refarm git visibility defaults when preset is configured without overrides", () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(JSON.stringify({
      health: {
        preset: "refarm",
      },
    }));

    expect(resolveHealthPolicy("/tmp/project")).toEqual({
      preset: "refarm",
      ignoredGitVisibilityPatterns: [
        "**/*.d.ts",
        "packages/pi-agent/src/bindings.rs",
      ],
    });
  });
});
