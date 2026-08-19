#!/usr/bin/env node
/**
 * A PACKAGE MUST SHIP WHAT ITS ENTRY POINTS IMPORT.
 *
 * MEASURED 2026-08-19, while testing whether this node could run an INSTALLED copy of itself
 * instead of the development working tree. `pnpm deploy --prod --legacy` produced a self-contained
 * tree that almost ran, and failed on one line:
 *
 *   Cannot find module '.../@refarm.dev/root/dist/fetch-with-timeout.js'
 *
 * `packages/root` declares `files: ["dist/index.js", "dist/index.d.ts"]`, and `dist/index.js`
 * re-exports from `./fetch-with-timeout.js` — a file the list does not ship. The package is
 * importable everywhere it resolves through the workspace and broken everywhere it does not.
 *
 * THAT IS THE ROPE THE 0.1.0 RELEASE ALREADY NAMES, measured here as SHIPPED-dist rather than
 * built-dist. Six packages carried it, and the invariant they violate is one sentence: every file
 * reachable from a published entry point must itself be published.
 *
 * This gate walks that closure. It is not a lint about style — a package failing it works in
 * development and breaks on install, which is the worst place to find out.
 */
import fs from "node:fs";
import path from "node:path";

/** PURE. Does `files` publish this package-relative path? npm's own matching, narrowed to the
 *  shapes this workspace uses: exact, directory prefix, and `*` globs. */
export function isShipped(relative, files) {
	// No `files` at all means npm publishes everything — nothing to check.
	if (!files || files.length === 0) return true;
	for (const raw of files) {
		const entry = raw.replace(/^\.\//, "").replace(/\/+$/, "");
		if (relative === entry) return true;
		if (relative.startsWith(`${entry}/`)) return true;
		if (entry.includes("*")) {
			const pattern = new RegExp(`^${entry.split("*").map(escapeRegex).join("[^/]*")}$`);
			if (pattern.test(relative)) return true;
			const deep = new RegExp(`^${entry.split("*").map(escapeRegex).join(".*")}$`);
			if (deep.test(relative)) return true;
		}
	}
	return false;
}

function escapeRegex(value) {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** PURE. Every published JS entry point a consumer can reach: `exports` targets, `main`, `module`. */
export function entryPoints(manifest) {
	const found = [];
	const walk = (value) => {
		if (typeof value === "string" && value.startsWith(".")) found.push(value.replace(/^\.\//, ""));
		else if (value && typeof value === "object") for (const nested of Object.values(value)) walk(nested);
	};
	walk(manifest.exports ?? {});
	for (const key of ["main", "module"]) {
		if (typeof manifest[key] === "string") found.push(manifest[key].replace(/^\.\//, ""));
	}
	return [...new Set(found.filter((entry) => entry.endsWith(".js")))];
}

/** PURE-ish. The package-relative files reachable from its entry points, by relative import. */
export function reachableFiles(packageDir, manifest, readFile = defaultReadFile) {
	const seen = new Set();
	const queue = entryPoints(manifest);
	const reached = [];
	while (queue.length > 0) {
		const relative = queue.pop();
		if (seen.has(relative)) continue;
		seen.add(relative);
		const source = readFile(path.join(packageDir, relative));
		// A missing file is not this gate's problem: the build gate owns that, and reporting it
		// here would make one broken build look like a packaging fault.
		if (source === null) continue;
		reached.push(relative);
		for (const match of source.matchAll(/from\s+["'](\.[^"']+)["']/g)) {
			queue.push(path.posix.normalize(path.posix.join(path.posix.dirname(relative), match[1])));
		}
	}
	return reached;
}

function defaultReadFile(target) {
	try {
		return fs.readFileSync(target, "utf-8");
	} catch {
		return null;
	}
}

/** PURE. What a package fails to publish. Empty means it is whole. */
export function unshippedFiles(packageDir, manifest, readFile = defaultReadFile) {
	const files = manifest.files;
	if (!files) return [];
	return reachableFiles(packageDir, manifest, readFile)
		.filter((relative) => !isShipped(relative, files))
		.sort();
}

function main() {
	const root = process.cwd();
	const dirs = fs
		.readdirSync(path.join(root, "packages"), { withFileTypes: true })
		.filter((entry) => entry.isDirectory())
		.map((entry) => path.join(root, "packages", entry.name));

	const problems = [];
	for (const dir of dirs) {
		const manifestPath = path.join(dir, "package.json");
		if (!fs.existsSync(manifestPath)) continue;
		const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
		const missing = unshippedFiles(dir, manifest);
		// EVERY failure, not the first: a gate that stops at one turns a mechanical sweep into
		// as many runs as there are faults.
		if (missing.length > 0) problems.push({ name: manifest.name ?? dir, missing });
	}

	if (problems.length === 0) {
		console.log(`package files closure: ${dirs.length} packages, every entry point ships what it imports.`);
		return 0;
	}
	console.error("package files closure: a published entry point imports a file `files` does not ship.");
	console.error("Installed from a registry or a deploy, these packages fail at import time.\n");
	for (const problem of problems) {
		console.error(`  ${problem.name}`);
		for (const missing of problem.missing) console.error(`      ${missing}`);
	}
	return 1;
}

if (import.meta.url === `file://${process.argv[1]}`) process.exit(main());
