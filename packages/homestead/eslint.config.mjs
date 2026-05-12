// @ts-check
import { withBrowser } from '@refarm.dev/eslint-config/browser';

export default withBrowser(
  {
    ignores: ['dist/**', '**/*.d.ts'],
  },
  {
    files: ['src/**/*.ts', 'src/**/*.tsx'],
  },
);
