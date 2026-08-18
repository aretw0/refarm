import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockAudit,
  mockCheckResolutionStatus,
  mockComplexityAuditor,
  mockConfigNodeAuditor,
  mockFileSystemAuditor,
  mockProjectAuditor,
  mockRefarmProjectAuditor,
  mockExistsSync,
  mockReadFileSync,
  mockWriteFileSync,
  mockMkdirSync,
  mockRenameSync,
} = vi.hoisted(() => ({
  mockAudit: vi.fn().mockResolvedValue({ git: [], builds: [], alignment: [] }),
  mockCheckResolutionStatus: vi.fn().mockResolvedValue([]),
  mockComplexityAuditor: vi.fn(),
  mockConfigNodeAuditor: vi.fn(),
  mockFileSystemAuditor: vi.fn(),
  mockProjectAuditor: vi.fn(),
  mockRefarmProjectAuditor: vi.fn(),
  mockExistsSync: vi.fn().mockReturnValue(false),
  mockReadFileSync: vi.fn(),
  mockWriteFileSync: vi.fn(),
  // `health-audit-cache.ts`'s `writeHealthAuditCache` (real, unmocked) calls
  // `fs.mkdirSync`/`fs.renameSync` with `rootDir` defaulting to the REAL `process.cwd()`
  // (`apps/refarm` while this suite runs) whenever a test's mocked `audit()` reports a
  // clean result. Left un-stubbed, those two calls fell through `...actual` below to the
  // REAL, unguarded fs (this file's own local `node:fs` mock replaces the suite-wide
  // write-guard from vitest.setup.ts, not just adds to it) and created a real
  // `apps/refarm/.refarm/cache/` directory on disk — discovered because Task 4's new
  // `sovereign:unloaded-dir` doctor finding started reading exactly that directory's
  // presence and made the leak visible as flaky, order-dependent test failures elsewhere
  // in this same suite. Stubbed here, not left to `actual`, for the same reason
  // `writeFileSync` already was.
  mockMkdirSync: vi.fn(),
  mockRenameSync: vi.fn(),
}));

// PARTIAL. The auditors are replaced because they reach the filesystem; the pure readers
// (`readToolRequirements`) are kept, because a hand-written stand-in would let this suite pass
// against a contract the package no longer has — and a total mock silently drops every export
// added later, which is how a missing reader surfaced here as "config could not be parsed".
vi.mock("@refarm.dev/health", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@refarm.dev/health")>()),
  HealthCore: vi.fn().mockImplementation(function () {
    return { register: vi.fn(), audit: mockAudit, checkResolutionStatus: mockCheckResolutionStatus };
  }),
  ComplexityAuditor: mockComplexityAuditor,
  ConfigNodeAuditor: mockConfigNodeAuditor,
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
    mkdirSync: mockMkdirSync,
    renameSync: mockRenameSync,
    default: {
      ...actual,
      existsSync: mockExistsSync,
      readFileSync: mockReadFileSync,
      writeFileSync: mockWriteFileSync,
      mkdirSync: mockMkdirSync,
      renameSync: mockRenameSync,
    },
  };
});

import {
	buildHealthRecommendations,
	buildHealthReport,
	healthCommand,
	resolveHealthPolicy,
	resolveHealthPolicyReport,
	suggestHealthPolicy,
} from "../../src/commands/health.js";

