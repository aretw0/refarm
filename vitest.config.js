import { defineConfig } from 'vitest/config'
import path from 'node:path'
import { baseConfig, getAliases } from '@refarm.dev/vtconfig'

// Root-level config adds pool options on top of the shared base.
export default defineConfig({
  ...baseConfig,
  resolve: {
    ...baseConfig.resolve,
    alias: {
      ...baseConfig.resolve?.alias,
      ...getAliases(path.resolve(__dirname))
    }
  },
  test: {
    ...(baseConfig.test || {}),
    // Vitest 4 Pool Options (Reworked)
    pool: 'forks',
    forks: {
      singleFork: true,
    },
  },
});
