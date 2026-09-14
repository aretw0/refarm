import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { ModelRateCatalog } from "../../model-catalog-v1/src/index.js";
import {
  createOpenaiModelRatePlugin,
  MODEL_RATE_CATALOG_PLUGIN_CAPABILITY,
  OPENAI_MODEL_RATE_PLUGIN_ID,
} from "./index.js";

describe("model-catalog-plugin-openai", () => {
  it("exposes provider identity and capability", () => {
    const plugin = createOpenaiModelRatePlugin();
    expect(plugin.id).toBe(OPENAI_MODEL_RATE_PLUGIN_ID);
    expect(plugin.capability).toBe(MODEL_RATE_CATALOG_PLUGIN_CAPABILITY);
  });

  it("returns cloned entry arrays", () => {
    const plugin = createOpenaiModelRatePlugin();
    const first = plugin.entries();
    const second = plugin.entries();
    expect(first.length).toBeGreaterThan(0);
    expect(first).not.toBe(second);
  });

  it("serves exactly the shipped catalog's openai rows, in their audited order", () => {
    // This used to assert a length of 2, which was the count of the entries this plugin
    // hand-wrote. Those entries were a second, wrong catalog by 2026-08-04, so the plugin now
    // serves the audited file instead. The assertion follows the change in kind: a fixed number
    // would break every time a rate is added, which is the churn the catalog exists to absorb.
    // Order is asserted because resolution is first-match-wins, so serving the same rows in a
    // different order is not the same catalog.
    const shipped = JSON.parse(
      readFileSync(
        new URL("../../model-catalog-v1/catalog/model-rates.v1.json", import.meta.url),
        "utf8",
      ),
    ) as ModelRateCatalog;
    const expected = shipped.entries.filter((entry) => entry.provider === "openai");
    expect(createOpenaiModelRatePlugin().entries()).toEqual(expected);
  });
});
