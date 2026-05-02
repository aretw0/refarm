import { resolveRefarmVersion } from "./version.js";

export type RefarmLaunchExperience = "web" | "tui";

const BANNER_LINES = [
	"╭───────────────────────────────╮",
	"│            REFARM             │",
	"│        sovereign farm         │",
	"╰───────────────────────────────╯",
] as const;

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
	options?: { version?: string },
): string {
	const version = options?.version ?? resolveRefarmVersion();
	return [
		...BANNER_LINES,
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
	log(buildRefarmLaunchBanner(experience, { version: options?.version }));
	return true;
}
