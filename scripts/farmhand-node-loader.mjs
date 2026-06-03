/**
 * farmhand-node-loader.mjs
 *
 * Resolver fallbacks for local source execution of apps/farmhand without
 * prebuilding every dependent package:
 *   0) "@refarm.dev/x[/subpath]" -> local workspace dist export
 *   1) bare package imports -> local pnpm virtual store when workspace links
 *      are not readable by the host OS
 *   2) "./x.js" -> "./x.ts" (source modules authored with .js specifiers)
 *   3) "./x"    -> "./x.js"/"./x.ts" (extensionless ESM imports in dist)
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WORKSPACE_DIRS = ["packages", "apps"];

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

function barePackageParts(specifier) {
	if (
		isRelativeOrAbsolute(specifier) ||
		specifier.startsWith("node:") ||
		specifier.includes(":")
	) {
		return null;
	}
	const parts = specifier.split("/");
	if (specifier.startsWith("@")) {
		if (parts.length < 2) return null;
		return {
			packageName: `${parts[0]}/${parts[1]}`,
			subpath: parts.slice(2).join("/"),
		};
	}
	return { packageName: parts[0], subpath: parts.slice(1).join("/") };
}

function packageExportTarget(manifest, exportKey) {
	const exportTarget = manifest.exports?.[exportKey];
	if (!exportTarget) return null;
	if (typeof exportTarget === "string") return exportTarget;
	const select = (target) => {
		if (!target) return null;
		if (typeof target === "string") return target;
		if (typeof target !== "object") return null;
		return (
			select(target.import) ??
			select(target.node) ??
			select(target.default) ??
			select(target.require)
		);
	};
	return select(exportTarget);
}

function packageEntryTarget(packageDir, subpath) {
	const manifestPath = path.join(packageDir, "package.json");
	if (!existsSync(manifestPath)) return null;
	const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
	const exportKey = subpath ? `./${subpath}` : ".";
	const target =
		packageExportTarget(manifest, exportKey) ??
		(subpath
			? `./${subpath}`
			: manifest.module ?? manifest.main ?? "./index.js");
	const resolved = path.resolve(packageDir, target);
	if (existsSync(resolved)) return resolved;
	if (!hasKnownModuleExtension(resolved) && existsSync(`${resolved}.js`)) {
		return `${resolved}.js`;
	}
	return null;
}

function workspacePackageResolution(specifier) {
	if (!specifier.startsWith("@refarm.dev/")) return null;

	const [, packageName, ...subpathParts] = specifier.split("/");
	if (!packageName) return null;
	const exportKey =
		subpathParts.length > 0 ? `./${subpathParts.join("/")}` : ".";

	for (const workspaceDir of WORKSPACE_DIRS) {
		const packageDir = path.join(ROOT, workspaceDir, packageName);
		const manifestPath = path.join(packageDir, "package.json");
		if (!existsSync(manifestPath)) continue;

		const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
		const target =
			packageExportTarget(manifest, exportKey) ??
			(exportKey === "." ? manifest.main ?? "./dist/index.js" : null);
		if (!target) return null;

		const resolved = path.resolve(packageDir, target);
		return existsSync(resolved) ? pathToFileURL(resolved).href : null;
	}

	return null;
}

function pnpmStorePackageResolution(specifier) {
	const parts = barePackageParts(specifier);
	if (!parts) return null;

	const storeDir = path.join(ROOT, "node_modules", ".pnpm");
	if (!existsSync(storeDir)) return null;
	const storePrefix = parts.packageName.startsWith("@")
		? `${parts.packageName.replace("/", "+")}@`
		: `${parts.packageName}@`;
	const entry = readdirSync(storeDir).find((name) =>
		name.startsWith(storePrefix),
	);
	if (!entry) return null;

	const packageDir = path.join(
		storeDir,
		entry,
		"node_modules",
		...parts.packageName.split("/"),
	);
	const resolved = packageEntryTarget(packageDir, parts.subpath);
	return resolved ? pathToFileURL(resolved).href : null;
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
		case "refarm:plugin/model-bridge":
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

	const workspaceUrl = workspacePackageResolution(specifier);
	if (workspaceUrl) {
		return { url: workspaceUrl, shortCircuit: true };
	}

	try {
		return await defaultResolve(specifier, context, defaultResolve);
	} catch (error) {
		const storeUrl = pnpmStorePackageResolution(specifier);
		if (storeUrl) {
			return { url: storeUrl, shortCircuit: true };
		}

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