describe("buildHealthReport", () => {
  it("counts git, build and alignment issues", () => {
    const report = buildHealthReport(
      {
        git: [{ file: "src/ignored.ts", type: "ignored" }],
        builds: [{ package: "apps/missing-build", type: "missing_build_config" }],
        alignment: [{ package: "packages/local", entry: "src/", type: "local_alignment" }],
        namespaceWarnings: [{ path: ".project", type: "undeclared_workspace_namespace" }],
        complexity: [{ file: "src/large.ts", type: "complexity_large_file", lines: 1200 }],
      },
      [{ package: "packages/local", mode: "LOCAL (src)" }],
    );

    expect(report.ok).toBe(false);
    expect(report.issueCount).toBe(4);
    expect(report.resolution).toEqual([{ package: "packages/local", mode: "LOCAL (src)" }]);
    expect(report.recommendations).toHaveLength(5);
    expect(report.nextActions).toEqual([
      "Track the source file, or add an explicit health policy exclusion if it is generated.",
      "Add the package build configuration or mark the package exempt in the project health policy.",
      "Point package entrypoints at build output, or run the project's configured resolution-alignment workflow.",
      "Declare the namespace owner, purpose, persistence, and access in refarm.config.json, or remove the drift.",
      "Split the file or add a documented health.complexity allowed pattern for generated/vendor content.",
    ]);
    expect(report.nextCommands).toEqual([
      "refarm health suggest-policy --json",
      "node packages/toolbox/src/cli.mjs reso dist",
      "refarm health policy --json",
    ]);
  });

  it("does not count workspace namespace warnings as health issues", () => {
    const report = buildHealthReport(
      {
        git: [],
        builds: [],
        alignment: [],
        namespaceWarnings: [{ path: ".project", type: "undeclared_workspace_namespace" }],
      },
      [],
    );

    expect(report.ok).toBe(true);
    expect(report.issueCount).toBe(0);
    expect(report.recommendations).toEqual([
      expect.objectContaining({
        issueType: "undeclared_workspace_namespace",
        severity: "warning",
        target: ".project",
      }),
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
        namespaceWarnings: [{ path: ".project", type: "undeclared_workspace_namespace" }],
        complexity: [{ file: "src/large.ts", type: "complexity_large_file", lines: 1200 }],
      }),
    ).toEqual([
      {
        issueType: "git_ignored",
        diagnostic: "git_ignored",
        target: "src/generated.ts",
        summary: "src/generated.ts is ignored by Git.",
        action: "Track the source file, or add an explicit health policy exclusion if it is generated.",
        command: "refarm health suggest-policy --json",
      },
      {
        issueType: "missing_build_config",
        diagnostic: "missing_build_config",
        target: "packages/missing-build",
        summary: "packages/missing-build is missing a build config.",
        action: "Add the package build configuration or mark the package exempt in the project health policy.",
        command: "refarm health suggest-policy --json",
      },
      {
        issueType: "local_alignment",
        diagnostic: "local_alignment",
        target: "packages/local",
        summary: "packages/local resolves to src/ instead of its build output.",
        action: "Point package entrypoints at build output, or run the project's configured resolution-alignment workflow.",
        command: "node packages/toolbox/src/cli.mjs reso dist",
      },
      {
        issueType: "undeclared_workspace_namespace",
        diagnostic: "undeclared_workspace_namespace",
        severity: "warning",
        target: ".project",
        summary: ".project is present without a workspaceNamespaces declaration.",
        action: "Declare the namespace owner, purpose, persistence, and access in refarm.config.json, or remove the drift.",
        command: "refarm health policy --json",
      },
      {
        issueType: "complexity_large_file",
        diagnostic: "complexity_large_file",
        target: "src/large.ts",
        summary: "src/large.ts has 1200 lines.",
        action: "Split the file or add a documented health.complexity allowed pattern for generated/vendor content.",
        command: "refarm health suggest-policy --json",
      },
    ]);
  });
});

