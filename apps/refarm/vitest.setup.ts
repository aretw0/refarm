import { beforeEach } from "vitest";
import { resetAllProcessCaches } from "./src/utils/process-cache.js";

// Every process-lifetime cache (makeProcessCache) self-registers, so this single
// hook clears them all before each test — no per-suite reset to remember, and no
// memoized value leaks from one test into the next.
beforeEach(() => {
	resetAllProcessCaches();
});
