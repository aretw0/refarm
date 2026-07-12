#!/usr/bin/env node
/**
 * Print the wasm paths the tractor daemon should load at boot — one per line — so
 * `tractor-start.sh` can turn them into `--plugin <path>` args. The boot list is
 * every INSTALLED plugin whose runtime id is in `trusted_plugins` (or `*`), minus
 * the agent (the start script loads it on its own dist-stale-guarded path).
 *
 * This is the thin shell↔TS bridge for the boot-plugin resolver: the real logic +
 * tests live in `apps/refarm/src/commands/resolve-boot-plugins.ts`. Importing the
 * compiled module (not re-implementing) keeps the JSON parsing + trust/dedup rules
 * in ONE place. Prints nothing (exit 0) on any error, so a resolver hiccup never
 * blocks the daemon from starting with just the agent.
 *
 * Usage: node scripts/resolve-boot-plugins.mjs <REFARM_HOME>
 */

import path from "node:path";
import { pathToFileURL } from "node:url";

async function main() {
	const refarmHome = process.argv[2];
	if (!refarmHome) return; // no home → nothing to resolve

	const here = path.dirname(new URL(import.meta.url).pathname);
	const distModule = path.resolve(
		here,
		"..",
		"apps",
		"refarm",
		"dist",
		"commands",
		"resolve-boot-plugins.js",
	);

	const { resolveBootPluginPaths, readBootConfig } = await import(
		pathToFileURL(distModule).href
	);

	const config = readBootConfig(refarmHome);
	const paths = resolveBootPluginPaths(path.join(refarmHome, "plugins"), config);
	for (const p of paths) process.stdout.write(`${p}\n`);
}

main().catch(() => {
	// Silent: a resolver failure must not stop the daemon from booting with the agent.
	process.exit(0);
});
