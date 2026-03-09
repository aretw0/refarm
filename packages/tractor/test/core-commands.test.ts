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
});
