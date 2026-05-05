import { beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";

const {
  mockAssertRefarmStatusJson,
  mockBoot,
  mockBuildRefarmStatusJson,
  mockFormatRefarmStatusJson,
  mockFormatRefarmStatusMarkdown,
  mockParseRefarmStatusJson,
  mockShutdown,
} = vi.hoisted(() => ({
  mockAssertRefarmStatusJson: vi.fn(),
  mockBoot: vi.fn(),
  mockBuildRefarmStatusJson: vi.fn(),
  mockFormatRefarmStatusJson: vi.fn(),
  mockFormatRefarmStatusMarkdown: vi.fn(),
  mockParseRefarmStatusJson: vi.fn(),
  mockShutdown: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@refarm.dev/tractor", () => ({
  Tractor: {
    boot: mockBoot,
  },
}));

vi.mock("@refarm.dev/cli/status", () => ({
  assertRefarmStatusJson: mockAssertRefarmStatusJson,
  buildRefarmStatusJson: mockBuildRefarmStatusJson,
  formatRefarmStatusJson: mockFormatRefarmStatusJson,
  formatRefarmStatusMarkdown: mockFormatRefarmStatusMarkdown,
  parseRefarmStatusJson: mockParseRefarmStatusJson,
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
    mockFormatRefarmStatusJson.mockImplementation(
      () => JSON.stringify({ schemaVersion: 1 }, null, 2),
    );
    mockFormatRefarmStatusMarkdown.mockImplementation(() => "# Refarm Status\n");
    mockParseRefarmStatusJson.mockReturnValue({
      schemaVersion: 1,
      host: { app: "apps/refarm", command: "refarm", profile: "dev", mode: "headless" },
      renderer: { id: "refarm-headless", kind: "headless", capabilities: ["diagnostics"] },
      runtime: { ready: true, databaseName: "refarm-main", namespace: "refarm-main" },
      plugins: { installed: 0, active: 0, rejectedSurfaces: 0, surfaceActions: 0 },
      trust: { profile: "strict", warnings: 0, critical: 0 },
      streams: { active: 0, terminal: 0 },
      diagnostics: [],
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
    expect(mockAssertRefarmStatusJson).toHaveBeenCalled();
    expect(mockFormatRefarmStatusJson).toHaveBeenCalledWith(
      expect.objectContaining({ schemaVersion: 1 }),
    );
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

  it("outputs markdown when --markdown is requested", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    await statusCommand.parseAsync(["--markdown"], { from: "user" });
    expect(mockFormatRefarmStatusMarkdown).toHaveBeenCalled();
    expect(spy).toHaveBeenCalledWith("# Refarm Status\n");
    spy.mockRestore();
  });

  it("rejects combining --json and --markdown", async () => {
    await expect(
      statusCommand.parseAsync(["--json", "--markdown"], { from: "user" }),
    ).rejects.toThrow(/Choose only one output format/);
    expect(mockBoot).not.toHaveBeenCalled();
  });

  it("reads status payload from --input without booting Tractor", async () => {
    const readSpy = vi
      .spyOn(fs, "readFileSync")
      .mockImplementation((filePath: fs.PathOrFileDescriptor) => {
        const file = String(filePath);
        if (file.endsWith("status.json")) return "{\"schemaVersion\":1}";
        throw new Error(`unexpected read: ${file}`);
      });

    await statusCommand.parseAsync(["--json", "--input", "status.json"], {
      from: "user",
    });

    expect(mockBoot).not.toHaveBeenCalled();
    expect(mockBuildRefarmStatusJson).not.toHaveBeenCalled();
    expect(mockParseRefarmStatusJson).toHaveBeenCalledWith("{\"schemaVersion\":1}");
    readSpy.mockRestore();
  });

  it("wraps parse errors with input path context", async () => {
    const readSpy = vi
      .spyOn(fs, "readFileSync")
      .mockImplementation((filePath: fs.PathOrFileDescriptor) => {
        const file = String(filePath);
        if (file.endsWith("bad.json")) return "{}";
        throw new Error(`unexpected read: ${file}`);
      });
    mockParseRefarmStatusJson.mockImplementation(() => {
      throw new Error("Unsupported Refarm status schemaVersion=2.");
    });

    await expect(
      statusCommand.parseAsync(["--json", "--input", "bad.json"], {
        from: "user",
      }),
    ).rejects.toThrow(/Failed to parse status input "bad.json"/);

    readSpy.mockRestore();
  });

  it("reads status payload from stdin when --input - is used", async () => {
    const readSpy = vi
      .spyOn(fs, "readFileSync")
      .mockImplementation((filePath: fs.PathOrFileDescriptor) => {
        if (filePath === 0) return "{\"schemaVersion\":1}";
        throw new Error(`unexpected read: ${String(filePath)}`);
      });

    await statusCommand.parseAsync(["--json", "--input", "-"], {
      from: "user",
    });

    expect(mockBoot).not.toHaveBeenCalled();
    expect(mockParseRefarmStatusJson).toHaveBeenCalledWith("{\"schemaVersion\":1}");
    expect(readSpy).toHaveBeenCalledWith(0, "utf-8");
    readSpy.mockRestore();
  });
});
