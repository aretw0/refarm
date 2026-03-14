import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'jsdom',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      exclude: [
        'node_modules/',
        'dist/',
        '**/*.test.ts',
        '**/*.spec.ts',
      ],
    },
    include: ['**/*.test.ts', '**/*.spec.ts'],
    exclude: ['node_modules/', 'dist/', '.idea', '.git', '.cache', 'validations/', 'apps/'],
    testTimeout: 10000,
    hookTimeout: 10000,
  },
  resolve: {
    alias: {
      '@refarm.dev/tractor/test/test-utils': '/workspaces/refarm/packages/tractor/test/test-utils.ts',
      '@refarm.dev/tractor': '/workspaces/refarm/packages/tractor/src/index.ts',
      '@refarm.dev/plugin-manifest': '/workspaces/refarm/packages/plugin-manifest/src/index.ts',
      '@refarm.dev/storage-contract-v1': '/workspaces/refarm/packages/storage-contract-v1/src/index.ts',
      '@refarm.dev/sync-contract-v1': '/workspaces/refarm/packages/sync-contract-v1/src/index.ts',
      '@refarm.dev/identity-contract-v1': '/workspaces/refarm/packages/identity-contract-v1/src/index.ts',
      '@refarm.dev/toolbox': '/workspaces/refarm/packages/toolbox/src/index.ts',
      '@refarm.dev/storage-sqlite': '/workspaces/refarm/packages/storage-sqlite/src/index.ts',
      '@refarm.dev/locales': '/workspaces/refarm/locales',
    }
  }
})
