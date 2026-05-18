import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockAudit, mockCheckResolutionStatus } = vi.hoisted(() => ({
  mockAudit: vi.fn().mockResolvedValue({ git: [], builds: [], alignment: [] }),
  mockCheckResolutionStatus: vi.fn().mockResolvedValue([]),
}));

vi.mock("@refarm.dev/health", () => ({
  HealthCore: vi.fn().mockImplementation(function () {
    return { register: vi.fn(), audit: mockAudit, checkResolutionStatus: mockCheckResolutionStatus };
  }),
  FileSystemAuditor: vi.fn(),
  RefarmProjectAuditor: vi.fn(),
}));

import { buildHealthReport, healthCommand } from "../../src/commands/health.js";

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
  });
});

describe("healthCommand", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.exitCode = undefined;
    mockAudit.mockResolvedValue({ git: [], builds: [], alignment: [] });
    mockCheckResolutionStatus.mockResolvedValue([]);
  });

  it("runs audit and checkResolutionStatus", async () => {
    await healthCommand.parseAsync([], { from: "user" });
    expect(mockAudit).toHaveBeenCalled();
    expect(mockCheckResolutionStatus).toHaveBeenCalled();
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
    logSpy.mockRestore();
  });
});
