#!/usr/bin/env node
/**
 * The `agent-watch` bin — replay a recorded run's `agent:*` events as a live table on the real terminal.
 * The refarm dir holding `scarecrow-audit.ndjson` is `DGK_REFARM_DIR`, else `./.dgk`. Ctrl-C restores the
 * screen. See docs/manual-test-plan.md (item 5) for the live-tail follow-up.
 */
import { runAgentWatch } from "./agent-watch.js";

const refarmDir = process.env.DGK_REFARM_DIR ?? ".dgk";
void runAgentWatch(refarmDir).catch((error: unknown) => {
	process.stderr.write(`agent-watch failed: ${error instanceof Error ? error.message : String(error)}\n`);
	process.exitCode = 1;
});
