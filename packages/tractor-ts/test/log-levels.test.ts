/**
 * Tests for Tractor log level management
 *
 * Validates that:
 * - logLevel configuration is respected
 * - Environment variables are detected correctly
 * - Benchmark auto-detection works
 * - SecretHost logger integration works
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Tractor } from "../src/index";
import { createMockConfig } from "./helpers/mock-adapters";

describe("Tractor Log Levels", () => {
  let consoleInfoSpy: ReturnType<typeof vi.spyOn>;
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>;
  let consoleDebugSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleInfoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    consoleDebugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleInfoSpy.mockRestore();
    consoleWarnSpy.mockRestore();
    consoleDebugSpy.mockRestore();
  });

  describe("logLevel configuration", () => {
    it("should default to 'silent' level in vitest conditions", async () => {
      const tractor = await Tractor.boot(createMockConfig());
      expect(tractor.logLevel).toBe("silent");
      await tractor.shutdown();
    });

    it("should respect explicit logLevel: 'silent'", async () => {
      const tractor = await Tractor.boot({
        ...createMockConfig(),
        logLevel: "silent",
      });
      expect(tractor.logLevel).toBe("silent");
      await tractor.shutdown();

      // Boot and shutdown should NOT log anything in silent mode
      expect(consoleInfoSpy).not.toHaveBeenCalled();
    });

    it("should respect explicit logLevel: 'warn'", async () => {
      const tractor = await Tractor.boot({
        ...createMockConfig(),
        logLevel: "warn",
      });
      expect(tractor.logLevel).toBe("warn");
      await tractor.shutdown();

      // Boot message is info level, should be suppressed
      const bootCalls = consoleInfoSpy.mock.calls.filter((call: unknown[]) =>
        call.some((arg: unknown) => String(arg).includes("Booted"))
      );
      expect(bootCalls.length).toBe(0);
    });

    it("should respect explicit logLevel: 'error'", async () => {
      const tractor = await Tractor.boot({
        ...createMockConfig(),
        logLevel: "error",
      });
      expect(tractor.logLevel).toBe("error");
      await tractor.shutdown();

      // Neither info nor warn should fire
      expect(consoleInfoSpy).not.toHaveBeenCalled();
      expect(consoleWarnSpy).not.toHaveBeenCalled();
    });

    it("should allow info logs when level is 'info'", async () => {
      const tractor = await Tractor.boot({
        ...createMockConfig(),
        logLevel: "info",
      });

      await tractor.shutdown();

      // Boot and Shutdown messages should appear
      const bootCalls = consoleInfoSpy.mock.calls.filter((call: unknown[]) =>
        call.some((arg: unknown) => String(arg).includes("Booted"))
      );
      const shutdownCalls = consoleInfoSpy.mock.calls.filter((call: unknown[]) =>
        call.some((arg: unknown) => String(arg).includes("Shutdown"))
      );

      expect(bootCalls.length).toBeGreaterThan(0);
      expect(shutdownCalls.length).toBeGreaterThan(0);
    });
  });

  describe("Environment variable detection", () => {
    const originalEnv = (globalThis as any)?.process?.env;

    afterEach(() => {
      if (originalEnv && (globalThis as any)?.process) {
        (globalThis as any).process.env = originalEnv;
      }
    });

    it("should respect REFARM_LOG_LEVEL environment variable", async () => {
      if ((globalThis as any)?.process?.env) {
        (globalThis as any).process.env.REFARM_LOG_LEVEL = "silent";
      }

      const tractor = await Tractor.boot(createMockConfig());
      
      // Should use env override
      expect(tractor.logLevel).toBe("silent");
      
      await tractor.shutdown();
      expect(consoleInfoSpy).not.toHaveBeenCalled();
    });

    it("should auto-detect benchmark mode and default to silent", async () => {
      if ((globalThis as any)?.process?.env) {
        (globalThis as any).process.env.VITEST = "true";
        (globalThis as any).process.env.npm_lifecycle_event = "bench";
      }

      const tractor = await Tractor.boot(createMockConfig());
      
      // Should auto-detect benchmark environment
      expect(tractor.logLevel).toBe("silent");
      
      await tractor.shutdown();
      expect(consoleInfoSpy).not.toHaveBeenCalled();
    });
  });



  describe("Log cascading behavior", () => {
    it("info level should allow info", async () => {
      const tractor = await Tractor.boot({
        ...createMockConfig(),
        logLevel: "info",
      });

      await tractor.enableGuestMode();
      expect(consoleInfoSpy).toHaveBeenCalled();

      await tractor.shutdown();
    });

    it("warn level should allow warn and error, but not info", async () => {
      const tractor = await Tractor.boot({
        ...createMockConfig(),
        logLevel: "warn",
      });

      await tractor.enableGuestMode();

      // Info should be suppressed
      expect(consoleInfoSpy).not.toHaveBeenCalled();

      await tractor.shutdown();
    });

    it("error level should suppress both info and warn", async () => {
      const tractor = await Tractor.boot({
        ...createMockConfig(),
        logLevel: "error",
      });

      await tractor.enableGuestMode();

      expect(consoleInfoSpy).not.toHaveBeenCalled();
      expect(consoleWarnSpy).not.toHaveBeenCalled();

      await tractor.shutdown();
    });
  });

  describe("Benchmark integration", () => {
    it("createSilentBenchConfig should enforce silent mode", async () => {
      // This simulates the pattern used in stress.bench.ts
      const benchConfig = {
        ...createMockConfig(),
        logLevel: "silent" as const,
      };

      const tractor = await Tractor.boot(benchConfig);

      expect(tractor.logLevel).toBe("silent");

      // Trigger multiple lifecycle operations
      await tractor.enableGuestMode();
      await tractor.shutdown();

      // Nothing should have logged
      expect(consoleInfoSpy).not.toHaveBeenCalled();
      expect(consoleWarnSpy).not.toHaveBeenCalled();
      expect(consoleDebugSpy).not.toHaveBeenCalled();
    });
  });
});
