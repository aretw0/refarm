// @ts-check
import { withNode } from '@refarm.dev/eslint-config/node';

export default withNode(
  {
    ignores: [
      'dist/**',
      'src/.jco-dist/**',
      'src/transpiled/**',
    ],
  },
  {
    files: ['src/**/*.ts'],
  },
);
