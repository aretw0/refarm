import { defineConfig, mergeConfig } from 'vitest/config';
import { baseConfig, getAliases } from '@refarm.dev/vtconfig';
import path from 'node:path';

export default mergeConfig(
  baseConfig,
  defineConfig({
    resolve: {
      alias: getAliases(path.resolve(__dirname, "../../")),
    },
    test: {
      name: '@refarm.dev/toolbox',
      include: ['src/**/*.test.ts', 'src/**/*.test.mjs', 'test/**/*.test.js'],
      environment: 'node',
    },
  })
);
