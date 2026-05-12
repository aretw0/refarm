// @ts-check
import globals from 'globals';
import tseslint from 'typescript-eslint';
import { base } from './base.js';

/**
 * Preset for Node.js packages (CLI tools, server-side adapters, build scripts).
 *
 * @type {import('typescript-eslint').ConfigArray}
 */
export const node = tseslint.config(
  ...base,
  {
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
    rules: {
      // Node-specific: allow require() in .cjs / .js files.
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
);

/**
 * @param {...import('typescript-eslint').ConfigWithExtends} overrides
 * @returns {import('typescript-eslint').ConfigArray}
 */
export function withNode(...overrides) {
  return tseslint.config(...node, ...overrides);
}
