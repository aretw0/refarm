export type MessageCatalog = Readonly<Record<string, string>>;
export type LocaleCatalogs = Readonly<Record<string, MessageCatalog>>;

export const REFARM_FALLBACK_LOCALE = "en";
export const REFARM_SUPPORTED_LOCALES = ["en", "pt-BR", "es"] as const;
export type RefarmLocale = (typeof REFARM_SUPPORTED_LOCALES)[number];

function normalized(locale: string): string {
	return locale.trim().replaceAll("_", "-").toLowerCase();
}

/** Exact locale first, then its language. Unknown/blank input falls back explicitly. */
export function resolveLocale(
	candidates: readonly (string | null | undefined)[],
	supported: readonly string[] = REFARM_SUPPORTED_LOCALES,
	fallback = REFARM_FALLBACK_LOCALE,
): string {
	const available = new Map(supported.map((locale) => [normalized(locale), locale]));
	for (const candidate of candidates) {
		if (!candidate?.trim()) continue;
		const exact = available.get(normalized(candidate));
		if (exact) return exact;
		const language = normalized(candidate).split("-")[0];
		const match = supported.find((locale) => normalized(locale).split("-")[0] === language);
		if (match) return match;
	}
	return available.get(normalized(fallback)) ?? supported[0] ?? fallback;
}

/** Replace every named placeholder. Missing params remain visible for diagnosis. */
export function formatMessage(
	template: string,
	params: Readonly<Record<string, string | number>> = {},
): string {
	let rendered = template;
	for (const [name, value] of Object.entries(params)) {
		rendered = rendered.split(`{${name}}`).join(String(value));
	}
	return rendered;
}

export interface MessageTranslator {
	readonly locale: string;
	t(key: string, params?: Readonly<Record<string, string | number>>): string;
}

export function createMessageTranslator(options: {
	locale: string;
	catalogs: LocaleCatalogs;
	fallbackLocale?: string;
}): MessageTranslator {
	const fallbackLocale = options.fallbackLocale ?? REFARM_FALLBACK_LOCALE;
	const locale = resolveLocale([options.locale], Object.keys(options.catalogs), fallbackLocale);
	const selected = options.catalogs[locale] ?? {};
	const fallback = options.catalogs[fallbackLocale] ?? {};
	return {
		locale,
		t: (key, params) => formatMessage(selected[key] ?? fallback[key] ?? key, params),
	};
}

/** Every locale must carry the fallback's keys; extras are allowed for local terminology. */
export function catalogParity(
	catalogs: LocaleCatalogs,
	fallbackLocale = REFARM_FALLBACK_LOCALE,
): Readonly<Record<string, readonly string[]>> {
	const required = Object.keys(catalogs[fallbackLocale] ?? {}).sort();
	const missing: Record<string, string[]> = {};
	for (const [locale, catalog] of Object.entries(catalogs)) {
		const absent = required.filter((key) => !(key in catalog));
		if (absent.length > 0) missing[locale] = absent;
	}
	return missing;
}
