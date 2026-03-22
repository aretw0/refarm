import { beforeEach, describe, expect, it } from "vitest";
import { Barn } from "../src/index";

describe("Barn (O Celeiro) - Integration Tests", () => {
  let barn: Barn;

  beforeEach(() => {
    barn = new Barn();
  });

  it("should allow installing a new plugin with valid metadata", async () => {
    const url = "http://localhost:8080/my-plugin.wasm";
    const integrity = "sha256-abc123xyz";

    const plugin = await barn.installPlugin(url, integrity);

    expect(plugin).toBeDefined();
    expect(plugin.status).toBe("pending");
    expect(plugin.id).toBe("urn:refarm:plugin:stub");
  });
});
