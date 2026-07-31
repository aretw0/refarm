import path from "node:path";
import { afterAll, beforeEach, expect, vi } from "vitest";
import { resetAllProcessCaches } from "./src/utils/process-cache.js";

/**
 * SUITE-WIDE SIDE-EFFECT CONTAINMENT.
 *
 * `pnpm --filter @refarm.dev/refarm run test` was measured rewriting the
 * OPERATOR'S REAL `~/.refarm/session.lock` (mtime changed across a run). The root
 * cause: `SESSION_LOCK_PATH` in src/commands/session-lock.ts is a module-level
 * `const` built from `os.homedir()` — evaluated ONCE, at import time — and this
 * setup file previously never redirected `$HOME`, so every test that reached a
 * real (unmocked) session-lock read/write landed on the operator's actual home,
 * regardless of how careful any ONE test file's own fs mocks were. Per-test
 * discipline is what failed; the next test that forgets to mock `fs` fails the
 * same way.
 *
 * This reuses the fs write guard + throwaway HOME pattern from
 * test/architecture/cli-refusal-conformance.test.ts (commit 8c31e8f5) — this is
 * the second consumer of that idea, not a new invention:
 *
 *   Layer 0 (below, hoisted): a throwaway HOME/REFARM_HOME/XDG_* root, set
 *   BEFORE any test file's own top-level imports run — vitest fully evaluates
 *   setupFiles before importing the test file, so this is the one place "before
 *   any module resolves a path" is actually achievable suite-wide.
 *
 *   Layer 1 (below): a write guard over every mutating fs entry point. A write
 *   guard is required IN ADDITION to the env redirect — the redirect fixes
 *   `os.homedir()`-based resolution, but nothing here stops a module that
 *   resolves a path from its own file location (as `findRepoRoot()` does
 *   elsewhere in this repo) from reaching outside the sandbox regardless of
 *   `$HOME`. A write outside the sandbox now throws loudly, naming the path and
 *   the offending fs call, instead of silently landing on disk.
 */
const SANDBOX = await vi.hoisted(async () => {
	const os = await import("node:os");
	const fs = await import("node:fs");
	const nodePath = await import("node:path");

	const tmpRoot = fs.realpathSync(os.tmpdir());
	const root = fs.realpathSync(fs.mkdtempSync(nodePath.join(tmpRoot, "refarm-test-home-")));
	const home = nodePath.join(root, "home");
	fs.mkdirSync(home, { recursive: true });

	const ENV_KEYS = [
		"HOME",
		"USERPROFILE",
		"REFARM_HOME",
		"XDG_CONFIG_HOME",
		"XDG_DATA_HOME",
		"XDG_CACHE_HOME",
		"XDG_STATE_HOME",
	] as const;
	const originalEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
	for (const key of ENV_KEYS) process.env[key] = home;

	// The substrate (@refarm.dev/config) has no default config-dir name — it reads
	// SOVEREIGN_DIR (injected by the app at boot; see src/index.ts). Tests exercise
	// the app's commands/modules directly, bypassing that entry, so this setup file
	// stands in for it. Unset would throw MissingSovereignDirError.
	if (!process.env.SOVEREIGN_DIR?.trim()) {
		process.env.SOVEREIGN_DIR = ".refarm";
	}

	return { root, home, tmpRoot, envKeys: ENV_KEYS, originalEnv };
});

/** Writable only inside the throwaway tree (and the OS temp dir it lives in) —
 *  same policy as the conformance harness. A write anywhere else is a bug in a
 *  test or in the code under test, not something to redirect silently. */
function isWritablePath(target: unknown): boolean {
	if (typeof target !== "string" && !(target instanceof URL) && !Buffer.isBuffer(target)) {
		// A numeric fd — the open()/createWriteStream() that produced it was already
		// gated, so there is no path left to check here.
		return true;
	}
	const value =
		target instanceof URL ? target.pathname : Buffer.isBuffer(target) ? target.toString() : target;
	const resolved = path.resolve(process.cwd(), value);
	return resolved === SANDBOX.tmpRoot || resolved.startsWith(`${SANDBOX.tmpRoot}${path.sep}`);
}

function sandboxEscape(operation: string, target: unknown): Error {
	const testName = expect.getState?.().currentTestName ?? "(unknown test)";
	const error = new Error(
		`test-home-sandbox: fs.${operation} refused outside ${SANDBOX.tmpRoot} ` +
			`(path: ${String(target)}, test: ${testName})`,
	);
	error.name = "SandboxEscape";
	return Object.assign(error, { code: "EACCES" });
}

/**
 * fs entry points that CREATE OR MUTATE something, each guarded in both its
 * callback and `Sync` form. Reads are untouched. Identical list to the
 * conformance harness's `guardedFsNames` — see that file for why each one is
 * here.
 */
function guardedFsNames(): string[] {
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
 * Which argument positions of a guarded fs call are PATHS to check.
 *
 * Most guarded operations (`writeFile`, `mkdir`, `unlink`, `chmod`, `truncate`, …)
 * take exactly one path in position 0 — position 1 is DATA or OPTIONS, never a
 * path, and must not be checked: a string data payload (e.g. JSON content passed
 * to `writeFileSync`) is not a path and checking it against the sandbox root
 * produces a false "escape" on every ordinary write.
 *
 * `rename`/`copyFile`/`cp`/`link` are the real two-path operations (both the
 * source and the destination are paths). `symlink(target, path)` only creates
 * `path` — `target` is an arbitrary string that need not resolve to anything.
 */
function pathArgIndexes(name: string): number[] {
	const base = name.endsWith("Sync") ? name.slice(0, -"Sync".length) : name;
	if (base === "rename" || base === "copyFile" || base === "cp" || base === "link") return [0, 1];
	if (base === "symlink") return [1];
	return [0];
}

/** Wrap every write entry point on an fs-like module object. Returns the same
 *  object shape with guarded functions; anything absent is skipped. */
function guardFsLike<T extends Record<string, unknown>>(source: T): T {
	const guarded: Record<string, unknown> = { ...source };
	for (const name of guardedFsNames()) {
		const original = source[name];
		if (typeof original !== "function") continue;
		guarded[name] = (...args: unknown[]) => {
			for (const index of pathArgIndexes(name)) {
				const target = args[index];
				if (typeof target !== "string" && !(target instanceof URL)) continue;
				if (!isWritablePath(target)) throw sandboxEscape(name, target);
			}
			return (original as (...a: unknown[]) => unknown)(...args);
		};
	}
	return guarded as T;
}

// Layer 1: the write guard, applied to the transformed module graph (this app
// and every workspace package vitest inlines).
vi.mock("node:fs", async (importOriginal) => {
	const real = await importOriginal<typeof import("node:fs")>();
	const guarded = guardFsLike(real as unknown as Record<string, unknown>);
	guarded.promises = guardFsLike((real.promises ?? {}) as unknown as Record<string, unknown>);
	return { ...guarded, default: guarded };
});
vi.mock("node:fs/promises", async (importOriginal) => {
	const real = await importOriginal<typeof import("node:fs/promises")>();
	const guarded = guardFsLike(real as unknown as Record<string, unknown>);
	return { ...guarded, default: guarded };
});

afterAll(() => {
	for (const key of SANDBOX.envKeys) {
		const original = SANDBOX.originalEnv[key];
		if (original === undefined) delete process.env[key];
		else process.env[key] = original;
	}
});

// Every process-lifetime cache (makeProcessCache) self-registers, so this single
// hook clears them all before each test — no per-suite reset to remember, and no
// memoized value leaks from one test into the next.
beforeEach(() => {
	resetAllProcessCaches();
});
