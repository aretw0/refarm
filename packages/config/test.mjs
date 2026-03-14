import { loadConfig, loadConfigAsync, findRefarmRoot } from "./index.mjs";
import assert from "node:assert";

async function runTests() {
    console.log("🚀 Running @refarm.dev/config Deterministic Tests...");

    const root = findRefarmRoot();
    console.log(`📂 Root detected: ${root}`);

    // Test 1: Basic Loading & Interpolation
    console.log("  [Test 1] Basic Loading & Interpolation...");
    const config = loadConfig(root);
    assert.ok(config.brand, "Brand should exist");
    assert.strictEqual(config.brand.name, "Refarm", "Brand name mismatch");
    // Site URL should be interpolated: https://aretw0.github.io/refarm
    assert.ok(config.brand.urls.site.includes("github.io"), "Site URL not interpolated correctly");
    console.log("  ✅ Test 1 Passed");

    // Test 2: Environment Override
    console.log("  [Test 2] Environment Override Priority...");
    process.env.REFARM_GIT_HOST = "gitlab";
    const configOverride = loadConfig(root);
    assert.strictEqual(configOverride.infrastructure.gitHost, "gitlab", "Environment override failed");
    assert.ok(configOverride.brand.urls.site.includes("gitlab.io"), "Interpolation didn't pick up override");
    delete process.env.REFARM_GIT_HOST;
    console.log("  ✅ Test 2 Passed");

    // Test 3: Strategic Bootstrap (Ephemeral)
    console.log("  [Test 3] Strategic Bootstrap (Ephemeral)...");
    process.env.REFARM_EPHEMERAL_SOURCE = "https://mock.graph/v1";
    const asyncConfig = await loadConfigAsync(root);
    // RemoteSource.load currently just logs, but it defines the precedence
    assert.ok(asyncConfig.brand, "Async config should load");
    delete process.env.REFARM_EPHEMERAL_SOURCE;
    console.log("  ✅ Test 3 Passed");

    console.log("\n🎉 All @refarm.dev/config tests passed!");
}

runTests().catch(err => {
    console.error("❌ Tests failed!");
    console.error(err);
    process.exit(1);
});
