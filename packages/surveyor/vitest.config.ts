import { defineConfig } from "vitest/config";

// Default to the fast node environment; the interactive DOM test opts into jsdom per-file via a
// `// @vitest-environment jsdom` annotation, so the pure layout/adapter/svg tests pay nothing.
export default defineConfig({ test: { environment: "node" } });
