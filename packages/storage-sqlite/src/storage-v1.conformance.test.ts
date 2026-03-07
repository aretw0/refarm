import { describe, expect, it } from "vitest";

import { runStorageV1Conformance } from "@refarm.dev/storage-contract-v1";

import { createStorageV1Provider } from "./index.js";

describe("@refarm.dev/storage-sqlite storage:v1 conformance", () => {
  it("passes storage:v1 contract", async () => {
    const provider = createStorageV1Provider();
    const result = await runStorageV1Conformance(provider);

    expect(result.pass).toBe(true);
    expect(result.failed).toBe(0);
  });
});
