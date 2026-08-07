import assert from "node:assert/strict";
import { test } from "node:test";

import {
	ALLOWLISTED_RESOLVER_MODULES,
	BASELINE_MAX_OFFENDING_SITES,
	computeBaseline,
	scanForOsResolution,
} from "./no-os-resolution.mjs";

/** Small helper so fixtures read as `{ path, content }` without repeating the shape. */
function file(path, content) {
	return { path, content };
}

test("finds a `= process.cwd()` default", () => {
	const sites = scanForOsResolution([
		file(
			"packages/example/src/tls.ts",
			"export function resolveTlsDir(root: string = process.cwd()): string {\n\treturn root;\n}\n",
		),
	]);
	assert.equal(sites.length, 1);
	assert.equal(sites[0].file, "packages/example/src/tls.ts");
	assert.equal(sites[0].kind, "default");
	assert.equal(sites[0].resolver, "process.cwd()");
	assert.equal(sites[0].line, 1);
});

test("finds a `?? homedir()` fallback (destructured import binding)", () => {
	const sites = scanForOsResolution([
		file(
			"packages/example/src/scope.ts",
			'import { homedir } from "node:os";\n\n' +
				"export function scopedAssetsDir(options = {}) {\n" +
				"\treturn options.userHome ?? homedir();\n" +
				"}\n",
		),
	]);
	assert.equal(sites.length, 1);
	assert.equal(sites[0].kind, "fallback");
	assert.equal(sites[0].resolver, "homedir()");
	assert.equal(sites[0].line, 4);
});

test("does NOT find a `= process.env` default — reading a declaration is correct", () => {
	const sites = scanForOsResolution([
		file(
			"packages/example/src/env.ts",
			"export function readEnv(env = process.env) {\n\treturn env.HOME;\n}\n",
		),
	]);
	assert.deepEqual(sites, []);
});

test("does NOT find an occurrence inside a `//` line comment", () => {
	const sites = scanForOsResolution([
		file(
			"packages/example/src/commented.ts",
			"// const legacyDir = process.cwd();\nexport function noop() {}\n",
		),
	]);
	assert.deepEqual(sites, []);
});

test("does NOT find an occurrence inside a `/* */` block comment", () => {
	const sites = scanForOsResolution([
		file(
			"packages/example/src/commented-block.ts",
			"/* function old(root = process.cwd()) { return root; } */\nexport function noop2() {}\n",
		),
	]);
	assert.deepEqual(sites, []);
});

test("does NOT find an occurrence inside a string literal or a template literal", () => {
	const sites = scanForOsResolution([
		file(
			"packages/example/src/strings.ts",
			'import os from "node:os";\n\n' +
				'export const EXAMPLE = "call process.cwd() to get root";\n' +
				"export const EXAMPLE2 = `use os.homedir() carefully`;\n",
		),
	]);
	assert.deepEqual(sites, []);
});

test("allowlisted modules are excluded entirely, by exact relative path", () => {
	const offender =
		"export function resolveHome(root: string = process.cwd()): string {\n\treturn root;\n}\n";
	const sites = scanForOsResolution([
		file("apps/refarm/src/utils/refarm-home.ts", offender),
		file("packages/config/src/index.js", offender),
	]);
	assert.deepEqual(sites, []);
});

test("allowlist matches the full relative path, not just the basename", () => {
	const offender =
		"export function resolveHome(root: string = process.cwd()): string {\n\treturn root;\n}\n";
	// Same basename as the allowlisted apps/refarm/src/utils/refarm-home.ts, different directory.
	const sites = scanForOsResolution([file("packages/other/src/refarm-home.ts", offender)]);
	assert.equal(sites.length, 1);
});

test("`os.homedir()` (default/namespace import binding) is found as a fallback", () => {
	const sites = scanForOsResolution([
		file(
			"packages/example/src/os-member.ts",
			'import os from "node:os";\n\n' +
				"export function resolveHome(userHome) {\n" +
				"\treturn userHome ?? os.homedir();\n" +
				"}\n",
		),
	]);
	assert.equal(sites.length, 1);
	assert.equal(sites[0].kind, "fallback");
	assert.equal(sites[0].resolver, "os.homedir()");
});

