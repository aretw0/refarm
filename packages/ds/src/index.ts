export { runDsThemeConformance } from "./theme-conformance.js";
export * from "./contract.js";

/** @deprecated Use REQUIRED_TOKENS for the ds-tokens:v1 semantic contract. */
export const THEME_TOKENS = [
	"--ds-bg-primary",
	"--ds-bg-secondary",
	"--ds-bg-elevated",
	"--ds-border-default",
	"--ds-text-primary",
	"--ds-accent-primary",
	"--ds-font-mono",
	"--ds-font-sans",
] as const;

/** @deprecated Use DsToken for the ds-tokens:v1 semantic contract. */
export type DsThemeTokenAlias = (typeof THEME_TOKENS)[number];

/** @deprecated Use DsThemeTokenAlias. */
export type RefarmThemeToken = DsThemeTokenAlias;

// CSS entry points are imported directly by consumers:
// @refarm.dev/ds/tokens.css
// @refarm.dev/ds/components.css
// @refarm.dev/ds/tailwind-bridge.css
// @refarm.dev/ds/themes/<name>.css
