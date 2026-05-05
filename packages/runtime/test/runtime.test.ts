import { describe, expect, it } from "vitest";
import { createNullRuntimeSummary } from "../src/index.js";

describe("runtime summary contracts", () => {
  it("creates a null summary with ready false and empty strings", () => {
    expect(createNullRuntimeSummary()).toEqual({
      ready: false,
      databaseName: "",
      namespace: "",
    });
  });
});