test("an aliased destructured import (`homedir as getHome`) is found under its LOCAL name", () => {
	const sites = scanForOsResolution([
		file(
			"packages/example/src/aliased.ts",
			'import { homedir as getHome } from "node:os";\n\n' +
				"export function resolveRoot(root = getHome()) {\n" +
				"\treturn root;\n" +
				"}\n",
		),
	]);
	assert.equal(sites.length, 1);
	assert.equal(sites[0].kind, "default");
	assert.equal(sites[0].resolver, "getHome()");
});

test("a bare `homedir()` call with NO node:os import is NOT flagged — unrelated local identifier", () => {
	const sites = scanForOsResolution([
		file(
			"packages/example/src/local-homedir.ts",
			'function homedir() { return "/unrelated"; }\n' +
				"export function useLocal(x = homedir()) {\n" +
				"\treturn x;\n" +
				"}\n",
		),
	]);
	assert.deepEqual(sites, []);
});

test("a destructuring parameter default (`{ home = homedir() } = {}`) is found — the real farm-client shape", () => {
	const sites = scanForOsResolution([
		file(
			"packages/example/src/farm-token.ts",
			'import { homedir } from "node:os";\n\n' +
				"export function farmTokenFile({ env = process.env, home = homedir() } = {}) {\n" +
				"\treturn { env, home };\n" +
				"}\n",
		),
	]);
	// Exactly ONE site: `home = homedir()`. `env = process.env` must never be counted.
	assert.equal(sites.length, 1);
	assert.equal(sites[0].kind, "default");
	assert.equal(sites[0].resolver, "homedir()");
});

test("comparison/arrow operators that merely CONTAIN `=` before a resolver call are not mistaken for a default", () => {
	const sites = scanForOsResolution([
		file(
			"packages/example/src/comparisons.ts",
			"export function check(root) {\n" +
				"\treturn root === process.cwd();\n" +
				"}\n" +
				"export const make = () => process.cwd();\n",
		),
	]);
	assert.deepEqual(sites, []);
});

test("computeBaseline scans the real repo and returns a stable, explainable count", () => {
	const baseline = computeBaseline();
	assert.equal(typeof baseline.count, "number");
	assert.ok(baseline.count >= 0);
	assert.ok(baseline.filesScanned > 0);
	assert.ok(Array.isArray(baseline.sites));
	assert.equal(baseline.sites.length, baseline.count);
});

test("the two allowlisted modules are named exactly, matching apps/refarm and packages/config", () => {
	assert.deepEqual(ALLOWLISTED_RESOLVER_MODULES, [
		"apps/refarm/src/utils/refarm-home.ts",
		"packages/config/src/index.js",
	]);
});

// THE RATCHET. Prints the current count, the recorded ceiling, and the delta on every run —
// the burn-down (Task 2+ of the plan this file implements) is visible without reading code.
// Fails when the count RISES above BASELINE_MAX_OFFENDING_SITES; a lower count is always
// welcome but does NOT fail here — lowering the ceiling itself is a deliberate edit to
// BASELINE_MAX_OFFENDING_SITES (in no-os-resolution.mjs), done by the slice that earned it, so
// the commit message states the before/after (see docs/NO_OS_RESOLUTION.md).
test("the ratchet: offending sites must never RISE above the recorded ceiling", () => {
	const { count, byKind, filesScanned } = computeBaseline();
	const delta = count - BASELINE_MAX_OFFENDING_SITES;
	console.log(
		`no-os-resolution: ${count} offending site(s) across ${filesScanned} scanned file(s) ` +
			`(default=${byKind.default}, fallback=${byKind.fallback})`,
	);
	console.log(`  ceiling: ${BASELINE_MAX_OFFENDING_SITES}`);
	console.log(`  delta:   ${delta > 0 ? "+" : ""}${delta}`);
	assert.ok(
		count <= BASELINE_MAX_OFFENDING_SITES,
		`no-os-resolution: ${count} offending site(s) found, ceiling is ${BASELINE_MAX_OFFENDING_SITES} ` +
			`(+${delta}). A NEW resolver defaulted to the OS somewhere outside the two allowlisted ` +
			"modules. Fix the new site instead of raising the ceiling — see docs/NO_OS_RESOLUTION.md.",
	);
});
