#!/usr/bin/env node
/**
 * check-src-dep-manifest.mjs
 *
 * Keeps every workspace's DECLARED dependency manifest honest against what its
 * `src/**` actually imports — the drift that a manual "extract an example's core
 * into a reusable block" (the repo's COMUM→bloco convergence) leaves behind.
 *
 * Three signals, precise because they resolve against the real workspace
 * package-name index (so path-map aliases like `@refarm.dev/locales/*` →
 * `locales/*`, which are NOT packages, never false-positive):
 *
 *   MISSING (error) — a `@refarm.*` specifier imported in src that IS a real
 *     workspace package but is not declared. Resolves locally via pnpm hoisting,
 *     then breaks a consumer or `pnpm publish` where resolution is strict. This
 *     complements two narrower checks: check-vitest-config-deps.mjs (tool-config
 *     files only) and check-missing-deps.mjs (which scans only `.ts`/`.tsx` under
 *     apps/packages, so it cannot see a `.js`-source package like health or any
 *     example under examples/ — exactly the gaps this scan closes).
 *
 *   STALE path-map (error) — a tsconfig `paths` entry whose base IS a real
 *     workspace package but is not a declared dependency. Type-check passes green
 *     through the stale alias while the build/publish path can't resolve it — the
 *     exact silent drift a hardening review caught after the wallet extraction.
 *
 *   UNUSED (advisory, never fails) — a declared `@refarm.*` dependency that no
 *     src/test file imports and no tsconfig path-map references. Reported to nudge
 *     dep hygiene; NOT a gate, because a dep can be consumed through
 *     package.json `exports`/`imports` conditions this scan does not model.
 *
 * Usage:
 *   node scripts/ci/check-src-dep-manifest.mjs            # all workspaces
 *   node scripts/ci/check-src-dep-manifest.mjs packages/wallet examples/wallet-t2
 *   node scripts/ci/check-src-dep-manifest.mjs --json     # machine-readable report
 *
 * Exit 0 = no MISSING/STALE errors (advisory UNUSED may still print).
 * Exit 1 = at least one MISSING or STALE path-map error.
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const WORKSPACE_ROOTS = ["packages", "apps", "examples"];

const colors = {
	reset: "\x1b[0m",
	red: "\x1b[31m",
	green: "\x1b[32m",
	yellow: "\x1b[33m",
	cyan: "\x1b[36m",
	dim: "\x1b[2m",
};

/** A workspace specifier is any bare import under a `@refarm.*` scope. */
const REFARM_SCOPE = /^@refarm\.[a-z0-9-]+\//;

function readJson(path) {
	try {
		return JSON.parse(readFileSync(path, "utf8"));
	} catch {
		return null;
	}
}

/** The base package of a specifier: `@scope/name/sub` → `@scope/name`. */
export function basePackage(specifier) {
	return specifier.split("/").slice(0, 2).join("/");
}

/**
 * Every real workspace package, indexed by its package.json `name` (NOT its
 * directory — e.g. `packages/tractor-ts` publishes `@refarm.dev/tractor`). This
 * index is what makes MISSING/STALE precise: only names that are truly workspace
 * packages can be flagged; path-map aliases to root dirs are correctly ignored.
 */
function buildWorkspaceIndex() {
	const index = new Map();
	for (const root of WORKSPACE_ROOTS) {
		const dir = join(ROOT, root);
		if (!existsSync(dir)) continue;
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			if (!entry.isDirectory()) continue;
			const pkgDir = join(dir, entry.name);
			const pkg = readJson(join(pkgDir, "package.json"));
			if (pkg?.name) index.set(pkg.name, `${root}/${entry.name}`);
		}
	}
	return index;
}

/** Recursively collect source files under a dir, skipping build/artifact dirs. */
function collectSourceFiles(dir, acc = []) {
	if (!existsSync(dir)) return acc;
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		if (entry.name === "node_modules" || entry.name === "dist" || entry.name === "dist-web") continue;
		const full = join(dir, entry.name);
		if (entry.isDirectory()) {
			collectSourceFiles(full, acc);
		} else if (/\.(ts|tsx|mts|cts|js|mjs|cjs|jsx|astro|svelte|vue)$/.test(entry.name)) {
			acc.push(full);
		}
	}
	return acc;
}

