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

function modulePrelude(ifaceKey) {
	return [
		`const iface = globalThis.__REFARM_PLUGIN_IMPORTS__?.[${JSON.stringify(ifaceKey)}] ?? {};`,
		"const missing = (name) => {",
		`  throw new Error('[farmhand-loader] Missing host import ${ifaceKey}::' + name);`,
		"};",
		"const call = (name, args) => {",
		"  const fn = iface[name];",
		"  if (typeof fn !== 'function') return missing(name);",
		"  return fn(...args);",
		"};",
	].join("\n");
}

function refarmPluginModuleSource(specifier) {
	const base = modulePrelude(specifier);
	const lines = [];

	switch (specifier) {
		case "refarm:plugin/agent-fs":
			lines.push(
				"export const read = (...args) => call('read', args);",
				"export const write = (...args) => call('write', args);",
			);
			break;
		case "refarm:plugin/agent-shell":
			lines.push("export const spawn = (...args) => call('spawn', args);");
			break;
		case "refarm:plugin/code-ops":
			lines.push(
				"export const findReferences = (...args) => call('find-references', args);",
				"export const renameSymbol = (...args) => call('rename-symbol', args);",
			);
			break;
		case "refarm:plugin/llm-bridge":
			lines.push(
				"export const completeHttp = (...args) => call('complete-http', args);",
				"export const completeHttpStream = (...args) => call('complete-http-stream', args);",
			);
			break;
		case "refarm:plugin/structured-io":
			lines.push(
				"export const readStructured = (...args) => call('read-structured', args);",
				"export const writeStructured = (...args) => call('write-structured', args);",
			);
			break;
		case "refarm:plugin/tractor-bridge":
			lines.push(
				"export const storeNode = (...args) => call('store-node', args);",
				"export const getNode = (...args) => call('get-node', args);",
				"export const queryNodes = (...args) => call('query-nodes', args);",
				"export const emitTelemetry = (...args) => call('emit-telemetry', args);",
			);
			break;
		default:
			return null;
	}

	return `${base}\n${lines.join("\n")}\n`;
}

export async function resolve(specifier, context, defaultResolve) {
	const virtualSource = refarmPluginModuleSource(specifier);
	if (virtualSource) {
		const encoded = encodeURIComponent(virtualSource);
		return {
			url: `data:text/javascript;charset=utf-8,${encoded}`,
			shortCircuit: true,
		};
	}

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
