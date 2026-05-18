// @ts-check
import { withNode } from '@refarm.dev/eslint-config/node';

export default withNode(
  {
    ignores: ['dist/**', '**/*.d.ts'],
  },
  {
    files: ['src/**/*.ts', 'src/**/*.tsx'],
  },
);
