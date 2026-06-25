export { runDsThemeConformance } from "./theme-conformance.js";
export * from "./contract.js";

/** @deprecated Use REQUIRED_TOKENS for the ds-tokens:v1 semantic contract. */
export const THEME_TOKENS = [
	"--refarm-bg-primary",
	"--refarm-bg-secondary",
	"--refarm-bg-elevated",
	"--refarm-border-default",
	"--refarm-text-primary",
	"--refarm-accent-primary",
	"--refarm-font-mono",
	"--refarm-font-sans",
] as const;

/** @deprecated Use DsToken for the ds-tokens:v1 semantic contract. */
export type RefarmThemeToken = (typeof THEME_TOKENS)[number];

// CSS entry points are imported directly by consumers:
// @refarm.dev/ds/tokens.css
// @refarm.dev/ds/components.css
// @refarm.dev/ds/tailwind-bridge.css
// @refarm.dev/ds/themes/<name>.css
