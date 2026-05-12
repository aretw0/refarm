// @ts-check
import tseslint from 'typescript-eslint';

/**
 * Core TypeScript rules applied to all Refarm packages.
 * Extend this in node/browser presets or directly in eslint.config.mjs.
 *
 * @type {import('typescript-eslint').ConfigArray}
 */
export const base = tseslint.config(
  ...tseslint.configs.recommended,
  {
    rules: {
      // The primary gate: eliminates `as any` and `: any` regressions.
      '@typescript-eslint/no-explicit-any': 'error',

      // Companion rules that close common escape hatches.
      '@typescript-eslint/no-unsafe-assignment': 'off',    // too noisy without strict project refs
      '@typescript-eslint/no-unsafe-call': 'off',          // same
      '@typescript-eslint/no-unsafe-member-access': 'off', // same
      '@typescript-eslint/no-unsafe-return': 'off',        // same

      // Allow `as unknown as T` double-cast pattern (our canonical replacement for as any).
      '@typescript-eslint/no-unsafe-argument': 'off',

      // Naming conventions: ban implicit `any` parameters.
      '@typescript-eslint/no-implicit-any-catch': 'off',   // not in v8; covered by useUnknownInCatchVariables tsconfig option

      '@typescript-eslint/no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
      }],
    },
  },
);

/**
 * Factory for projects that need to customise the base config.
 *
 * @param {...import('typescript-eslint').ConfigWithExtends} overrides
 * @returns {import('typescript-eslint').ConfigArray}
 */
export function withBase(...overrides) {
  return tseslint.config(...base, ...overrides);
}
