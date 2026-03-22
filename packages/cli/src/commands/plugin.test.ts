import { describe, it, expect, vi, beforeEach } from "vitest";

// vi.hoisted() runs before vi.mock() hoisting
const { mockResolveRemote, mockListPlugins, mockGetPlugin, mockDeactivatePlugin, mockExecFileSync } = vi.hoisted(() => ({
  mockResolveRemote: vi.fn(),
  mockListPlugins: vi.fn().mockReturnValue([]),
  mockGetPlugin: vi.fn(),
  mockDeactivatePlugin: vi.fn(),
  mockExecFileSync: vi.fn(),
}));

vi.mock("@refarm.dev/registry", () => ({
  SovereignRegistry: vi.fn().mockImplementation(function () {
    return {
      resolveRemote: mockResolveRemote,
      listPlugins: mockListPlugins,
      getPlugin: mockGetPlugin,
      deactivatePlugin: mockDeactivatePlugin,
    };
  }),
}));

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal() as any;
  return {
    ...actual,
    execFileSync: mockExecFileSync,
    default: {
      ...actual.default,
      execFileSync: mockExecFileSync,
    }
  };
});

import { pluginCommand } from "./plugin.js";

describe("pluginCommand", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListPlugins.mockReturnValue([]);
    mockGetPlugin.mockReturnValue(undefined);
    mockDeactivatePlugin.mockResolvedValue(undefined);
  });

  async function runPlugin(...args: string[]) {
    await pluginCommand.parseAsync(args, { from: "user" });
  }

  describe("plugin install <id>", () => {
    it("calls registry.resolveRemote with id and default URL", async () => {
      const mockEntry = {
        manifest: { id: "my-plugin", version: "0.1.0" },
        status: "registered"
      };
      mockResolveRemote.mockResolvedValue(mockEntry);

      await runPlugin("install", "my-plugin");

      expect(mockResolveRemote).toHaveBeenCalledWith(
        "my-plugin",
        "https://registry.refarm.dev/plugins/my-plugin.json"
      );
    });

    it("calls registry.resolveRemote with custom source URL when --source is provided", async () => {
      const mockEntry = {
        manifest: { id: "my-plugin", version: "0.1.0" },
        status: "registered"
      };
      mockResolveRemote.mockResolvedValue(mockEntry);

      await runPlugin("install", "my-plugin", "--source", "https://custom.example.com/plugin.json");

      expect(mockResolveRemote).toHaveBeenCalledWith(
        "my-plugin",
        "https://custom.example.com/plugin.json"
      );
    });

    it("sets process.exitCode = 1 when resolveRemote throws", async () => {
      mockResolveRemote.mockRejectedValue(new Error("Network error"));
      const originalExitCode = process.exitCode;

      await runPlugin("install", "bad-plugin");

      expect(process.exitCode).toBe(1);
      process.exitCode = originalExitCode; // restore
    });
  });

  describe("plugin list", () => {
    it("calls registry.listPlugins()", async () => {
      await runPlugin("list");
      expect(mockListPlugins).toHaveBeenCalled();
    });

    it("handles a non-empty registry", async () => {
      mockListPlugins.mockReturnValue([
        { manifest: { id: "plugin-a", version: "1.0.0" }, status: "active" }
      ]);
      // Should not throw
      await expect(runPlugin("list")).resolves.not.toThrow();
    });
  });

  describe("plugin remove <id>", () => {
    it("sets process.exitCode = 1 when plugin not found", async () => {
      mockGetPlugin.mockReturnValue(undefined);
      const originalExitCode = process.exitCode;

      await runPlugin("remove", "unknown-plugin");

      expect(process.exitCode).toBe(1);
      process.exitCode = originalExitCode;
    });

    it("calls deactivatePlugin when plugin is active", async () => {
      mockGetPlugin.mockReturnValue({ manifest: { id: "active-plugin" }, status: "active" });

      await runPlugin("remove", "active-plugin");

      expect(mockDeactivatePlugin).toHaveBeenCalledWith("active-plugin");
    });

    it("does NOT call deactivatePlugin when plugin is not active", async () => {
      mockGetPlugin.mockReturnValue({ manifest: { id: "idle-plugin" }, status: "registered" });

      await runPlugin("remove", "idle-plugin");

      expect(mockDeactivatePlugin).not.toHaveBeenCalled();
    });
  });

  describe("plugin search <query>", () => {
    it("completes without error", async () => {
      await expect(runPlugin("search", "weather")).resolves.not.toThrow();
    });
  });

  describe("plugin bundle <input>", () => {
    beforeEach(() => {
      mockExecFileSync.mockReturnValue(undefined);
    });

    it("calls jco transpile with correct arguments", async () => {
      await runPlugin("bundle", "my-plugin.wasm", "-o", "./out");

      expect(mockExecFileSync).toHaveBeenCalledWith(
        "npx",
        expect.arrayContaining(["jco", "transpile", "my-plugin.wasm", "-o", "./out"]),
        expect.objectContaining({ stdio: "inherit" })
      );
    });

    it("uses input filename as plugin name when --name not provided", async () => {
      await runPlugin("bundle", "my-plugin.wasm");

      expect(mockExecFileSync).toHaveBeenCalledWith(
        "npx",
        expect.arrayContaining(["--name", "my-plugin"]),
        expect.any(Object)
      );
    });

    it("uses provided --name when given", async () => {
      await runPlugin("bundle", "my-plugin.wasm", "--name", "custom-name");

      expect(mockExecFileSync).toHaveBeenCalledWith(
        "npx",
        expect.arrayContaining(["--name", "custom-name"]),
        expect.any(Object)
      );
    });

    it("sets process.exitCode = 1 when execFileSync throws", async () => {
      mockExecFileSync.mockImplementation(() => {
        throw new Error("jco not found");
      });
      const originalExitCode = process.exitCode;

      await runPlugin("bundle", "bad-plugin.wasm");

      expect(process.exitCode).toBe(1);
      process.exitCode = originalExitCode;
    });
  });
});
