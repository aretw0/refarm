#!/usr/bin/env node
/**
 * Print the absolute path `refarm plugin install` writes a plugin's wasm to — so
 * `tractor-start.sh` can LOAD exactly what the installer WROTE, without spelling the
 * install layout a second time.
 *
 * This exists because it did not. The start script used to hardcode
 * `$REFARM_HOME/plugins/@refarm/agent/plugin.wasm` and call a private installer
 * (`scripts/agent-install.mjs`) that wrote there, while the CLI installer wrote
 * `$REFARM_HOME/plugins/refarm_agent/`. Two writers, two directories, and a daemon
 * loading whichever one the shell happened to name: `refarm plugin install` would
 * honestly report "already up-to-date" about a directory nothing loaded.
 *
 * Same shape as scripts/resolve-boot-plugins.mjs: a thin shell↔TS bridge over the
 * COMPILED module, never a re-implementation. The single path function and its tests
 * live in `apps/refarm/src/commands/plugin-install-path.ts`.
 *
 * Prints nothing (exit 0) on any error, and the caller then falls back to the compiled
 * build — a bridge hiccup must never stop a daemon from starting.
 *
 * Usage: node scripts/installed-plugin-path.mjs [<plugin-id>]
 *        (defaults to the runtime agent's id)
 */

import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

async function main() {
	const here = path.dirname(fileURLToPath(import.meta.url));

	// The id itself is identity, not layout: take it from the same declaration the
	// installer's bundled set does, so this script never invents an agent id either.
	const { RUNTIME_AGENT_PLUGIN_ID } = await import(
		pathToFileURL(path.resolve(here, "..", "packages", "config", "src", "plugin-identity.js")).href
	);
	const pluginId = process.argv[2]?.trim() || RUNTIME_AGENT_PLUGIN_ID;

	const distModule = path.resolve(
		here,
		"..",
		"apps",
		"refarm",
		"dist",
		"commands",
		"plugin-install-path.js",
	);
	const { installedPluginWasmPath } = await import(pathToFileURL(distModule).href);

	process.stdout.write(`${installedPluginWasmPath(pluginId)}\n`);
}

main().catch(() => {
	// Silent: the caller treats "no answer" as "fall back to the compiled build".
	process.exit(0);
});
