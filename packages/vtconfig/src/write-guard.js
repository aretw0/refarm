import path from "node:path";
import { expect, vi } from "vitest";

import { testHomeSandbox } from "./home-containment.js";

/**
 * LAYER 1 OF THE TEST CONTAINMENT — the write guard, opt-in per package (ISS-110).
 *
 * `home-containment.js` (Layer 0, in `baseConfig.test.setupFiles`) REDIRECTS: it points every
 * "where is the user's home" answer at a throwaway tree. It forbids nothing, which is why it
 * could be switched on for all 64 workspaces in one move and broke zero tests.
 *
 * This one REFUSES. Every mutating `fs` entry point throws outside the OS temp dir, naming the
 * path and the test. It is what turns "a test wrote somewhere it should not" from a silent fact
 * into a failing test — and it cannot be switched on repo-wide in one move, because 101 test
 * files here write through `writeFileSync`/`mkdirSync` and a throw for all of them at once
 * would be rewriting the suite rather than containing it.
 *
 * Hence `mode`:
 *
 *   "report"  Measure. Every escape is logged with its path and test, and the write PROCEEDS.
 *             A package adopts this first to find out what it is buying, on a run that cannot
 *             go red because of the guard itself.
 *   "throw"   Enforce. A package moves here once "report" is quiet, and from then on an escape
 *             is a failing test.
 *
 * Usage, in a package's own `vitest.setup.js` (never in `baseConfig` — the whole point is that
 * it is adopted knowingly):
 *
 *     import { installWriteGuard } from "@refarm.dev/vtconfig/write-guard";
 *     installWriteGuard({ mode: "throw" });
 *
 * Reads are untouched throughout. Only creation and mutation are guarded.
 */

/** Writable only inside the throwaway tree (and the OS temp dir it lives in) — the same policy
 *  `apps/refarm`'s conformance harness applies. A write anywhere else is a bug in a test or in
 *  the code under test, not something to redirect silently. */
function isWritablePath(target) {
	if (typeof target !== "string" && !(target instanceof URL) && !Buffer.isBuffer(target)) {
		// A numeric fd — the open()/createWriteStream() that produced it was already gated, so
		// there is no path left to check here.
		return true;
	}
	const value =
		target instanceof URL ? target.pathname : Buffer.isBuffer(target) ? target.toString() : target;
	const resolved = path.resolve(process.cwd(), value);
	const root = testHomeSandbox.tmpRoot;
	return resolved === root || resolved.startsWith(`${root}${path.sep}`);
}

function escapeMessage(operation, target) {
	const testName = expect.getState?.().currentTestName ?? "(unknown test)";
	return (
		`test-home-sandbox: fs.${operation} outside ${testHomeSandbox.tmpRoot} ` +
		`(path: ${String(target)}, test: ${testName})`
	);
}

/**
 * fs entry points that CREATE OR MUTATE something, each guarded in both its callback and `Sync`
 * form. Reads are untouched.
 */
function guardedFsNames() {
	const operations = [
		"writeFile",
		"appendFile",
		"mkdir",
		"mkdtemp",
		"rm",
		"rmdir",
		"unlink",
		"rename",
		"copyFile",
		"cp",
		"truncate",
		"chmod",
		"chown",
		"lchmod",
		"lchown",
		"symlink",
		"link",
		"utimes",
		"lutimes",
		"open",
		"writev",
		"createWriteStream",
	];
	return operations.flatMap((operation) => [operation, `${operation}Sync`]);
}

/**
 * Which argument positions of a guarded call are PATHS to check.
 *
 * Most guarded operations take exactly one path in position 0 — position 1 is DATA or OPTIONS,
 * never a path, and must not be checked: a string payload passed to `writeFileSync` is not a
 * path, and checking it against the sandbox root produces a false escape on every ordinary
 * write.
 *
 * `rename`/`copyFile`/`cp`/`link` are the real two-path operations. `symlink(target, path)` only
 * creates `path` — `target` is an arbitrary string that need not resolve to anything.
 */
function pathArgIndexes(name) {
	const base = name.endsWith("Sync") ? name.slice(0, -"Sync".length) : name;
	if (base === "rename" || base === "copyFile" || base === "cp" || base === "link") return [0, 1];
	if (base === "symlink") return [1];
	return [0];
}

/** Every escape seen in "report" mode, so a package can count what adopting would cost. */
const reported = [];

/** What `mode: "report"` has seen so far, deduplicated by operation+path. Exported so a
 *  measurement run can print a total instead of the caller grepping stderr. */
export function reportedEscapes() {
	return [...reported];
}

function guardFsLike(source, mode) {
	const guarded = { ...source };
	for (const name of guardedFsNames()) {
		const original = source[name];
		if (typeof original !== "function") continue;
		guarded[name] = (...args) => {
			for (const index of pathArgIndexes(name)) {
				const target = args[index];
				if (typeof target !== "string" && !(target instanceof URL)) continue;
				if (isWritablePath(target)) continue;
				if (mode === "throw") {
					const error = new Error(escapeMessage(name, target));
					error.name = "SandboxEscape";
					throw Object.assign(error, { code: "EACCES" });
				}
				const message = escapeMessage(name, target);
				reported.push({ operation: name, target: String(target), message });
				console.error(`[write-guard:report] ${message}`);
			}
			return original(...args);
		};
	}
	return guarded;
}

/**
 * THE MODE, module-level and mutable, because `vi.mock` cannot see anything else.
 *
 * Vitest HOISTS every `vi.mock` call to the top of the file that writes it, and its factory
 * therefore cannot close over a local — putting the registration inside `installWriteGuard` and
 * reading its `mode` parameter fails with "mode is not defined" (measured, not guessed). The
 * factory reads this instead, at the moment `node:fs` is first imported, by which time
 * `installWriteGuard` has run.
 *
 * The honest consequence, stated rather than hidden: IMPORTING THIS MODULE INSTALLS THE GUARD.
 * `installWriteGuard()` chooses the mode; it does not decide whether the guard exists. A package
 * that wants no guard must not import this file.
 */
let currentMode = "throw";

/**
 * Choose the mode. See this module's header for `"report"` vs `"throw"`, and the note above for
 * why the registration below is not inside this function.
 *
 * Call it from a package's own setup file — never from `baseConfig`, because the whole point is
 * that Layer 1 is adopted knowingly, one package at a time (ISS-110).
 */
export function installWriteGuard({ mode = "throw" } = {}) {
	if (mode !== "throw" && mode !== "report") {
		throw new Error(`installWriteGuard: unknown mode ${JSON.stringify(mode)} — "throw" or "report"`);
	}
	currentMode = mode;
}

// Hoisted to the top of THIS file by vitest's transform, which is why it is written at module
// scope rather than inside the function above: a setup file that imports this module registers
// the guard before any test file's own imports run.
vi.mock("node:fs", async (importOriginal) => {
	const real = await importOriginal();
	const guarded = guardFsLike(real, currentMode);
	guarded.promises = guardFsLike(real.promises ?? {}, currentMode);
	return { ...guarded, default: guarded };
});
vi.mock("node:fs/promises", async (importOriginal) => {
	const real = await importOriginal();
	const guarded = guardFsLike(real, currentMode);
	return { ...guarded, default: guarded };
});
