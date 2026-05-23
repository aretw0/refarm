import { beforeEach, describe, expect, it, vi } from "vitest";

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
	buildHealthRecommendations,
	buildHealthReport,
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
    expect(report.nextActions).toEqual([
      "Track the source file, or add an explicit health policy exclusion if it is generated.",
      "Add the package build configuration or mark the package exempt in the project health policy.",
      "Point package entrypoints at build output, or run the project's configured resolution-alignment workflow.",
    ]);
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
        diagnostic: "git_ignored",
        target: "src/generated.ts",
        summary: "src/generated.ts is ignored by Git.",
        action: "Track the source file, or add an explicit health policy exclusion if it is generated.",
      },
      {
        issueType: "missing_build_config",
        diagnostic: "missing_build_config",
        target: "packages/missing-build",
        summary: "packages/missing-build is missing a build config.",
        action: "Add the package build configuration or mark the package exempt in the project health policy.",
      },
      {
        issueType: "local_alignment",
        diagnostic: "local_alignment",
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

  it("documents health policy and doctor handoff in help", () => {
    let help = "";
    healthCommand.configureOutput({
      writeOut: (value) => {
        help += value;
      },
    });
    healthCommand.outputHelp();

    expect(help).toContain("refarm health --fail-on-issues");
    expect(help).toContain("refarm health --next-action");
    expect(help).toContain("refarm health --next-action --json");
    expect(help).toContain("It does not require the Refarm runtime sidecar");
    expect(help).toContain("refarm doctor --next-action");
    expect(help).toContain("refarm.config.json");
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
    expect(output).toContain('"nextActions"');
    expect(output).toContain('"resolution"');
    logSpy.mockRestore();
  });

  it("emits only the first health recovery action with --next-action", async () => {
    mockAudit.mockResolvedValue({
      git: [{ file: "src/missing.ts", type: "ignored" }],
      builds: [{ package: "apps/missing-build", type: "missing_build_config" }],
      alignment: [],
    });
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await healthCommand.parseAsync(["--next-action"], { from: "user" });

    expect(logSpy).toHaveBeenCalledOnce();
    expect(logSpy).toHaveBeenCalledWith(
      "Track the source file, or add an explicit health policy exclusion if it is generated.",
    );
    logSpy.mockRestore();
  });

  it("emits the first health recovery action as JSON", async () => {
    mockAudit.mockResolvedValue({
      git: [{ file: "src/missing.ts", type: "ignored" }],
      builds: [{ package: "apps/missing-build", type: "missing_build_config" }],
      alignment: [],
    });
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await healthCommand.parseAsync(["--next-action", "--json"], { from: "user" });

    expect(JSON.parse(String(logSpy.mock.calls[0]?.[0]))).toEqual({
      ok: false,
      nextAction: "Track the source file, or add an explicit health policy exclusion if it is generated.",
      nextActions: [
        "Track the source file, or add an explicit health policy exclusion if it is generated.",
        "Add the package build configuration or mark the package exempt in the project health policy.",
      ],
    });
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