/**
 * Every `@refarm.*` specifier a source string imports — static `from`, dynamic
 * `import(...)`, side-effect `import "..."`, `export ... from`, and `require(...)`.
 */
export function extractRefarmSpecifiers(source) {
	const found = new Set();
	const patterns = [
		/\bfrom\s+["'](@refarm\.[^"']+)["']/g,
		/\bimport\s*\(\s*["'](@refarm\.[^"']+)["']\s*\)/g,
		/\bimport\s+["'](@refarm\.[^"']+)["']/g,
		/\brequire\s*\(\s*["'](@refarm\.[^"']+)["']\s*\)/g,
	];
	for (const pattern of patterns) {
		let m;
		while ((m = pattern.exec(source)) !== null) found.add(m[1]);
	}
	return found;
}

/** All `@refarm.*` path-map keys declared across a workspace's tsconfig files. */
function collectPathMapSpecifiers(pkgDir) {
	const specs = new Set();
	for (const name of ["tsconfig.json", "tsconfig.build.json", "tsconfig.web.json"]) {
		const cfg = readJson(join(pkgDir, name));
		const paths = cfg?.compilerOptions?.paths;
		if (!paths) continue;
		for (const key of Object.keys(paths)) {
			if (REFARM_SCOPE.test(key.endsWith("/*") ? key : `${key}/`)) specs.add(key.replace(/\/\*$/, ""));
		}
	}
	return specs;
}

/**
 * The PURE decision core — no filesystem, so it is directly unit-testable. Given a
 * workspace's declared deps, its actual src imports, its tsconfig path-map bases, and
 * the real workspace package-name index, decide MISSING / STALE / UNUSED. All three
 * are gated on `workspaceIndex.has(base)` so aliases (root-dir path-maps like
 * `@refarm.dev/locales`) and external packages never false-positive, and self-imports
 * (`base === ownName`) are always skipped.
 *
 * @param {object} p
 * @param {string} p.ownName                    this package's own name
 * @param {Set<string>} p.declared              deps ∪ devDeps ∪ peer ∪ optional
 * @param {Iterable<string>} p.runtimeDeps      `dependencies` keys only (UNUSED scope)
 * @param {Map<string,string>} p.importedBases  base package → a sample source file
 * @param {Set<string>} p.pathMapBases          base packages referenced in tsconfig paths
 * @param {Set<string>|Map<string,unknown>} p.workspaceIndex  every real workspace name
 */
export function computeWorkspaceDrift({ ownName, declared, runtimeDeps, importedBases, pathMapBases, workspaceIndex }) {
	const missing = [];
	for (const [base, sampleFile] of importedBases) {
		if (base === ownName) continue; // a package importing its own subpath is fine
		if (!workspaceIndex.has(base)) continue; // alias / external — not a workspace package
		if (!declared.has(base)) missing.push({ base, sampleFile });
	}

	const stalePathMaps = [];
	for (const base of pathMapBases) {
		if (base === ownName) continue;
		if (!workspaceIndex.has(base)) continue; // root-dir alias (e.g. @refarm.dev/locales) — legitimate
		if (!declared.has(base)) stalePathMaps.push({ base });
	}

	const unused = [];
	for (const dep of runtimeDeps) {
		if (!REFARM_SCOPE.test(`${dep}/`)) continue; // only reason about workspace deps
		if (!workspaceIndex.has(dep)) continue; // a @refarm.* that isn't a local package — skip
		if (importedBases.has(dep) || pathMapBases.has(dep)) continue; // used somewhere
		unused.push({ base: dep });
	}

	return { missing, stalePathMaps, unused };
}

