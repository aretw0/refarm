import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockBoot, mockBuildRefarmStatusJson, mockShutdown } = vi.hoisted(() => ({
  mockBoot: vi.fn(),
  mockBuildRefarmStatusJson: vi.fn(),
  mockShutdown: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@refarm.dev/tractor", () => ({
  Tractor: {
    boot: mockBoot,
  },
}));

vi.mock("@refarm.dev/cli/status", () => ({
  buildRefarmStatusJson: mockBuildRefarmStatusJson,
}));

import { statusCommand } from "../../src/commands/status.js";

describe("statusCommand", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockBuildRefarmStatusJson.mockImplementation((input: any) => ({
      schemaVersion: 1,
      host: input.host,
      renderer: input.renderer,
      runtime: input.runtime,
      plugins: { installed: 0, active: 0, rejectedSurfaces: 0, surfaceActions: 0 },
      trust: input.trust,
      streams: { active: 0, terminal: 0 },
      diagnostics: [],
    }));
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

  it("forwards requested renderer to status builder", async () => {
    await statusCommand.parseAsync(["--json", "--renderer", "web"], {
      from: "user",
    });
    expect(mockBuildRefarmStatusJson).toHaveBeenCalledWith(
      expect.objectContaining({
        host: expect.objectContaining({ mode: "web" }),
        renderer: expect.objectContaining({ kind: "web" }),
      }),
    );
  });

  it("fails fast for unknown renderer kinds", async () => {
    await expect(
      statusCommand.parseAsync(["--json", "--renderer", "matrix"], {
        from: "user",
      }),
    ).rejects.toThrow(/Invalid renderer kind/);
    expect(mockBoot).not.toHaveBeenCalled();
  });
});
