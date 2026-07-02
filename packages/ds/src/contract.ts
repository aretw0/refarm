export const DS_TOKEN_CAPABILITY = "ds-tokens:v1" as const;

/** Required semantic variables every conforming theme MUST define, without the leading `--`. */
export const REQUIRED_TOKENS = [
	"background",
	"foreground",
	"card",
	"card-foreground",
	"popover",
	"popover-foreground",
	"muted",
	"muted-foreground",
	"primary",
	"primary-foreground",
	"secondary",
	"secondary-foreground",
	"accent",
	"accent-foreground",
	"border",
	"input",
	"ring",
	"error",
	"warning",
	"success",
	"info",
	"radius-sm",
	"radius-md",
	"radius-lg",
	"shadow-sm",
	"shadow-md",
	"shadow-lg",
	"font-sans",
	"font-mono",
] as const;

export type DsToken = (typeof REQUIRED_TOKENS)[number];
export type DsTheme = Record<DsToken, string>;

export interface DsThemeConformanceResult {
	pass: boolean;
	total: number;
	failed: number;
	missing: DsToken[];
}
