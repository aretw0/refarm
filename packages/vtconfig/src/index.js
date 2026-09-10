import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mergeConfig } from "vite";

/**
 * Resolve the monorepo root from this file's own location, independent of
 * process.cwd(). This file lives at packages/vtconfig/src/index.js, so the
 * root is three directories up.
 *
 * WHY: baseConfig computes resolve aliases at import time. If it used
 * process.cwd(), aliases would be correct when tests run from the repo root
 * but WRONG under `pnpm --filter <pkg> test` (pnpm runs the script with cwd =
 * the package dir), forcing every per-package vitest.config to re-declare
 * `getAliases(path.resolve(__dirname, "../../"))` just to override a broken
 * fallback. Deriving the root from import.meta.url makes the shared aliases
 * correct by construction under any cwd — including the `--filter` runs that
 * CLAUDE.md §3 prescribes.
 */
export function resolveMonorepoRoot() {
	const here = path.dirname(fileURLToPath(import.meta.url));
	return path.resolve(here, "..", "..", "..");
}

export const wasmBrowserHeaders = {
	"Cross-Origin-Opener-Policy": "same-origin",
	"Cross-Origin-Embedder-Policy": "require-corp",
};

export const wasmBrowserBaseConfig = {
	assetsInclude: ["**/*.wasm"],
	server: {
		headers: wasmBrowserHeaders,
	},
	preview: {
		headers: wasmBrowserHeaders,
	},
};

function getCiVitestReporterOptions() {
	if (process.env.GITHUB_ACTIONS !== "true") {
		return {};
	}

	const lifecycle = (process.env.npm_lifecycle_event || "run").replace(/[^a-zA-Z0-9_-]/g, "-");

	return {
		reporters: [["github-actions", { jobSummary: { enabled: false } }], "default", "json"],
		outputFile: {
			json: `.artifacts/vitest/report-${lifecycle}.json`,
		},
	};
}

export function withWasmBrowserConfig(overrides = {}) {
	return mergeConfig(wasmBrowserBaseConfig, overrides);
}

/**
 * Generate Vitest resolve aliases switching between src and dist.
 *
 * Env vars (must be declared in turbo.json `env` for cache correctness):
 *   VITEST_USE_DIST=true          — all workspace packages resolve via dist/
 *   VITEST_FORCE_DIST=pkg1,pkg2   — only the listed packages resolve via dist/
 *
 * Use cases:
 *   VITEST_USE_DIST=true <package-manager> run test      # test against built artifacts
 *   VITEST_FORCE_DIST=@refarm.dev/barn <package-manager> run test
 *                                                        # isolate one published dep
 *
 * @param {string} root - The root directory of the monorepo.
 */
export function getAliases(root) {
	const useDistGlobal = process.env.VITEST_USE_DIST === "true";
	const forcedDistPackages = (process.env.VITEST_FORCE_DIST || "").split(",").map((s) => s.trim());
	const packagesDir = path.resolve(root, "packages");
	const localesDir = path.resolve(root, "locales");

	const getSuffix = (pkgName) => {
		const isForcedDist = forcedDistPackages.includes(pkgName);
		if (useDistGlobal || isForcedDist) return "dist/index.js";

		// Check if package is JS-Atomic or TS-Strict
		const pkgRelativePath = pkgName.includes("@refarm.dev/")
			? pkgName.replace("@refarm.dev/", "")
			: pkgName;

		// Handle tractor-ts specifically if needed, or rely on fs check
		const pkgDir = path.resolve(
			packagesDir,
			pkgRelativePath === "tractor" ? "tractor-ts" : pkgRelativePath,
		);

		if (fs.existsSync(path.resolve(pkgDir, "src", "index.ts"))) {
			return "src/index.ts";
		}
		return "src/index.js";
	};

	return {
		"@refarm.dev/tractor/test/test-utils": path.resolve(
			packagesDir,
			"tractor-ts",
			"test",
			"test-utils.ts",
		),
		"@refarm.dev/tractor/browser": path.resolve(
			packagesDir,
			"tractor-ts",
			useDistGlobal || forcedDistPackages.includes("@refarm.dev/tractor")
				? "dist/src/index.browser.js"
				: "src/index.browser.ts",
		),
		"@refarm.dev/tractor": path.resolve(
			packagesDir,
			"tractor-ts",
			getSuffix("@refarm.dev/tractor"),
		),
		"@refarm.dev/plugin-manifest": path.resolve(
			packagesDir,
			"plugin-manifest",
			getSuffix("@refarm.dev/plugin-manifest"),
		),
		"@refarm.dev/barn": path.resolve(packagesDir, "barn", getSuffix("@refarm.dev/barn")),
		"@refarm.dev/storage-contract-v1": path.resolve(
			packagesDir,
			"storage-contract-v1",
			getSuffix("@refarm.dev/storage-contract-v1"),
		),
		"@refarm.dev/sync-contract-v1": path.resolve(
			packagesDir,
			"sync-contract-v1",
			getSuffix("@refarm.dev/sync-contract-v1"),
		),
		"@refarm.dev/identity-contract-v1": path.resolve(
			packagesDir,
			"identity-contract-v1",
			getSuffix("@refarm.dev/identity-contract-v1"),
		),
		"@refarm.dev/config/plugin-identity": path.resolve(
			packagesDir,
			"config",
			"src/plugin-identity.js",
		),
		"@refarm.dev/config": path.resolve(packagesDir, "config", getSuffix("@refarm.dev/config")),
		"@refarm.dev/vtconfig": path.resolve(
			packagesDir,
			"vtconfig",
			getSuffix("@refarm.dev/vtconfig"),
		),
		"@refarm.dev/toolbox": path.resolve(packagesDir, "toolbox", getSuffix("@refarm.dev/toolbox")),
		"@refarm.dev/process-handoff": path.resolve(
			packagesDir,
			"process-handoff",
			getSuffix("@refarm.dev/process-handoff"),
		),
		"@refarm.dev/storage-sqlite/node": path.resolve(
			packagesDir,
			"storage-sqlite",
			useDistGlobal || forcedDistPackages.includes("@refarm.dev/storage-sqlite")
				? "dist/node.js"
				: "src/node.ts",
		),
		"@refarm.dev/storage-sqlite": path.resolve(
			packagesDir,
			"storage-sqlite",
			getSuffix("@refarm.dev/storage-sqlite"),
		),
		"@refarm.dev/locales": localesDir,
	};
}

