#!/usr/bin/env node
/**
 * check-no-tracked-artifacts — the footgun guard.
 *
 * Some generated files were once committed on `main` (WIT→Rust `bindings.rs`, a `dist/` file). Purging
 * them needed a history rewrite — the kind of surgery that becomes very hard to justify after a public
 * release. This fails CI the moment a generated artifact is *tracked*, so the fix is a one-line
 * `git rm --cached` before it ever reaches history, not a rewrite after.
 *
 * It is pattern-based (not "tracked file matches .gitignore"), because hand-written `.d.ts` in
 * JS-atomic packages are legitimately tracked source that the broad `packages/**​/src/**​/*.d.ts`
 * ignore rule would false-positive on. These patterns name only things that are ALWAYS generated.
 *
 * Usage: node scripts/ci/check-no-tracked-artifacts.mjs
 */
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/** Paths that are ALWAYS generated and must never be tracked. */
export const FORBIDDEN_PATTERNS = [
	{ label: "dist output", re: /(^|\/)dist\// },
	{ label: "Rust target dir", re: /(^|\/)target\// },
	{ label: "node_modules", re: /(^|\/)node_modules\// },
	{ label: "generated WIT bindings", re: /(^|\/)bindings\.rs$/ },
	{ label: "tsc build info", re: /\.tsbuildinfo$/ },
	{ label: "turbo cache", re: /(^|\/)\.turbo\// },
	{ label: "compiled wasm", re: /\.wasm$/ },
];

/**
 * Anything under a fixtures dir is intentional test data — a plugin fixture legitimately ships its
 * own `bindings.rs`/`.wasm`/etc. So a fixtures path is exempt from ALL artifact patterns.
 */
export const FIXTURE_RE = /(^|\/)(fixtures|__fixtures__)\//;

/**
 * Find tracked files that are generated artifacts.
 * @param {string[]} trackedFiles - output of `git ls-files`.
 * @returns {{file: string, label: string}[]}
 */
export function findTrackedArtifacts(trackedFiles) {
	const offenders = [];
	for (const file of trackedFiles) {
		if (FIXTURE_RE.test(file)) continue; // test fixtures are source, whatever they contain
		for (const { label, re } of FORBIDDEN_PATTERNS) {
			if (!re.test(file)) continue;
			offenders.push({ file, label });
			break;
		}
	}
	return offenders;
}

function listTrackedFiles() {
	return execFileSync("git", ["ls-files"], { cwd: ROOT, encoding: "utf8" })
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean);
}

function isMain() {
	return process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
}

if (isMain()) {
	const offenders = findTrackedArtifacts(listTrackedFiles());
	if (offenders.length === 0) {
		process.stdout.write("✅ no generated artifacts are tracked.\n");
		process.exit(0);
	}
	process.stderr.write(`❌ ${offenders.length} generated artifact(s) are tracked — untrack them before they reach history:\n\n`);
	for (const { file, label } of offenders) process.stderr.write(`  • ${file}  (${label})\n`);
	process.stderr.write(
		`\nFix: git rm --cached <file>  (keep it on disk, drop it from git). They are already in .gitignore.\n`,
	);
	process.exit(1);
}
