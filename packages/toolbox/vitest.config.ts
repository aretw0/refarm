import { defineConfig, mergeConfig } from 'vitest/config';
import { baseConfig } from '@refarm.dev/vtconfig';

export default mergeConfig(
  baseConfig,
  defineConfig({
    test: {
      name: '@refarm.dev/toolbox',
      include: ['src/**/*.test.ts', 'src/**/*.test.mjs', 'test/**/*.test.js'],
      environment: 'node',
    },
  })
);
