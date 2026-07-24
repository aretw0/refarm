import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

/**
 * @refarm.dev/farm-client is a REUSABLE BLOCK for any refarm-like project. Its
 * whole value is that it speaks only the wire contract (sidecar HTTP + CRDT WS),
 * so it must stay decoupled: no import of a workspace package, no import of
 * apps/refarm, nothing but Node built-ins and its own siblings. That keeps it
 * importable AND runnable from a bare `git pull` on Termux / a Raspberry.
 *
 * This guard makes that architectural promise an executable invariant.
 */

const PKG_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
const KIT_FILES = [
	"src/index.mjs",
	"src/beacon.mjs",
	"src/tailnet.mjs",
	"src/effort.mjs",
	"src/effort-result.mjs",
	"src/usage.mjs",
	"src/manifest.mjs",
	"bin/farm-hello.mjs",
	"bin/farm-announce.mjs",
	"bin/farm-ask.mjs",
	"bin/farm-update.mjs",
];

const IMPORT_RE = /^\s*import\s[^"']*["']([^"']+)["']/gm;

function importsOf(relPath) {
	const source = readFileSync(join(PKG_DIR, relPath), "utf8");
	const specifiers = [];
	let match;
	while ((match = IMPORT_RE.exec(source)) !== null) specifiers.push(match[1]);
	return specifiers;
}

test("imports only node builtins and own siblings — no workspace deps", () => {
	const offenders = [];
	for (const file of KIT_FILES) {
		for (const spec of importsOf(file)) {
			const ok = spec.startsWith("node:") || spec.startsWith("./") || spec.startsWith("../src/");
			if (!ok) offenders.push(`${file} → ${spec}`);
		}
	}
	assert.deepEqual(offenders, [], `farm-client coupled to non-builtin imports:\n${offenders.join("\n")}`);
});

test("never reaches into apps/ or packages/ or @refarm.dev/*", () => {
	const offenders = [];
	for (const file of KIT_FILES) {
		for (const spec of importsOf(file)) {
			if (/(^|\/)(apps|packages)\//.test(spec) || spec.includes("@refarm.dev/")) {
				offenders.push(`${file} → ${spec}`);
			}
		}
	}
	assert.deepEqual(offenders, [], `farm-client reached into the monorepo:\n${offenders.join("\n")}`);
});
