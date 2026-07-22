import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

/**
 * The farm CLIENT KIT — the device-side verbs (farm-hello/announce/ask) and
 * their libs — is a REUSABLE BLOCK for any refarm-like project. Its whole value
 * is that it speaks only the wire contract (sidecar HTTP + CRDT WS), so it must
 * stay decoupled: no import of a workspace package, no import of apps/refarm,
 * nothing but Node built-ins and its own siblings. That keeps it runnable from a
 * bare `git pull` on Termux/a Raspberry, and copyable into any consumer.
 *
 * This guard makes that architectural promise an executable invariant.
 */

const SCRIPTS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
const KIT_FILES = [
	"farm-hello.mjs",
	"farm-announce.mjs",
	"farm-ask.mjs",
	"lib/farm-beacon.mjs",
	"lib/tailnet.mjs",
	"lib/effort-result.mjs",
];

const IMPORT_RE = /^\s*import\s[^"']*["']([^"']+)["']/gm;

function importsOf(relPath) {
	const source = readFileSync(join(SCRIPTS_DIR, relPath), "utf8");
	const specifiers = [];
	let match;
	while ((match = IMPORT_RE.exec(source)) !== null) specifiers.push(match[1]);
	return specifiers;
}

test("the kit imports only node builtins and its own siblings — no workspace deps", () => {
	const offenders = [];
	for (const file of KIT_FILES) {
		for (const spec of importsOf(file)) {
			const ok = spec.startsWith("node:") || spec.startsWith("./") || spec.startsWith("../");
			if (!ok) offenders.push(`${file} → ${spec}`);
		}
	}
	assert.deepEqual(offenders, [], `farm client kit coupled to non-builtin imports:\n${offenders.join("\n")}`);
});

test("the kit never reaches into apps/ or packages/", () => {
	const offenders = [];
	for (const file of KIT_FILES) {
		for (const spec of importsOf(file)) {
			if (/(^|\/)(apps|packages)\//.test(spec) || spec.includes("@refarm.dev/")) {
				offenders.push(`${file} → ${spec}`);
			}
		}
	}
	assert.deepEqual(offenders, [], `farm client kit reached into the monorepo:\n${offenders.join("\n")}`);
});

test("relative imports stay inside the kit (siblings + ./lib only)", () => {
	const allowed = new Set([
		"./lib/farm-beacon.mjs",
		"./lib/tailnet.mjs",
		"./lib/effort-result.mjs",
		"../lib/farm-beacon.mjs",
		"../lib/tailnet.mjs",
		"../lib/effort-result.mjs",
	]);
	const offenders = [];
	for (const file of KIT_FILES) {
		for (const spec of importsOf(file)) {
			if ((spec.startsWith("./") || spec.startsWith("../")) && !allowed.has(spec)) {
				offenders.push(`${file} → ${spec}`);
			}
		}
	}
	assert.deepEqual(offenders, [], `farm client kit relative import outside the kit:\n${offenders.join("\n")}`);
});
