/**
 * ADR-087 generalized source-guard: no generic package names the brand.
 *
 * The original guard lived inside packages/cli's own tests and covered only that
 * package — which is how `startsWith("refarm ")` and a hardcoded spawn of the
 * branded binary survived elsewhere. This guard walks EVERY packages/&#42;/src and
 * fails on a brand literal in code (comments are stripped first — doc examples
 * naming the app binary are legitimate).
 *
 * The allowlist is the surveyed ADR-087 follow-on inventory: deliberate,
 * documented deferrals. It may only SHRINK. When a listed file is cleaned, the
 * ratchet test below forces its entry to be removed.
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const PACKAGES_DIR = path.join(ROOT, "packages");

/** Surveyed brand literals deliberately deferred (see ADR-087 follow-on notes). */
const ALLOWLIST = new Set([
	"capabilities/src/ide-projector.ts", // injectable namespace param defaults to the brand
	"config/src/workspaces-config.js", // workspace-kind vocabulary includes the app's own kind id
	"infra-cloudflare/src/services/turbo-cache/provision.ts", // repo-infra default team name
	"infra-turbo-cache/src/plan.ts", // repo-infra default team name
	"storage-contract-v1/src/conformance.ts", // inert conformance fixture payload
	"toolbox/src/reso.mjs", // repo-internal resolution tooling names its own root package
	"tractor-ts/src/lib/opfs-plugin-cache.ts", // OPFS root segment; §8-locked surface — change via lock/handoff only
]);

const SKIP_DIRS = new Set(["node_modules", "dist", "target", "bindings"]);
const SOURCE_EXTENSIONS = new Set([".ts", ".js", ".mjs"]);

function listSourceFiles(dir) {
	return readdirSync(dir).flatMap((entry) => {
		const fullPath = path.join(dir, entry);
		if (SKIP_DIRS.has(entry)) return [];
		const stats = statSync(fullPath);
		if (stats.isDirectory()) return listSourceFiles(fullPath);
		if (!SOURCE_EXTENSIONS.has(path.extname(entry))) return [];
		if (/\.(test|spec)\.|\.d\.ts$/.test(entry)) return [];
		return [fullPath];
	});
}

function packageSourceFiles() {
	return readdirSync(PACKAGES_DIR).flatMap((pkg) => {
		const srcDir = path.join(PACKAGES_DIR, pkg, "src");
		try {
			if (!statSync(srcDir).isDirectory()) return [];
		} catch {
			return [];
		}
		return listSourceFiles(srcDir);
	});
}

/** Remove block and line comments so doc examples don't trip the guard.
 *  The `[^:]` guard keeps `https://…` URLs intact. */
function stripComments(source) {
	return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function offendersMatching(pattern, { allowlisted }) {
	return packageSourceFiles().flatMap((file) => {
		const rel = path.relative(PACKAGES_DIR, file);
		if (allowlisted !== ALLOWLIST.has(rel)) return [];
		const source = stripComments(readFileSync(file, "utf8"));
		const matches = source.match(pattern) ?? [];
		return matches.map((match) => `${rel}: ${match.trim()}`);
	});
}

const BRAND_LITERAL = /["'`]refarm(?:\s[^"'`\n]*)?["'`]/g;
const BRAND_APPLICATION_CALL = /application(?:Command|Process)\(\s*["'`]refarm["'`]/g;

test("no generic package hardcodes the brand into applicationCommand/applicationProcess", () => {
	assert.deepEqual(offendersMatching(BRAND_APPLICATION_CALL, { allowlisted: false }), []);
	assert.deepEqual(offendersMatching(BRAND_APPLICATION_CALL, { allowlisted: true }), []);
});

test("no generic package ships a brand string literal outside the surveyed allowlist", () => {
	assert.deepEqual(offendersMatching(BRAND_LITERAL, { allowlisted: false }), []);
});

test("ratchet: every allowlist entry still exists and still carries its literal", () => {
	for (const rel of ALLOWLIST) {
		const file = path.join(PACKAGES_DIR, rel);
		const source = stripComments(readFileSync(file, "utf8"));
		assert.ok(
			BRAND_LITERAL.test(source),
			`${rel} no longer contains a brand literal — remove it from the allowlist`,
		);
		BRAND_LITERAL.lastIndex = 0;
	}
});
