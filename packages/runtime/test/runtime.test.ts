import { describe, expect, it } from "vitest";
import {
  createNullRuntimeStatusSummary,
  createNullRuntimeSummary,
  parseRuntimeAutostartMode,
  parseRuntimeEngineMode,
  RUNTIME_AUTOSTART_MODES,
  RUNTIME_ENGINE_MODES,
  type RuntimeEngineSummary,
} from "../src/index.js";

describe("runtime summary contracts", () => {
  it("creates a null summary with ready false and empty strings", () => {
    expect(createNullRuntimeSummary()).toEqual({
      ready: false,
      databaseName: "",
      namespace: "",
    });
  });

  it("creates a null status summary for unavailable runtime state", () => {
    expect(createNullRuntimeStatusSummary()).toEqual({
      configuredEngine: "auto",
      activeEngine: "unknown",
      autostart: "ask",
      reason: "unavailable",
      ready: false,
    });
  });

  it("accepts partial engine summaries for status surfaces", () => {
    const engine: RuntimeEngineSummary = {
      configuredEngine: "auto",
      activeEngine: "unknown",
    };

    expect(engine).toEqual({
      configuredEngine: "auto",
      activeEngine: "unknown",
    });
  });

  it("publishes runtime engine and autostart mode contracts", () => {
    expect(RUNTIME_ENGINE_MODES).toEqual(["auto", "rust", "ts"]);
    expect(RUNTIME_AUTOSTART_MODES).toEqual(["ask", "always", "never"]);
  });

  it("parses runtime engine and autostart modes from operator input", () => {
    expect(parseRuntimeEngineMode(" Rust ")).toBe("rust");
    expect(parseRuntimeEngineMode("python")).toBeNull();
    expect(parseRuntimeAutostartMode(" ALWAYS ")).toBe("always");
    expect(parseRuntimeAutostartMode(false)).toBeNull();
  });
});
