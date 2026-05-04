/**
 * farmhand-node-loader.mjs
 *
 * Resolver fallbacks for local source execution of apps/farmhand without
 * prebuilding every dependent package:
 *   1) "./x.js" -> "./x.ts" (source modules authored with .js specifiers)
 *   2) "./x"    -> "./x.js"/"./x.ts" (extensionless ESM imports in dist)
 */

function isRelativeOrAbsolute(specifier) {
	return (
		specifier.startsWith("./") ||
		specifier.startsWith("../") ||
		specifier.startsWith("/")
	);
}

function hasKnownModuleExtension(specifier) {
	return /\.(c|m)?js$|\.(c|m)?ts$|\.json$|\.node$/i.test(specifier);
}

export async function resolve(specifier, context, defaultResolve) {
	try {
		return await defaultResolve(specifier, context, defaultResolve);
	} catch (error) {
		if (!isRelativeOrAbsolute(specifier)) throw error;

		const candidates = [];

		if (specifier.endsWith(".js")) {
			candidates.push(`${specifier.slice(0, -3)}.ts`);
		}

		if (!hasKnownModuleExtension(specifier)) {
			candidates.push(`${specifier}.js`);
			candidates.push(`${specifier}.ts`);
		}

		for (const candidate of candidates) {
			try {
				return await defaultResolve(candidate, context, defaultResolve);
			} catch {
				// try next fallback candidate
			}
		}

		throw error;
	}
}
