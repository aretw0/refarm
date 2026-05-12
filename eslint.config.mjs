// @ts-check
import { withBase } from '@refarm.dev/eslint-config/base';

export default withBase(
  // Global ignores — must be a standalone object with only `ignores`.
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/*.d.ts',
      '**/test/fixtures/**',
      '**/.jco-dist/**',
      '**/transpiled/**',
    ],
  },
  // Scope linting to monorepo source files.
  {
    files: ['packages/*/src/**/*.ts', 'apps/*/src/**/*.ts'],
  },
);
