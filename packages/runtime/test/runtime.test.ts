import { describe, expect, it } from "vitest";
import {
  createNullRuntimeStatusSummary,
  createNullRuntimeSummary,
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
});
