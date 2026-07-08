import { describe, expect, it } from "vitest";
import { createRuntimeSummaryFromTractor } from "../src/tractor-adapter.js";

describe("createRuntimeSummaryFromTractor", () => {
  it("returns ready:true with namespace from tractor", () => {
    const fakeTractor = { namespace: "main" };
    const result = createRuntimeSummaryFromTractor(fakeTractor);
    expect(result.ready).toBe(true);
    expect(result.namespace).toBe("main");
    expect(result.databaseName).toBe("main");
  });

  it("uses namespace as databaseName", () => {
    const fakeTractor = { namespace: "studio-dev" };
    const result = createRuntimeSummaryFromTractor(fakeTractor);
    expect(result.databaseName).toBe("studio-dev");
  });
});
