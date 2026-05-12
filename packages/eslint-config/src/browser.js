// @ts-check
import globals from 'globals';
import tseslint from 'typescript-eslint';
import { base } from './base.js';

/**
 * Preset for browser/frontend packages (homestead, apps, UI libs).
 *
 * @type {import('typescript-eslint').ConfigArray}
 */
export const browser = tseslint.config(
  ...base,
  {
    languageOptions: {
      globals: {
        ...globals.browser,
      },
    },
  },
);

/**
 * @param {...import('typescript-eslint').ConfigWithExtends} overrides
 * @returns {import('typescript-eslint').ConfigArray}
 */
export function withBrowser(...overrides) {
  return tseslint.config(...browser, ...overrides);
}
