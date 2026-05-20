import fs from "node:fs";
import path from "node:path";

export const DEFAULT_SUPPORTED_LOCALES = ["pt-BR", "en", "es"];

export function flattenKeys(obj, prefix = "") {
	let keys = [];

	for (const [key, value] of Object.entries(obj)) {
		const fullKey = prefix ? `${prefix}.${key}` : key;

		if (typeof value === "object" && value !== null && !Array.isArray(value)) {
			keys = keys.concat(flattenKeys(value, fullKey));
		} else {
			keys.push(fullKey);
		}
	}

	return keys;
}

export function loadLocales(localesDir, supportedLocales = DEFAULT_SUPPORTED_LOCALES) {
	const locales = {};
	const localeKeys = {};

	for (const locale of supportedLocales) {
		const filePath = path.join(localesDir, `${locale}.json`);

		if (!fs.existsSync(filePath)) {
			throw new Error(`Missing locale file: ${locale}.json`);
		}

		const content = fs.readFileSync(filePath, "utf-8");
		locales[locale] = JSON.parse(content);
		localeKeys[locale] = new Set(flattenKeys(locales[locale]));
	}

	return { locales, localeKeys };
}

export function compareLocaleKeys(localeKeys, supportedLocales = DEFAULT_SUPPORTED_LOCALES) {
	const baseLocale = supportedLocales[0];
	const baseKeys = localeKeys[baseLocale];
	const differences = [];

	for (const locale of supportedLocales.slice(1)) {
		const currentKeys = localeKeys[locale];
		const missingKeys = [...baseKeys].filter((key) => !currentKeys.has(key));
		const extraKeys = [...currentKeys].filter((key) => !baseKeys.has(key));

		if (missingKeys.length > 0 || extraKeys.length > 0) {
			differences.push({ locale, missingKeys, extraKeys });
		}
	}

	return differences;
}

export function checkLocales(localesDir, supportedLocales = DEFAULT_SUPPORTED_LOCALES) {
	const { localeKeys } = loadLocales(localesDir, supportedLocales);
	return {
		baseLocale: supportedLocales[0],
		baseKeyCount: localeKeys[supportedLocales[0]].size,
		differences: compareLocaleKeys(localeKeys, supportedLocales),
		supportedLocales,
	};
}
