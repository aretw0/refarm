#!/usr/bin/env node
/**
 * The `agent-watch` bin — render a run's `agent:*` events as a live table on the real terminal. Default:
 * REPLAY what's already recorded. `--follow`: TAIL the file live as a run writes it. The refarm dir
 * holding `scarecrow-audit.ndjson` is `DGK_REFARM_DIR`, else `./.dgk`. Ctrl-C restores the screen.
 */
import { runAgentWatch } from "./agent-watch.js";

const refarmDir = process.env.DGK_REFARM_DIR ?? ".dgk";
const follow = process.argv.slice(2).includes("--follow");
void runAgentWatch(refarmDir, { follow }).catch((error: unknown) => {
	process.stderr.write(`agent-watch failed: ${error instanceof Error ? error.message : String(error)}\n`);
	process.exitCode = 1;
});
