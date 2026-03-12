import { describe, expect, it } from "vitest";
import { Tractor, normaliseToSovereignGraph } from "../src/index";
import { createMockConfig } from "./helpers/mock-adapters";

describe("Hierarchical Boot & Isolation", () => {
  it("enforces isolation between parent and child vaults", async () => {
    // 1. Boot Parent in 'prod'
    const parentConfig = createMockConfig(undefined, { namespace: "prod" });
    const parent = await Tractor.boot(parentConfig);

    // 2. Spawn Child in 'ephemeral-task'
    const child = await parent.spawnChild("ephemeral-task");

    // 3. Store node in Parent
    const parentNode = normaliseToSovereignGraph(
      { name: "Secret Config" },
      "system",
      "Config"
    );
    await parent.storeNode(parentNode);

    // 4. Verify Child cannot see it
    const childResults = await child.queryNodes("Config");
    expect(childResults).toHaveLength(0);

    // 5. Store node in Child
    const childNode = normaliseToSovereignGraph(
      { name: "Ephemeral Task Data" },
      "plugin-x",
      "Task"
    );
    await child.storeNode(childNode);

    // 6. Verify Parent cannot see Child's data
    const parentResults = await parent.queryNodes("Task");
    expect(parentResults).toHaveLength(0);

    // 7. Verify Child sees its own data
    const childOwnResults = await child.queryNodes("Task");
    expect(childOwnResults).toHaveLength(1);

    await child.shutdown();
    await parent.shutdown();
  });
});
