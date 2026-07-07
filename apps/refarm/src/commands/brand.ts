import { resolveRefarmVersion } from "./runtime-metadata.js";

export type RefarmLaunchExperience = "web" | "tui";

/** The default brand shown in the launch banner. White-label overrides it via
 * `REFARM_BRAND_NAME` (uppercased for the banner) — a white-label deployment runs under a
 * neutral brand so a judge never sees the upstream name. Mirrors the
 * `<BINARY>_COMMAND` override precedent for handoff strings. */
const DEFAULT_BRAND_NAME = "REFARM";
const BANNER_TAGLINE = "workspace automation";
/** Inner width of the banner box — wide enough for the default brand + tagline. */
const BANNER_WIDTH = 31;

/** The resolved, uppercased brand name for the banner. */
export function resolveBrandName(env: NodeJS.ProcessEnv = process.env): string {
	const raw = env.REFARM_BRAND_NAME?.trim();
	return (raw && raw.length > 0 ? raw : DEFAULT_BRAND_NAME).toUpperCase();
}

/** Center `text` in a `BANNER_WIDTH`-wide field (truncating an over-long brand so
 * the box never breaks its border). */
function centerInBanner(text: string): string {
	const clipped = text.length > BANNER_WIDTH ? text.slice(0, BANNER_WIDTH) : text;
	const pad = BANNER_WIDTH - clipped.length;
	const left = Math.floor(pad / 2);
	return `${" ".repeat(left)}${clipped}${" ".repeat(pad - left)}`;
}

/** The banner lines, rebranded around the resolved name so the box stays aligned. */
function bannerLines(env: NodeJS.ProcessEnv = process.env): string[] {
	const border = "─".repeat(BANNER_WIDTH);
	return [
		`╭${border}╮`,
		`│${centerInBanner(resolveBrandName(env))}│`,
		`│${centerInBanner(BANNER_TAGLINE)}│`,
		`╰${border}╯`,
	];
}

const EXPERIENCE_LABEL: Record<RefarmLaunchExperience, string> = {
	web: "web runtime",
	tui: "tui runtime",
};

const DISABLED_VALUES = new Set(["0", "false", "off", "no"]);
const ENABLED_VALUES = new Set(["1", "true", "on", "yes"]);

export function isRefarmBrandBannerEnabled(
	env: NodeJS.ProcessEnv = process.env,
): boolean {
	const raw = env.REFARM_BRAND_BANNER?.trim().toLowerCase();
	if (!raw) {
		return true;
	}
	if (DISABLED_VALUES.has(raw)) {
		return false;
	}
	if (ENABLED_VALUES.has(raw)) {
		return true;
	}
	return true;
}

export function buildRefarmLaunchBanner(
	experience: RefarmLaunchExperience,
	options?: { version?: string; env?: NodeJS.ProcessEnv },
): string {
	const version = options?.version ?? resolveRefarmVersion();
	return [
		...bannerLines(options?.env),
		`version: ${version}`,
		`launch target: ${EXPERIENCE_LABEL[experience]}`,
	].join("\n");
}

export function printRefarmLaunchBanner(
	experience: RefarmLaunchExperience,
	options?: {
		env?: NodeJS.ProcessEnv;
		log?: (message: string) => void;
		version?: string;
	},
): boolean {
	const env = options?.env ?? process.env;
	if (!isRefarmBrandBannerEnabled(env)) {
		return false;
	}
	const log = options?.log ?? console.log;
	log(buildRefarmLaunchBanner(experience, { version: options?.version, env }));
	return true;
}
