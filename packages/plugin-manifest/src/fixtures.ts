import type { PluginManifest, TelemetryHook } from "./types.js";

const DEFAULT_HOOKS: TelemetryHook[] = ["onLoad", "onInit", "onRequest", "onError", "onTeardown"];

/**
 * Creates a valid PluginManifest for testing purposes.
 * Overrides can be passed to test specific scenarios.
 */
export function createMockManifest(overrides: Partial<PluginManifest> = {}): PluginManifest {
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
      hooks: [...DEFAULT_HOOKS],
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
    ...overrides,
  };
}
