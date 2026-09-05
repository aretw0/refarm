// Relative, not a package subpath: this file is config-adjacent (never shipped), and a
// subpath export resolved through vite's alias layer landed on `src/index.js/home-containment`.
import { beforeEach } from "vitest";
import { resetAllProcessCaches } from "./src/utils/process-cache.js";

/**
 * WHAT IS LEFT HERE: the process-cache reset. Both containment layers moved into
 * `@refarm.dev/vtconfig`'s `baseConfig` — Layer 0 (the throwaway HOME) on 2026-08-11 for
 * ISS-109, and Layer 1 (the fs write guard) the same day for ISS-110, once a repo-wide
 * measurement showed it costs nothing.
 *
 * The history below is kept because it is why both exist.
 *
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
 * LAYER 0 MOVED OUT (2026-08-11, ISS-109). The throwaway HOME now lives in
 * `@refarm.dev/vtconfig/home-containment`, wired into `baseConfig.test.setupFiles`, so all 64
 * workspaces get it and no resolvable vitest config can lack it. It lived here alone, and a run
 * launched from the repo root resolved the ROOT config — which loads no package setup file —
 * and deleted `spawnEnv` from the operator's live `~/.refarm/config.json`. This file imports
 * that sandbox rather than creating a second one.
 *
 * WHAT STAYS HERE is Layer 1, the write guard, because it REFUSES rather than redirects: 101
 * test files in this monorepo write through `writeFileSync`/`mkdirSync`, so it is adopted
 * package by package, not switched on for all of them in one move.
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



// Every process-lifetime cache (makeProcessCache) self-registers, so this single
// hook clears them all before each test — no per-suite reset to remember, and no
// memoized value leaks from one test into the next.
beforeEach(() => {
	resetAllProcessCaches();
});
