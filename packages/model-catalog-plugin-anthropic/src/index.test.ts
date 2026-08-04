import { describe, expect, it } from "vitest";
import {
  ANTHROPIC_MODEL_RATE_PLUGIN_ID,
  createAnthropicModelRatePlugin,
  MODEL_RATE_CATALOG_PLUGIN_CAPABILITY,
} from "./index.js";

describe("model-catalog-plugin-anthropic", () => {
  it("exposes provider identity and capability", () => {
    const plugin = createAnthropicModelRatePlugin();
    expect(plugin.id).toBe(ANTHROPIC_MODEL_RATE_PLUGIN_ID);
    expect(plugin.capability).toBe(MODEL_RATE_CATALOG_PLUGIN_CAPABILITY);
  });

  it("returns cloned entry arrays", () => {
    const plugin = createAnthropicModelRatePlugin();
    const first = plugin.entries();
    const second = plugin.entries();
    expect(first).toHaveLength(2);
    expect(second).toHaveLength(2);
    expect(first).not.toBe(second);
  });
});
