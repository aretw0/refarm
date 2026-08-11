import assert from "node:assert/strict";
import { test } from "node:test";

import {
	ALLOWLISTED_RESOLVER_MODULES,
	BASELINE_MAX_INVALID_MARKERS,
	BASELINE_MAX_OFFENDING_SITES,
	BASELINE_MAX_UNCLASSIFIED_SITES,
	computeBaseline,
	parsePurposeMarker,
	scanForOsResolution,
	summariseByPurpose,
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

// ---- The vocabulary: which QUESTION the site answers, which is what decides whether reading
// the OS is a defect at all. See docs/superpowers/specs/2026-08-10-one-vocabulary-for-both-
// instruments-design.md for why a shape-only ratchet could never start its own burn-down.

test("a marker on the site's own line classifies it", () => {
	const sites = scanForOsResolution([
		file(
			"packages/example/src/where.ts",
			"const root = deps.root ?? process.cwd(); // os-resolution: project — the repo the operator stands in\n",
		),
	]);
	assert.equal(sites.length, 1);
	assert.equal(sites[0].purpose, "project");
	assert.equal(sites[0].purposeReason, "the repo the operator stands in");
});

// The reasons that already exist in this repo are written inside JSDoc blocks several lines
// long (doctor.ts:396-401 argues for five lines that its bare `process.cwd()` is correct).
// Requiring the marker on the immediately preceding line would force that prose to be restated.
test("a marker anywhere in the contiguous comment block above classifies the site", () => {
	const sites = scanForOsResolution([
		file(
			"packages/example/src/where.ts",
			"/**\n * This value must stay the operator's literal standing directory.\n" +
				" * os-resolution: process — the cwd handed to the spawned child\n */\n" +
				"const cwd = options.cwd ?? process.cwd();\n",
		),
	]);
	assert.equal(sites[0].purpose, "process");
	assert.equal(sites[0].line, 5);
});

test("a blank line breaks the block, so a file header cannot classify the first site", () => {
	const sites = scanForOsResolution([
		file(
			"packages/example/src/where.ts",
			"// os-resolution: project — a header comment about the whole file\n\n" +
				"const root = deps.root ?? process.cwd();\n",
		),
	]);
	assert.equal(sites[0].purpose, null);
});

// Three states, never two: "nobody judged this" and "somebody judged it and mistyped" are
// different facts, and a typo'd token must never read as untouched debt.
test("an unknown purpose token is invalid, NOT unclassified", () => {
	const marker = parsePurposeMarker("// os-resolution: projekt — a typo in the token");
	assert.equal(marker.state, "invalid");
	assert.equal(marker.problem, "unknown-purpose");
	assert.equal(marker.token, "projekt");
});

test("a purpose with a reason too short to re-check is rejected", () => {
	assert.equal(parsePurposeMarker("// os-resolution: project — ok").problem, "no-reason");
	assert.equal(parsePurposeMarker("// os-resolution: project").problem, "no-reason");
});

test("no marker at all is null — the absence of a judgement, not a judgement", () => {
	assert.equal(parsePurposeMarker("const root = deps.root ?? process.cwd();"), null);
});

test("summariseByPurpose separates defect from legitimate, and unclassified from invalid", () => {
	const summary = summariseByPurpose([
		{ purpose: "node", purposeInvalid: null },
		{ purpose: "project", purposeInvalid: null },
		{ purpose: "os-user", purposeInvalid: null },
		{ purpose: null, purposeInvalid: null },
		{ purpose: null, purposeInvalid: { problem: "unknown-purpose" } },
	]);
	assert.equal(summary.defect, 1);
	assert.equal(summary.legitimate, 2);
	assert.equal(summary.unclassified, 1);
	assert.equal(summary.invalid, 1);
	assert.equal(summary.total, 5);
});

// THE BURN-DOWN RATCHET. Distinct from the shape ceiling above: this is the number a
// classification slice moves, and it moves with no behaviour change, because the missing thing
// was always the judgement. Falls to 0.
test("the burn-down: unclassified sites must never RISE above the recorded ceiling", () => {
	const { purposes } = computeBaseline();
	const delta = purposes.unclassified - BASELINE_MAX_UNCLASSIFIED_SITES;
	console.log(
		`  unclassified: ${purposes.unclassified} / ceiling ${BASELINE_MAX_UNCLASSIFIED_SITES} ` +
			`· delta ${delta > 0 ? "+" : ""}${delta}`,
	);
	console.log(`  declared:     ${purposes.defect} defect, ${purposes.legitimate} legitimate`);
	assert.ok(
		purposes.unclassified <= BASELINE_MAX_UNCLASSIFIED_SITES,
		`no-os-resolution: ${purposes.unclassified} unjudged site(s), ceiling is ` +
			`${BASELINE_MAX_UNCLASSIFIED_SITES}. A new site resolved against the OS without saying ` +
			"WHICH question it answers. Add `// os-resolution: <purpose> — <reason>` (see " +
			"SITE_PURPOSES) rather than raising the ceiling.",
	);
});

// Always 0, and unlike the two ceilings above this one is not legacy debt: an invalid marker
// can only be introduced by an edit made after this mechanism existed.
test("a marker that does not parse is always a failure, never a tolerated backlog", () => {
	const { sites, purposes } = computeBaseline();
	const broken = sites.filter((site) => site.purposeInvalid);
	assert.equal(
		purposes.invalid,
		BASELINE_MAX_INVALID_MARKERS,
		`unparseable os-resolution marker(s): ${broken
			.map((s) => `${s.file}:${s.line} (${s.purposeInvalid.problem})`)
			.join(", ")}`,
	);
});
