import { pluginIdToFsToken } from "@refarm.dev/config/plugin-identity";
import path from "node:path";
import { pluginsBaseDir } from "../utils/refarm-home.js";

/**
 * WHERE AN INSTALLED PLUGIN LIVES — the single function every writer AND every
 * reader derives the answer from.
 *
 * This module exists because the answer used to be spelled in two places. The CLI
 * installer wrote `<home>/plugins/<pluginIdToFsToken(id)>/` (`refarm_agent/`), while
 * `scripts/agent-install.mjs` — a second, private installer invoked by
 * `scripts/tractor-start.sh` — wrote the scoped npm-shaped `<home>/plugins/@refarm/agent/`,
 * and the start script hardcoded THAT path as the one the daemon loads. The two never
 * had to agree, so they stopped agreeing: `refarm plugin install` answered "already
 * up-to-date" (truthfully, about its own directory) while the daemon kept loading a
 * stale wasm from the other one, and the recovery handoff printed on failure
 * (`refarm plugin install --json`) wrote where nothing loaded.
 *
 * The cure is structural, not documentary: there is now exactly one installer (the
 * CLI's) and exactly one path function (this one). `scripts/installed-plugin-path.mjs`
 * is a thin bridge that lets the shell start script ask THIS function where to load
 * from, instead of spelling a layout of its own.
 *
 * The token projection itself (`@refarm/agent` → `refarm_agent`) belongs to
 * `@refarm.dev/config/plugin-identity`, which also owns the safety argument for it: a
 * raw `@scope/name` fed to `path.join` nests, and a hostile id can escape the base dir.
 */

/** The canonical filename of an installed plugin's wasm entry, for every consumer. */
export const INSTALLED_PLUGIN_WASM_FILENAME = "plugin.wasm";

/** The directory `plugin install` writes a plugin to, and every reader reads it from. */
export function installedPluginDir(pluginId: string): string {
	return path.join(pluginsBaseDir(), pluginIdToFsToken(pluginId));
}

/** The wasm artifact inside {@link installedPluginDir} — what the daemon loads. */
export function installedPluginWasmPath(pluginId: string): string {
	return path.join(installedPluginDir(pluginId), INSTALLED_PLUGIN_WASM_FILENAME);
}

/**
 * The install layout this repo used before the convergence, written by the now-deleted
 * `scripts/agent-install.mjs`: the npm-shaped scoped directory. Declared here, beside
 * the canonical projection, so the one place that still needs to KNOW about it — the
 * start script's read-only fallback for a node installed before the convergence — has a
 * name for it instead of a magic string. Nothing writes this layout anymore.
 */
export function legacyScopedPluginWasmPath(pluginId: string): string {
	return path.join(pluginsBaseDir(), pluginId, INSTALLED_PLUGIN_WASM_FILENAME);
}
