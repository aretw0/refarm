import { beforeEach, describe, expect, it } from "vitest";
import { Tractor } from "../src/index";
import { MockIdentityAdapter, MockStorageAdapter } from "./test-utils";

describe("Tractor Core Commands", () => {
  let tractor: Tractor;

  beforeEach(async () => {
    tractor = await Tractor.boot({
      storage: new MockStorageAdapter(),
      identity: new MockIdentityAdapter(),
    });
  });

  it("should have all core commands registered", () => {
    const commands = tractor.commands.getCommands();
    const ids = commands.map(c => c.id);

    expect(ids).toContain("system:identity:guest");
    expect(ids).toContain("system:identity:debug");
    expect(ids).toContain("system:security:verify-device");
    expect(ids).toContain("system:security:confirm-sas");
    expect(ids).toContain("system:security:trust-plugin");
    expect(ids).toContain("system:security:trust-plugin-once");
    expect(ids).toContain("system:security:revoke-plugin-trust");
  });

  it("should execute system:security:verify-device and return 7 emojis", async () => {
    const result = await tractor.commands.execute("system:security:verify-device");
    expect(result.sas).toHaveLength(7);
    expect(Array.isArray(result.sas)).toBe(true);
  });

  it("should execute system:security:confirm-sas and emit telemetry", async () => {
    const result = await tractor.commands.execute("system:security:confirm-sas", { confirmed: true });
    expect(result.success).toBe(true);
  });

  it("should require explicit acknowledgment for trust-plugin-once", async () => {
    await expect(
      tractor.commands.execute("system:security:trust-plugin-once", {
        manifest: {
          id: "@refarm.dev/godot-like",
          name: "Godot-like",
          version: "0.1.0",
          entry: "https://example.test/godot.wasm",
          capabilities: { provides: ["compute:v1"], requires: [] },
          permissions: [],
          observability: { hooks: ["onLoad", "onInit", "onRequest", "onError", "onTeardown"] },
          targets: ["browser"],
          certification: { license: "MIT", a11yLevel: 1, languages: ["en"] },
          trust: { profile: "trusted-fast", leaseHours: 1 },
        },
        wasmHash: "sha256:godot-v1",
        acknowledgeRisk: false,
      })
    ).rejects.toThrow("Risk acknowledgment is required");
  });

  it("should grant trust once when acknowledgment is true", async () => {
    const result = await tractor.commands.execute("system:security:trust-plugin-once", {
      manifest: {
        id: "@refarm.dev/godot-like",
        name: "Godot-like",
        version: "0.1.0",
        entry: "https://example.test/godot.wasm",
        capabilities: { provides: ["compute:v1"], requires: [] },
        permissions: [],
        observability: { hooks: ["onLoad", "onInit", "onRequest", "onError", "onTeardown"] },
        targets: ["browser"],
        certification: { license: "MIT", a11yLevel: 1, languages: ["en"] },
        trust: { profile: "trusted-fast", leaseHours: 1 },
      },
      wasmHash: "sha256:godot-v1",
      acknowledgeRisk: true,
    });

    expect(result.warning).toContain("Trusted-fast enabled");
    expect(result.grant.pluginId).toBe("@refarm.dev/godot-like");
    expect(result.grant.wasmHash).toBe("sha256:godot-v1");
  });
});
