export const dsAstroCssImports = [
	"@refarm.dev/ds/tokens.css",
	"@refarm.dev/ds/themes/tractor-green.css",
	"@refarm.dev/ds/components.css",
] as const;

export const dsAstroComponents = ["Card", "MetricStrip", "CalloutSection", "ContentList"] as const;

export type DsAstroComponentName = (typeof dsAstroComponents)[number];

export const mdxComponents = {
	Card: "@refarm.dev/ds-astro/Card.astro",
	MetricStrip: "@refarm.dev/ds-astro/MetricStrip.astro",
	CalloutSection: "@refarm.dev/ds-astro/CalloutSection.astro",
	ContentList: "@refarm.dev/ds-astro/ContentList.astro",
} as const satisfies Record<DsAstroComponentName, string>;
