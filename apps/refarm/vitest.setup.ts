import { beforeEach } from "vitest";
import { resetAllProcessCaches } from "./src/utils/process-cache.js";

// The substrate (@refarm.dev/config) has no default config-dir name — it reads
// SOVEREIGN_DIR (injected by the app at boot; see src/index.ts). Tests exercise
// the app's commands/modules directly, bypassing that entry, so the setup stands in for
// the app and selects ".refarm". Unset would throw MissingSovereignDirError.
if (!process.env.SOVEREIGN_DIR?.trim()) {
	process.env.SOVEREIGN_DIR = ".refarm";
}

// Every process-lifetime cache (makeProcessCache) self-registers, so this single
// hook clears them all before each test — no per-suite reset to remember, and no
// memoized value leaks from one test into the next.
beforeEach(() => {
	resetAllProcessCaches();
});
