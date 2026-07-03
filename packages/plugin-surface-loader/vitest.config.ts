import { defineConfig } from "vitest/config";

// Resolve workspace deps (ds, plugin-manifest) via their package exports, not
// the vtconfig baseConfig — its getAliases(process.cwd()) breaks under
// `pnpm --filter` (cwd is the package, not the monorepo root). Matches how
// other cross-package suites (e.g. local-surface) configure vitest.
export default defineConfig({ test: { environment: "node" } });
