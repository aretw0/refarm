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
	"src/auth.mjs",
	"src/beacon.mjs",
	"src/tailnet.mjs",
	"src/effort.mjs",
	"src/effort-result.mjs",
	"src/usage.mjs",
	"src/manifest.mjs",
	"src/farm-host.mjs",
	"src/ask-host.mjs",
	"src/shims.mjs",
	"src/path-operation.mjs",
	"src/progress.mjs",
	"src/reach.mjs",
	// BUILT blocks the kit CARRIES (see scripts/vendor.mjs). They are held to the
	// same promise as hand-written kit source: node built-ins only. That is the
	// property that makes vendoring legitimate rather than a dependency in disguise.
	"vendor/prompt-contract-v1.mjs",
	"vendor/operation-consent-v1.mjs",
	"bin/farm-hello.mjs",
	"bin/farm-announce.mjs",
	"bin/farm-ask.mjs",
	"bin/farm-update.mjs",
	"bootstrap/install.mjs",
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
			// `../vendor/` is the kit's OWN carried block — a file that ships inside the
			// kit and is verified byte-identical to its built source (test/vendor.test.mjs),
			// not a resolution into node_modules or the monorepo.
			const ok =
				spec.startsWith("node:") ||
				spec.startsWith("./") ||
				spec.startsWith("../src/") ||
				spec.startsWith("../vendor/");
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