function checkWorkspace(rel, workspaceIndex) {
	const pkgDir = join(ROOT, rel);
	const pkg = readJson(join(pkgDir, "package.json"));
	if (!pkg) return null;
	const ownName = pkg.name;

	const declared = new Set([
		...Object.keys(pkg.dependencies ?? {}),
		...Object.keys(pkg.devDependencies ?? {}),
		...Object.keys(pkg.peerDependencies ?? {}),
		...Object.keys(pkg.optionalDependencies ?? {}),
	]);
	// UNUSED reasons only over RUNTIME deps: a declared runtime dependency the code
	// never touches is the real "false coupling" smell (the class a hardening review
	// found in wallet-t2). devDeps are mostly config packages (tsconfig/eslint/vtconfig)
	// consumed through `extends`/config-file imports this src scan does not model.
	const runtimeDeps = Object.keys(pkg.dependencies ?? {});

	// What src/** actually imports (used to detect MISSING + to clear UNUSED).
	const importedBases = new Map(); // base -> example file (rel) for the message
	for (const file of collectSourceFiles(join(pkgDir, "src"))) {
		const source = readFileSync(file, "utf8");
		for (const spec of extractRefarmSpecifiers(source)) {
			const base = basePackage(spec);
			if (!importedBases.has(base)) importedBases.set(base, relative(ROOT, file));
		}
	}

	const pathMapBases = new Set([...collectPathMapSpecifiers(pkgDir)].map(basePackage));

	const drift = computeWorkspaceDrift({ ownName, declared, runtimeDeps, importedBases, pathMapBases, workspaceIndex });
	return { rel, ownName, ...drift };
}

function main() {
	const args = process.argv.slice(2);
	const asJson = args.includes("--json");
	const explicit = args.filter((a) => !a.startsWith("--"));

	const workspaceIndex = buildWorkspaceIndex();

	const targets = explicit.length
		? explicit.map((a) => a.replace(/\/+$/, ""))
		: [...workspaceIndex.values()].sort();

	const reports = [];
	for (const rel of targets) {
		const report = checkWorkspace(rel, workspaceIndex);
		if (report) reports.push(report);
	}

	const withErrors = reports.filter((r) => r.missing.length || r.stalePathMaps.length);
	const withUnused = reports.filter((r) => r.unused.length);

	if (asJson) {
		console.log(JSON.stringify({ ok: withErrors.length === 0, reports }, null, 2));
		process.exit(withErrors.length === 0 ? 0 : 1);
	}

	if (withErrors.length === 0) {
		console.log(`${colors.green}✓ src dep manifest: no missing deps or stale path-maps${colors.reset}`);
	} else {
		console.error(`${colors.red}✗ src dependency manifest drift detected${colors.reset}\n`);
		for (const r of withErrors) {
			console.error(`  ${colors.cyan}${r.rel}${colors.reset} ${colors.dim}(${r.ownName})${colors.reset}`);
			for (const { base, sampleFile } of r.missing) {
				console.error(
					`    ${colors.red}MISSING${colors.reset} ${base} ${colors.dim}— imported in ${sampleFile}, not in package.json${colors.reset}`,
				);
				console.error(`      ${colors.dim}Fix: add "${base}": "workspace:*" to ${r.rel}/package.json${colors.reset}`);
			}
			for (const { base } of r.stalePathMaps) {
				console.error(
					`    ${colors.red}STALE PATH-MAP${colors.reset} ${base} ${colors.dim}— in tsconfig paths, not a declared dependency${colors.reset}`,
				);
				console.error(
					`      ${colors.dim}Fix: declare "${base}" or remove its tsconfig paths entry in ${r.rel}${colors.reset}`,
				);
			}
			console.error("");
		}
	}

	if (withUnused.length) {
		console.error(`${colors.yellow}⚠ advisory — declared @refarm.* deps with no src/path-map use:${colors.reset}`);
		for (const r of withUnused) {
			console.error(`  ${colors.cyan}${r.rel}${colors.reset}: ${r.unused.map((u) => u.base).join(", ")}`);
		}
		console.error(
			`  ${colors.dim}(advisory only — a dep may be consumed via package.json exports/imports this scan does not model)${colors.reset}\n`,
		);
	}

	process.exit(withErrors.length === 0 ? 0 : 1);
}

// Run only as a CLI — importing this module (e.g. from the test) must not scan the
// repo or call process.exit.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	main();
}
