import type { QualityProfile } from "./types.js";

/**
 * The IMPECCABLE design-tells profile — the deterministic AI-slop tells, as DATA. Assembled from
 * the impeccable ban list (the subset a matcher can decide from a stylesheet, no DOM). Each
 * threshold is a rule value, so a consumer edits the DATA (loosen the z-index threshold, raise the
 * eyebrow size) — not the checker code. `warn` throughout: a tell is advice, not a hard fail.
 */
export const IMPECCABLE_TELLS_PROFILE: QualityProfile = {
	name: "impeccable-design-tells",
	rules: [
		{
			id: "side-stripe-border",
			severity: "warn",
			category: "ai-slop",
			description: "Thick colored side border (the AI card 'stripe') — use a top accent or none",
			check: { type: "side-stripe-border", minPx: 2 },
		},
		{
			id: "gradient-text",
			severity: "warn",
			category: "ai-slop",
			description: "Gradient text (background-clip:text + gradient) — use a solid color",
			check: { type: "gradient-text" },
		},
		{
			id: "glassmorphism",
			severity: "warn",
			category: "ai-slop",
			description: "Decorative backdrop-filter: blur() (glassmorphism) — only when it earns its place",
			check: { type: "glassmorphism" },
		},
		{
			id: "bounce-easing",
			severity: "warn",
			category: "motion",
			description: "Bounce/elastic easing — use an ease-out (exponential) curve, no overshoot",
			check: { type: "bounce-easing" },
		},
		{
			id: "arbitrary-zindex",
			severity: "warn",
			category: "layout",
			description: "Magic z-index (999/9999) — use a small semantic scale",
			check: { type: "arbitrary-zindex", threshold: 999 },
		},
		{
			id: "uppercase-eyebrow",
			severity: "warn",
			category: "ai-slop",
			description: "Tiny uppercase tracked eyebrow (the 'ABOUT' kicker) above every section",
			check: { type: "uppercase-eyebrow", maxPx: 13 },
		},
		{
			id: "missing-reduced-motion",
			severity: "warn",
			category: "motion",
			description: "Animates but no prefers-reduced-motion guard — add a reduced-motion alternative",
			check: { type: "missing-reduced-motion" },
		},
	],
};