describe("suggestHealthPolicy", () => {
  it("keeps existing policy and compacts generated docs into directory patterns", () => {
    expect(suggestHealthPolicy(
      {
        preset: "workspace",
        ignoredGitVisibilityPatterns: ["**/*.generated.ts"],
        workspaceRoots: ["packages"],
        title: "External Workspace",
      },
      {
        git: [
          { file: "docs/_site/a.md", type: "git_ignored" },
          { file: "docs/_site/guides/b.md", type: "git_ignored" },
          { file: "packages/web-skills/scripts/package-lock.json", type: "git_ignored" },
        ],
        builds: [
          { package: "packages/web-skills", type: "missing_build_config" },
          { package: "packages/pi-skills", type: "missing_build_config" },
        ],
        alignment: [],
      },
    )).toEqual({
      preset: "workspace",
      workspaceRoots: ["packages"],
      exemptPackageIds: ["packages/pi-skills", "packages/web-skills"],
      ignoredGitVisibilityPatterns: [
        "**/*.generated.ts",
        "docs/_site/**",
        "packages/web-skills/scripts/package-lock.json",
      ],
      title: "External Workspace",
    });
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

  it("documents the health sub-verbs and doctor handoff in help", () => {
    let help = "";
    healthCommand.configureOutput({
      writeOut: (value) => {
        help += value;
      },
    });
    healthCommand.outputHelp();

    // The group projector lists each sub-verb as a subcommand; the flag-mode
    // form is gone (policy modes are sub-verbs now, not a 3-way flag switch).
    expect(help).toContain("audit");
    expect(help).toContain("policy");
    expect(help).toContain("suggest-policy");
    expect(help).toContain("apply-policy");
    // The preserved Notes block.
    expect(help).toContain("It does not require the Refarm runtime sidecar");
    expect(help).toContain("A non-zero exit signals issues were found");
    expect(help).toContain("refarm doctor --next-action");
    expect(help).toContain(".refarm/config.json");
  });

  it("uses the Refarm preset in the Refarm monorepo when no project health policy exists", async () => {
    mockExistsSync.mockImplementation((value) => {
      const normalizedPath = String(value).replaceAll("\\", "/");
      return normalizedPath.endsWith("apps/refarm/package.json");
    });
    mockReadFileSync.mockReturnValue(JSON.stringify({ name: "@refarm.dev/refarm" }));

    await healthCommand.parseAsync([], { from: "user" });
    expect(mockFileSystemAuditor).toHaveBeenCalledWith({
      ignoredGitVisibilityPatterns: [
        "**/*.d.ts",
        "**/src/bindings.rs",
      ],
    });
    expect(mockRefarmProjectAuditor).toHaveBeenCalledWith({
      preset: "refarm",
      ignoredGitVisibilityPatterns: [
        "**/*.d.ts",
        "**/src/bindings.rs",
      ],
    });
    expect(mockProjectAuditor).not.toHaveBeenCalled();
  });

  it("uses generic workspace policy outside the Refarm monorepo when no config exists", async () => {
    await healthCommand.parseAsync([], { from: "user" });
    expect(mockFileSystemAuditor).toHaveBeenCalledWith({
      ignoredGitVisibilityPatterns: [],
    });
    expect(mockProjectAuditor).toHaveBeenCalledWith({
      preset: "workspace",
      ignoredGitVisibilityPatterns: [],
    });
    expect(mockRefarmProjectAuditor).not.toHaveBeenCalled();
    expect(mockComplexityAuditor).not.toHaveBeenCalled();
  });

  it("uses generic workspace policy from .refarm/config.json when configured", async () => {
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
    expect(mockComplexityAuditor).not.toHaveBeenCalled();
  });

  it("preserves versioned git visibility policy when local config adds operator overrides", () => {
    mockExistsSync.mockImplementation((value) => {
      const normalizedPath = String(value).replaceAll("\\", "/");
      return normalizedPath.endsWith("refarm.config.json")
        || normalizedPath.endsWith(".refarm/config.json");
    });
    mockReadFileSync.mockImplementation((value) => {
      const normalizedPath = String(value).replaceAll("\\", "/");
      if (normalizedPath.endsWith("refarm.config.json")) {
        return JSON.stringify({
          health: {
            ignoredGitVisibilityPatterns: [
              "packages/source-provider-ref/pkg-plugin/**",
              "packages/vault-surface-ref/pkg-plugin/**",
            ],
          },
        });
      }
      return JSON.stringify({
        health: {
          preset: "refarm",
          ignoredGitVisibilityPatterns: ["local/generated/**"],
        },
      });
    });

    expect(resolveHealthPolicy("/tmp/project")).toEqual({
      preset: "refarm",
      ignoredGitVisibilityPatterns: [
        "packages/source-provider-ref/pkg-plugin/**",
        "packages/vault-surface-ref/pkg-plugin/**",
        "local/generated/**",
      ],
    });
  });

  it("registers complexity auditor only when health policy enables it", async () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(JSON.stringify({
      health: {
        workspaceRoots: ["modules"],
        complexity: {
          enabled: true,
          maxLines: 800,
          paths: ["modules"],
          allowedPatterns: ["modules/generated/**"],
          reportLimit: 5,
        },
      },
    }));

    await healthCommand.parseAsync([], { from: "user" });

    expect(mockComplexityAuditor).toHaveBeenCalledWith({
      maxLines: 800,
      paths: ["modules"],
      allowedPatterns: ["modules/generated/**"],
      reportLimit: 5,
    });
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
    expect(output).toContain('"command": "health"');
    expect(output).toContain('"operation": "audit"');
    expect(output).toContain('"ok": true');
    expect(output).toContain('"issueCount": 0');
    expect(output).toContain('"nextAction": null');
    expect(output).toContain('"recommendations"');
    expect(output).toContain('"nextActions"');
    expect(output).toContain('"nextCommand": null');
    expect(output).toContain('"nextCommands"');
    expect(output).toContain('"resolution"');
    logSpy.mockRestore();
  });

  it("applies the suggested health policy only when explicitly requested", async () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(JSON.stringify({
      brand: { name: "external" },
      health: {
        preset: "workspace",
        ignoredGitVisibilityPatterns: [],
      },
    }));
    mockAudit.mockResolvedValue({
      git: [{ file: "docs/_site/generated.md", type: "git_ignored" }],
      builds: [{ package: "packages/web-skills", type: "missing_build_config" }],
      alignment: [],
    });
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await healthCommand.parseAsync(["apply-policy", "--json"], { from: "user" });

    const configWrite = mockWriteFileSync.mock.calls.find(([filePath]) =>
      String(filePath).replaceAll("\\", "/").endsWith(".refarm/config.json")
    );
    expect(configWrite).toBeDefined();
    const [configPath, content, encoding] = configWrite!;
    expect(String(configPath).replaceAll("\\", "/")).toContain(".refarm/config.json");
    expect(encoding).toBe("utf-8");
    expect(JSON.parse(String(content))).toEqual({
      brand: { name: "external" },
      health: {
        preset: "workspace",
        exemptPackageIds: ["packages/web-skills"],
        ignoredGitVisibilityPatterns: ["docs/_site/**"],
      },
    });
    expect(JSON.parse(String(logSpy.mock.calls[0]?.[0]))).toEqual({
      command: "health",
      operation: "policy-application",
      ok: true,
      configPath: expect.stringContaining(".refarm"),
      policy: {
        preset: "workspace",
        ignoredGitVisibilityPatterns: [],
      },
      previousHealth: {
        preset: "workspace",
        ignoredGitVisibilityPatterns: [],
      },
      appliedHealth: {
        preset: "workspace",
        exemptPackageIds: ["packages/web-skills"],
        ignoredGitVisibilityPatterns: ["docs/_site/**"],
      },
      sourceIssueCount: 2,
      nextAction: "refarm health --next-action --json",
      nextActions: ["refarm health --next-action --json"],
      nextCommand: "refarm health --next-action --json",
      nextCommands: ["refarm health --next-action --json"],
    });
    logSpy.mockRestore();
  });

  it("emits the resolved health policy without running auditors", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await healthCommand.parseAsync(["policy", "--json"], { from: "user" });

    expect(mockAudit).not.toHaveBeenCalled();
    expect(mockCheckResolutionStatus).not.toHaveBeenCalled();
    expect(JSON.parse(String(logSpy.mock.calls[0]?.[0]))).toEqual({
      command: "health",
      operation: "policy",
      ok: true,
      rootDir: process.cwd(),
      configPath: expect.stringContaining(".refarm"),
      configFound: false,
      source: "workspace-default",
      policy: {
        preset: "workspace",
        ignoredGitVisibilityPatterns: [],
      },
      nextAction: null,
      nextActions: [],
      nextCommand: null,
      nextCommands: [],
    });
    logSpy.mockRestore();
  });

  it("emits a suggested health policy from current diagnostics", async () => {
    mockAudit.mockResolvedValue({
      git: [
        { file: "docs/_site/generated.md", type: "git_ignored" },
        { file: "packages/web-skills/skills/web-browser/scripts/package-lock.json", type: "git_ignored" },
      ],
      builds: [{ package: "packages/web-skills", type: "missing_build_config" }],
      alignment: [],
    });
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await healthCommand.parseAsync(["suggest-policy", "--json"], { from: "user" });

    expect(mockAudit).toHaveBeenCalledOnce();
    expect(mockCheckResolutionStatus).toHaveBeenCalledOnce();
    expect(JSON.parse(String(logSpy.mock.calls[0]?.[0]))).toEqual({
      command: "health",
      operation: "policy-suggestion",
      ok: true,
      policy: {
        preset: "workspace",
        ignoredGitVisibilityPatterns: [],
      },
      suggestedHealth: {
        preset: "workspace",
        exemptPackageIds: ["packages/web-skills"],
        ignoredGitVisibilityPatterns: [
          "docs/_site/**",
          "packages/web-skills/skills/web-browser/scripts/package-lock.json",
        ],
      },
      sourceIssueCount: 3,
      nextAction: null,
      nextActions: [],
      nextCommand: null,
      nextCommands: [],
    });
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
      nextCommand: "refarm health suggest-policy --json",
      nextCommands: ["refarm health suggest-policy --json"],
    });
    logSpy.mockRestore();
  });

  it("emits only the first health recovery command with --next-command", async () => {
    mockAudit.mockResolvedValue({
      git: [],
      builds: [],
      alignment: [{ package: "packages/local", entry: "src/", type: "local_alignment" }],
    });
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await healthCommand.parseAsync(["--next-command"], { from: "user" });

    expect(logSpy).toHaveBeenCalledOnce();
    expect(logSpy).toHaveBeenCalledWith("node packages/toolbox/src/cli.mjs reso dist");
    logSpy.mockRestore();
  });

  it("emits the first health recovery command as JSON", async () => {
    mockAudit.mockResolvedValue({
      git: [],
      builds: [],
      alignment: [{ package: "packages/local", entry: "src/", type: "local_alignment" }],
    });
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await healthCommand.parseAsync(["--next-command", "--json"], { from: "user" });

    expect(JSON.parse(String(logSpy.mock.calls[0]?.[0]))).toEqual({
      ok: false,
      nextAction: "Point package entrypoints at build output, or run the project's configured resolution-alignment workflow.",
      nextActions: [
        "Point package entrypoints at build output, or run the project's configured resolution-alignment workflow.",
      ],
      nextCommand: "node packages/toolbox/src/cli.mjs reso dist",
      nextCommands: ["node packages/toolbox/src/cli.mjs reso dist"],
    });
    logSpy.mockRestore();
  });

  it("exits non-zero when issues are found (health is a diagnostic gate)", async () => {
    mockAudit.mockResolvedValue({
      git: [],
      builds: [{ package: "apps/missing-build", type: "missing_build_config" }],
      alignment: [],
    });
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    // No flag: the envelope's own ok:false (issues found) drives the exit code
    // via the group projector's default (ok===false → 1). --fail-on-issues is
    // gone; the honest exit IS the default, the way test/lint/tsc behave.
    await healthCommand.parseAsync([], { from: "user" });

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

  it("falls back to workspace policy outside Refarm when no config exists", () => {
    expect(resolveHealthPolicy("/tmp/project")).toEqual({
      preset: "workspace",
      ignoredGitVisibilityPatterns: [],
    });
  });

  it("reports workspace fallback policy metadata outside Refarm when no config exists", () => {
    expect(resolveHealthPolicyReport("/tmp/project")).toEqual({
      command: "health",
      operation: "policy",
      ok: true,
      rootDir: "/tmp/project",
      configPath: "/tmp/project/.refarm/config.json",
      configFound: false,
      source: "workspace-default",
      policy: {
        preset: "workspace",
        ignoredGitVisibilityPatterns: [],
      },
      nextAction: null,
      nextActions: [],
      nextCommand: null,
      nextCommands: [],
    });
  });

  it("falls back to the Refarm policy inside the Refarm monorepo when no config exists", () => {
    mockExistsSync.mockImplementation((value) => {
      const normalizedPath = String(value).replaceAll("\\", "/");
      return normalizedPath.endsWith("apps/refarm/package.json");
    });
    mockReadFileSync.mockReturnValue(JSON.stringify({ name: "@refarm.dev/refarm" }));

    expect(resolveHealthPolicy("/tmp/refarm")).toEqual({
      preset: "refarm",
      ignoredGitVisibilityPatterns: [
        "**/*.d.ts",
        "**/src/bindings.rs",
      ],
    });
  });

  it("reports configured health policy metadata", () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(JSON.stringify({
      workspaceNamespaces: {
        ".project": {
          owner: "pi-project-workflows",
          purpose: "Project workflow state.",
          persistence: "versioned",
          access: "readWrite",
        },
      },
      health: {
        preset: "workspace",
        workspaceRoots: ["modules"],
        exemptPackageIds: ["modules/meta"],
      },
    }));

    expect(resolveHealthPolicyReport("/tmp/project")).toEqual({
      command: "health",
      operation: "policy",
      ok: true,
      rootDir: "/tmp/project",
      configPath: "/tmp/project/.refarm/config.json",
      configFound: true,
      source: "config",
      policy: {
        preset: "workspace",
        workspaceRoots: ["modules"],
        exemptPackageIds: ["modules/meta"],
        ignoredGitVisibilityPatterns: [],
        workspaceNamespaces: [
          {
            id: ".project",
            path: ".project",
            absolutePath: "/tmp/project/.project",
            owner: "pi-project-workflows",
            purpose: "Project workflow state.",
            persistence: "versioned",
            access: "readWrite",
          },
        ],
      },
      nextAction: null,
      nextActions: [],
      nextCommand: null,
      nextCommands: [],
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

  it("normalizes opt-in complexity policy", () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(JSON.stringify({
      health: {
        preset: "workspace",
        complexity: {
          enabled: true,
          maxLines: 750,
          paths: ["src", "", 1],
          allowedPatterns: ["src/generated/**", false],
          reportLimit: 4,
        },
      },
    }));

    expect(resolveHealthPolicy("/tmp/project")).toEqual({
      preset: "workspace",
      ignoredGitVisibilityPatterns: [],
      complexity: {
        enabled: true,
        maxLines: 750,
        paths: ["src"],
        allowedPatterns: ["src/generated/**"],
        reportLimit: 4,
      },
    });
  });

  it("ignores complexity policy unless explicitly enabled", () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(JSON.stringify({
      health: {
        preset: "workspace",
        complexity: {
          maxLines: 750,
        },
      },
    }));

    expect(resolveHealthPolicy("/tmp/project")).toEqual({
      preset: "workspace",
      ignoredGitVisibilityPatterns: [],
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
        "**/src/bindings.rs",
      ],
    });
  });
});
