import { describe, expect, it } from "vitest";

import { validatePluginManifest } from "./validate.js";

describe("plugin-manifest validation", () => {
  it("accepts valid manifest with required observability hooks", () => {
    const result = validatePluginManifest({
      id: "@acme/storage-opfs",
      name: "ACME Storage",
      version: "1.2.3",
      entry: "./dist/index.js",
      capabilities: {
        provides: ["storage:v1"],
        requires: ["browser:opfs"],
      },
      permissions: ["storage:read", "storage:write"],
      observability: {
        hooks: ["onLoad", "onInit", "onRequest", "onError", "onTeardown"],
      },
    });

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("rejects manifest missing required observability hooks", () => {
    const result = validatePluginManifest({
      id: "@acme/storage-opfs",
      name: "ACME Storage",
      version: "1.2.3",
      entry: "./dist/index.js",
      capabilities: {
        provides: ["storage:v1"],
        requires: [],
      },
      permissions: ["storage:read"],
      observability: {
        hooks: ["onLoad", "onInit"],
      },
    });

    expect(result.valid).toBe(false);
    expect(result.errors.some((error) => error.includes("onRequest"))).toBe(true);
  });
});
