import { defineConfig, mergeConfig } from 'vitest/config';
import baseConfig from '../../vitest.config';

export default mergeConfig(
  baseConfig,
  defineConfig({
    test: {
      name: '@refarm.dev/toolbox',
      include: ['src/**/*.test.ts', 'src/**/*.test.mjs'],
      environment: 'node',
    },
  })
);
