import { afterAll, vi } from "vitest";

/**
 * REPO-WIDE HOME CONTAINMENT — wired into `baseConfig.test.setupFiles`, so every project that
 * inherits the shared vitest config gets it and no resolvable config can lack it.
 *
 * WHY THIS IS SHARED AND NOT PER-PACKAGE. It used to live only in
 * `apps/refarm/vitest.setup.ts`, which is exactly one of 64 workspaces with a vitest config.
 * On 2026-08-11 a full run launched from the repo root resolved the ROOT vitest config instead
 * — that config knew nothing about any package's setup file — and the suite ran against the
 * operator's real home. It DELETED `spawnEnv` from the live `~/.refarm/config.json` (the
 * PATH/HOME the Rust host injects into every spawned process), wrote a fixture plugin id into
 * `trusted_plugins`, and dropped files named `escape.txt` and
 * `refarm-guard-fixture-escape.txt` — the second containing the words "this must never land on
 * disk" — into the working tree. Containment that one config can fail to load is not
 * containment; it is a convention (ISS-109).
 *
 * WHAT IT DOES: points every "where is the user's home" answer at a throwaway tree, BEFORE any
 * test file's imports run. Module-level `const`s built from `os.homedir()` are evaluated once,
 * at import time, and `vitest` fully evaluates setupFiles first — this is the one place
 * "before any module resolves a path" is achievable.
 *
 * WHAT IT DELIBERATELY DOES NOT DO: forbid writes. `apps/refarm/vitest.setup.ts` adds that
 * second layer (an fs write guard that throws outside the sandbox) and it stays package-local
 * for now, because it is a REFUSAL rather than a redirect: 101 test files in this monorepo
 * write through `writeFileSync`/`mkdirSync`, and turning a throw on for all 64 workspaces in
 * one move would be rewriting the suite, not containing it. This layer relocates and breaks
 * nothing; that one refuses and must be adopted package by package.
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
	];
	const originalEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
	for (const key of ENV_KEYS) process.env[key] = home;

	// `SOVEREIGN_BASE` is the DECLARED base the whole codebase is being moved onto — see
	// docs/NO_OS_RESOLUTION.md. Pointing it at the sandbox too keeps the TS and Rust resolvers
	// answering the same thing under test, instead of one following the throwaway home and the
	// other whatever the shell exported.
	const originalBase = process.env.SOVEREIGN_BASE;
	process.env.SOVEREIGN_BASE = home;

	// The substrate (@refarm.dev/config) has no default config-dir name — it reads
	// SOVEREIGN_DIR, injected by the app at boot. Tests exercise modules directly, bypassing
	// that entry, so this stands in for it. Unset would throw MissingSovereignDirError.
	const originalDir = process.env.SOVEREIGN_DIR;
	if (!process.env.SOVEREIGN_DIR?.trim()) process.env.SOVEREIGN_DIR = ".refarm";

	return { root, home, tmpRoot, envKeys: ENV_KEYS, originalEnv, originalBase, originalDir };
});

export const testHomeSandbox = SANDBOX;

afterAll(() => {
	for (const key of SANDBOX.envKeys) {
		const original = SANDBOX.originalEnv[key];
		if (original === undefined) delete process.env[key];
		else process.env[key] = original;
	}
	if (SANDBOX.originalBase === undefined) delete process.env.SOVEREIGN_BASE;
	else process.env.SOVEREIGN_BASE = SANDBOX.originalBase;
	if (SANDBOX.originalDir === undefined) delete process.env.SOVEREIGN_DIR;
	else process.env.SOVEREIGN_DIR = SANDBOX.originalDir;
});
