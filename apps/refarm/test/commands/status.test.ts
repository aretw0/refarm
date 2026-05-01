import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockBoot, mockShutdown } = vi.hoisted(() => ({
  mockBoot: vi.fn(),
  mockShutdown: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@refarm.dev/tractor", () => ({
  Tractor: {
    boot: mockBoot,
  },
}));

vi.mock("@refarm.dev/cli/status", () => ({
  buildRefarmStatusJson: vi.fn().mockReturnValue({
    schemaVersion: 1,
    host: { app: "apps/refarm", command: "refarm", profile: "dev", mode: "headless" },
    renderer: { id: "refarm-headless", kind: "headless", capabilities: ["surfaces", "telemetry", "diagnostics"] },
    runtime: { ready: true, databaseName: "refarm-main", namespace: "refarm-main" },
    plugins: { installed: 0, active: 0, rejectedSurfaces: 0, surfaceActions: 0 },
    trust: { profile: "strict", warnings: 0, critical: 0 },
    streams: { active: 0, terminal: 0 },
    diagnostics: [],
  }),
}));

import { statusCommand } from "../../src/commands/status.js";

describe("statusCommand", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockBoot.mockResolvedValue({
      namespace: "refarm-main",
      defaultSecurityMode: "strict",
      shutdown: mockShutdown,
    });
  });

  it("boots Tractor with logLevel silent", async () => {
    await statusCommand.parseAsync(["--json"], { from: "user" });
    expect(mockBoot).toHaveBeenCalledWith(
      expect.objectContaining({ logLevel: "silent" }),
    );
  });

  it("calls tractor.shutdown after producing output", async () => {
    await statusCommand.parseAsync(["--json"], { from: "user" });
    expect(mockShutdown).toHaveBeenCalled();
  });

  it("outputs valid JSON with schemaVersion:1 when --json is passed", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    await statusCommand.parseAsync(["--json"], { from: "user" });
    const output = spy.mock.calls.find(([line]) =>
      typeof line === "string" && line.includes("schemaVersion")
    );
    expect(output).toBeDefined();
    const parsed = JSON.parse(output![0] as string);
    expect(parsed.schemaVersion).toBe(1);
    spy.mockRestore();
  });
});
