import { defineConfig } from 'vitest/config'
import path from 'node:path'

const useDistGlobal = process.env.VITEST_USE_DIST === 'true';
const forcedDistPackages = (process.env.VITEST_FORCE_DIST || '').split(',').map(s => s.trim());

export const getAliases = (root: string) => {
  const packagesDir = path.resolve(root, 'packages');
  const localesDir = path.resolve(root, 'locales');
  
  const getSuffix = (pkgName: string) => {
    const isForcedDist = forcedDistPackages.includes(pkgName);
    return (useDistGlobal || isForcedDist) ? 'dist/index.js' : 'src/index.ts';
  };

  const aliases: Record<string, string> = {
    '@refarm.dev/tractor/test/test-utils': path.resolve(packagesDir, 'tractor-ts/test/test-utils.ts'),
    '@refarm.dev/tractor': path.resolve(packagesDir, 'tractor-ts', getSuffix('@refarm.dev/tractor')),
    '@refarm.dev/plugin-manifest': path.resolve(packagesDir, 'plugin-manifest', getSuffix('@refarm.dev/plugin-manifest')),
    '@refarm.dev/storage-contract-v1': path.resolve(packagesDir, 'storage-contract-v1', getSuffix('@refarm.dev/storage-contract-v1')),
    '@refarm.dev/sync-contract-v1': path.resolve(packagesDir, 'sync-contract-v1', getSuffix('@refarm.dev/sync-contract-v1')),
    '@refarm.dev/identity-contract-v1': path.resolve(packagesDir, 'identity-contract-v1', getSuffix('@refarm.dev/identity-contract-v1')),
    '@refarm.dev/toolbox': path.resolve(packagesDir, 'toolbox', getSuffix('@refarm.dev/toolbox')),
    '@refarm.dev/storage-sqlite': path.resolve(packagesDir, 'storage-sqlite', getSuffix('@refarm.dev/storage-sqlite')),
    '@refarm.dev/locales': localesDir,
  };

  return aliases;
};

export const baseConfig = {
  test: {
    globals: true,
    environment: 'jsdom',
    coverage: {
      provider: 'v8' as const,
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
    exclude: ['node_modules/', 'dist/', '.idea', '.git', '.cache', 'validations/', 'apps/'],
    testTimeout: 10000,
    hookTimeout: 10000,
  },
  resolve: {
    alias: getAliases(process.cwd())
  }
};

export default defineConfig(baseConfig);
