#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import process from "node:process";

/**
 * DEPRECATED: This script is now part of @refarm.dev/toolbox.
 * It remains here as a wrapper for backward compatibility.
 */

const mode = process.argv[2] || "status";
const validModes = new Set(["src", "dist", "status", "sync-tsconfig"]);

if (["-h", "--help", "help"].includes(mode)) {
	console.log("Usage: node scripts/reso.mjs <src|dist|status|sync-tsconfig>");
	console.log("Policy: run 'status' at task start and before merge.");
	process.exit(0);
}

if (!validModes.has(mode)) {
	console.error(`Invalid mode: ${mode}`);
	console.error("Usage: node scripts/reso.mjs <src|dist|status|sync-tsconfig>");
	process.exit(1);
}

if (mode === "src" || mode === "dist") {
	console.log(
		"[reso] reminder: execute 'node scripts/reso.mjs status' before merge.",
	);
}

// Try to run via pnpm/npm exec if possible, or direct node call to toolbox
const result = spawnSync("node", ["./packages/toolbox/src/cli.mjs", "reso", mode], {
	stdio: "inherit",
	shell: true,
});

process.exit(result.status);
