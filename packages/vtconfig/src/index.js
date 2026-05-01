import fs from 'node:fs';
import path from 'node:path';
import { mergeConfig } from 'vite';

export const wasmBrowserHeaders = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};

export const wasmBrowserBaseConfig = {
  assetsInclude: ['**/*.wasm'],
  server: {
    headers: wasmBrowserHeaders,
  },
  preview: {
    headers: wasmBrowserHeaders,
  },
};

function getCiVitestReporterOptions() {
  if (process.env.GITHUB_ACTIONS !== 'true') {
    return {};
  }

  const lifecycle = (process.env.npm_lifecycle_event || 'run')
    .replace(/[^a-zA-Z0-9_-]/g, '-');

  return {
    reporters: [
      ['github-actions', { jobSummary: { enabled: false } }],
      'default',
      'json',
    ],
    outputFile: {
      json: `.artifacts/vitest/report-${lifecycle}.json`,
    },
  };
}

export function withWasmBrowserConfig(overrides = {}) {
  return mergeConfig(wasmBrowserBaseConfig, overrides);
}

/**
 * Helper to generate aliases for Vitest based on current environment (src vs dist).
 * @param {string} root - The root directory of the monorepo.
 */
export function getAliases(root) {
  const useDistGlobal = process.env.VITEST_USE_DIST === 'true';
  const forcedDistPackages = (process.env.VITEST_FORCE_DIST || '').split(',').map(s => s.trim());
  const packagesDir = path.resolve(root, 'packages');
  const localesDir = path.resolve(root, 'locales');

  const getSuffix = (pkgName) => {
    const isForcedDist = forcedDistPackages.includes(pkgName);
    if (useDistGlobal || isForcedDist) return 'dist/index.js';

    // Check if package is JS-Atomic or TS-Strict
    const pkgRelativePath = pkgName.includes('@refarm.dev/')
      ? pkgName.replace('@refarm.dev/', '')
      : pkgName;

    // Handle tractor-ts specifically if needed, or rely on fs check
    const pkgDir = path.resolve(packagesDir, pkgRelativePath === 'tractor' ? 'tractor-ts' : pkgRelativePath);

    if (fs.existsSync(path.resolve(pkgDir, 'src', 'index.ts'))) {
      return 'src/index.ts';
    }
    return 'src/index.js';
  };

  return {
    '@refarm.dev/tractor/test/test-utils': path.resolve(packagesDir, 'tractor-ts', 'test', 'test-utils.ts'),
    '@refarm.dev/tractor': path.resolve(packagesDir, 'tractor-ts', getSuffix('@refarm.dev/tractor')),
    '@refarm.dev/plugin-manifest': path.resolve(packagesDir, 'plugin-manifest', getSuffix('@refarm.dev/plugin-manifest')),
    '@refarm.dev/barn': path.resolve(packagesDir, 'barn', getSuffix('@refarm.dev/barn')),
    '@refarm.dev/storage-contract-v1': path.resolve(packagesDir, 'storage-contract-v1', getSuffix('@refarm.dev/storage-contract-v1')),
    '@refarm.dev/sync-contract-v1': path.resolve(packagesDir, 'sync-contract-v1', getSuffix('@refarm.dev/sync-contract-v1')),
    '@refarm.dev/identity-contract-v1': path.resolve(packagesDir, 'identity-contract-v1', getSuffix('@refarm.dev/identity-contract-v1')),
    '@refarm.dev/config': path.resolve(packagesDir, 'config', getSuffix('@refarm.dev/config')),
    '@refarm.dev/vtconfig': path.resolve(packagesDir, 'vtconfig', getSuffix('@refarm.dev/vtconfig')),
    '@refarm.dev/toolbox': path.resolve(packagesDir, 'toolbox', getSuffix('@refarm.dev/toolbox')),
    '@refarm.dev/storage-sqlite': path.resolve(packagesDir, 'storage-sqlite', getSuffix('@refarm.dev/storage-sqlite')),
    '@refarm.dev/locales': localesDir,
  };
}

/**
 * Shared base configuration imported by per-package vitest.config.ts files.
 * @type {baseConfig}
 */
export const baseConfig = {
  test: {
    globals: true,
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      exclude: [
        'node_modules/',
        'dist/',
        '**/*.test.ts',
        '**/*.spec.ts',
        '**/*.test.js',
        '**/*.spec.js',
        '**/test/**',
        '**/src/transpiled/**'
      ],
    },
    include: ['**/*.test.ts', '**/*.spec.ts', '**/*.test.js', '**/*.spec.js'],
    exclude: ['node_modules/', '**/dist/**', '.idea', '.git', '.cache', 'validations/'],
    testTimeout: 15000,
    hookTimeout: 15000,
    ...getCiVitestReporterOptions(),
  },
  resolve: {
    alias: getAliases(process.cwd()) // Fallback for direct use
  }
};

export default baseConfig;
