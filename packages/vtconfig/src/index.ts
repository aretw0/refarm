import path from 'node:path'
import type { UserConfig } from 'vitest/config'

/**
 * Helper to generate aliases for Vitest based on current environment (src vs dist).
 */
export function getAliases(root: string) {
  const useDistGlobal = process.env.VITEST_USE_DIST === 'true';
  const forcedDistPackages = (process.env.VITEST_FORCE_DIST || '').split(',').map(s => s.trim());
  const packagesDir = path.resolve(root, 'packages');
  const localesDir = path.resolve(root, 'locales');
  
  const getSuffix = (pkgName: string) => {
    const isForcedDist = forcedDistPackages.includes(pkgName);
    return (useDistGlobal || isForcedDist) ? 'dist/index.js' : 'src/index.ts';
  };

  return {
    '@refarm.dev/tractor/test/test-utils': path.resolve(packagesDir, 'tractor-ts', 'test', 'test-utils.ts'),
    '@refarm.dev/tractor': path.resolve(packagesDir, 'tractor-ts', getSuffix('@refarm.dev/tractor')),
    '@refarm.dev/plugin-manifest': path.resolve(packagesDir, 'plugin-manifest', getSuffix('@refarm.dev/plugin-manifest')),
    '@refarm.dev/barn': path.resolve(packagesDir, 'barn', getSuffix('@refarm.dev/barn')),
    '@refarm.dev/storage-contract-v1': path.resolve(packagesDir, 'storage-contract-v1', getSuffix('@refarm.dev/storage-contract-v1')),
    '@refarm.dev/sync-contract-v1': path.resolve(packagesDir, 'sync-contract-v1', getSuffix('@refarm.dev/sync-contract-v1')),
    '@refarm.dev/identity-contract-v1': path.resolve(packagesDir, 'identity-contract-v1', getSuffix('@refarm.dev/identity-contract-v1')),
    '@refarm.dev/toolbox': path.resolve(packagesDir, 'toolbox', getSuffix('@refarm.dev/toolbox')),
    '@refarm.dev/storage-sqlite': path.resolve(packagesDir, 'storage-sqlite', getSuffix('@refarm.dev/storage-sqlite')),
    '@refarm.dev/locales': localesDir,
  };
}

/**
 * Shared base configuration imported by per-package vitest.config.ts files.
 */
export const baseConfig: UserConfig = {
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
        '**/test/**',
        '**/src/transpiled/**'
      ],
    },
    include: ['**/*.test.ts', '**/*.spec.ts'],
    exclude: ['node_modules/', 'dist/', '.idea', '.git', '.cache', 'validations/'],
    testTimeout: 15000,
    hookTimeout: 15000,
  },
  resolve: {
    alias: getAliases(process.cwd()) // Fallback for direct use
  }
};

export default baseConfig;
