// Minimal JCO-transpiled fixture used by main-thread-runner.test.ts
// Simulates the JS entry point that JCO generates from a WASM component.
export async function instantiate(imports, getCoreModule) {
  return {
    integration: {
      setup: async () => "fixture-ok",
    },
  };
}