/**
 * Shared base configuration imported by per-package vitest.config.ts files.
 * @type {baseConfig}
 */
export const baseConfig = {
	test: {
		globals: true,
		environment: "node",
		/**
		 * COLOUR OFF, REPO-WIDE. Dozens of assertions across this monorepo read printed output
		 * as plain text (`expect(out).toContain("current: ollama/llama3.2")`), and chalk wraps
		 * that value in ANSI escapes whenever the ambient terminal supports colour. CI has no
		 * TTY, so those suites are green there and RED on an ordinary developer machine —
		 * measured 2026-08-11: `FORCE_COLOR=3` in an xterm-256color session turned 5 failures
		 * into 16 in apps/refarm alone.
		 *
		 * A suite whose result depends on the operator's terminal is not a suite. Fixed here,
		 * once, rather than in each assertion: the defect is ONE environment dependency, not
		 * eleven wrong expectations.
		 *
		 * `test.env` and not a setup file, measured: chalk resolves its level at import, and
		 * vitest loads chalk for its own reporter before any setupFile runs — setting the var
		 * (or `chalk.level`) from there changed nothing, because the instance under test is a
		 * different module copy. `test.env` is applied to the worker before the module graph
		 * loads, which is the only point early enough.
		 */
		env: { FORCE_COLOR: "0", NO_COLOR: "1" },
		/**
		 * HOME CONTAINMENT, for every project that inherits this config — see
		 * `home-containment.js` for what it does and for the day it was written after the suite
		 * deleted a key from the operator's live node config (ISS-109). Resolved from THIS
		 * file's location, never from cwd, for the same reason the aliases are: a package
		 * running under `--filter` has a different cwd and would otherwise resolve nothing.
		 *
		 * A package that adds its OWN `setupFiles` keeps this one — `mergeConfig` concatenates
		 * arrays — so opting into extra containment never opts out of the shared floor.
		 */
		setupFiles: [
			path.join(path.dirname(fileURLToPath(import.meta.url)), "home-containment.js"),
			// LAYER 1 too, repo-wide, on a MEASUREMENT rather than a plan. ISS-110 assumed this had
			// to be adopted package by package because 101 test files write through
			// `writeFileSync`/`mkdirSync`. It does not: a forced `turbo run test` across all 282
			// tasks with the guard in "report" mode recorded ZERO escapes, because Layer 0 already
			// points HOME at a tree inside the OS temp dir, so those 101 writers were landing
			// somewhere the guard permits. The count that looked like the cost was the count of
			// writers, not the count of escapes.
			//
			// The zero was verified against a deliberate escape, not trusted: planting one
			// `writeFileSync` outside tmp produced exactly one recorded escape naming the
			// operation, the path, the test and the package.
			path.join(path.dirname(fileURLToPath(import.meta.url)), "write-guard-strict.js"),
		],
		coverage: {
			provider: "v8",
			reporter: ["text", "json-summary"],
			exclude: [
				"node_modules/",
				"dist/",
				"**/*.test.ts",
				"**/*.spec.ts",
				"**/*.test.js",
				"**/*.spec.js",
				"**/test/**",
				"**/src/transpiled/**",
			],
		},
		include: ["**/*.test.ts", "**/*.spec.ts", "**/*.test.js", "**/*.spec.js"],
		exclude: ["node_modules/", "**/dist/**", ".idea", ".git", ".cache", "validations/"],
		testTimeout: 15000,
		hookTimeout: 15000,
		// OOM-freeze guard: bound the worker pool so no test run (even a broad filter) can
		// exhaust the container's 4GB cap. Vitest 4 moved this limit to a top-level option.
		// ~4 workers ≈ 1GB + base ≈ 2GB, safely under 4GB.
		// Tune up if the host gives the container more memory (see .devcontainer --memory).
		maxWorkers: 4,
		...getCiVitestReporterOptions(),
	},
	resolve: {
		// Root derived from this file's location (see resolveMonorepoRoot), NOT
		// process.cwd(), so the shared aliases are correct under `pnpm --filter`
		// too — no per-package re-declaration required.
		alias: getAliases(resolveMonorepoRoot()),
	},
};

export default baseConfig;
