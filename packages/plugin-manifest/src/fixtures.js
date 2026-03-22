import { REQUIRED_TELEMETRY_HOOKS } from "./types.js";

/**
 * Creates a valid PluginManifest for testing purposes.
 * Overrides can be passed to test specific scenarios.
 */
/**
 * @param {Partial<import('./types.js').PluginManifest>} [overrides={}]
 * @returns {import('./types.js').PluginManifest}
 */
export function createMockManifest(overrides = {}) {
  return {
    id: "@refarm.dev/test-plugin",
    name: "Test Plugin",
    version: "0.1.0",
    entry: "https://example.test/plugin.wasm",
    capabilities: {
      provides: ["storage:v1"],
      requires: [],
      providesApi: [],
      requiresApi: [],
    },
    permissions: [],
    observability: {
      hooks: [...REQUIRED_TELEMETRY_HOOKS],
    },
    targets: ["browser", "server"],
    ui: {
      icon: "lucide:plugin",
      slots: ["main"],
      color: "#238636",
    },
    certification: {
      license: "MIT",
      a11yLevel: 0,
      languages: ["en"],
    },
    trust: {
      profile: "strict",
    },
    ...overrides,
  };
}
