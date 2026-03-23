/**
 * Refarm Design System
 * 
 * This package provides the styling primitives for the Refarm ecosystem.
 * Plugins should use these tokens to remain visually consistent.
 */

export const THEME_TOKENS = [
  '--refarm-bg-primary',
  '--refarm-bg-secondary',
  '--refarm-bg-elevated',
  '--refarm-border-default',
  '--refarm-text-primary',
  '--refarm-accent-primary',
  '--refarm-font-mono',
  '--refarm-font-sans',
] as const;

export type RefarmThemeToken = typeof THEME_TOKENS[number];
