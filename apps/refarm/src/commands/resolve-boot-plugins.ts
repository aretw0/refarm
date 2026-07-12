import fs from "node:fs";
import path from "node:path";

import { readConfig, type RefarmCliConfig } from "./config-shared.js";
import { runtimeTrustId } from "./plugin-trust.js";

/**
 * BOOT PLUGIN RESOLVER — turns "what is installed + trusted" into the `--plugin`
 * list the tractor daemon should load at start. This is the missing orchestrator
 * step (ADR-059: the Rust host stays imperative `--plugin`; the orchestrator owns
 * discovery/translation). Until now `tractor-start.sh` hardcoded only the agent, so
 * an installed+trusted plugin like @refarm/delegate never loaded on a plain reload.
 *
 * The rule is deliberately CONSERVATIVE: load an installed plugin ONLY if its
 * runtime id is in `trusted_plugins` (or the `*` wildcard). This makes the boot list
 * a pure function of the two admission facts the operator already authors —
 * `plugin install` (physical) + `plugin trust` (identity) — and never loads
 * something Strict would reject. The agent is intentionally EXCLUDED here: the start
 * script loads it on its own dist-stale-guarded path, and emitting it twice would
 * double-load it.
 */

/** A discovered installed plugin: its runtime id + the wasm path to load. */
export interface InstalledPlugin {
	/** The runtime id the host matches against `trusted_plugins` (manifest id's last segment). */
	runtimeId: string;
	/** Absolute path to the plugin's wasm artifact. */
	wasmPath: string;
	/** The install directory name (for diagnostics / dedup reporting). */
	dir: string;
}

/** The runtime id the start script loads on its own path — excluded from the scan
 * so it is never double-loaded. */
const AGENT_RUNTIME_ID = "agent";

/** Read one install dir's `plugin.json`, returning its runtime id + wasm path, or
 * null when the dir is not a loadable plugin (no manifest, no wasm, unreadable). PURE
 * apart from the injected fs. */
function readInstalledPlugin(
	pluginsDir: string,
	dir: string,
	io: { readFileSync: typeof fs.readFileSync; existsSync: typeof fs.existsSync },
): InstalledPlugin | null {
	const manifestPath = path.join(pluginsDir, dir, "plugin.json");
	const wasmPath = path.join(pluginsDir, dir, "plugin.wasm");
	if (!io.existsSync(manifestPath) || !io.existsSync(wasmPath)) return null;
	let manifest: { id?: unknown };
	try {
		manifest = JSON.parse(io.readFileSync(manifestPath, "utf-8") as string) as { id?: unknown };
	} catch {
		return null;
	}
	const id = typeof manifest.id === "string" ? manifest.id : "";
	if (!id) return null;
	return { runtimeId: runtimeTrustId(id), wasmPath, dir };
}

/**
 * Resolve the wasm paths to pass as `--plugin` at boot: every installed plugin whose
 * runtime id is trusted, minus the agent (loaded separately). De-duplicated by
 * runtime id (two install dirs can resolve to the same id — e.g. `@refarm/agent` and
 * `refarm_agent`), first path wins, sorted for a stable command line. Returns [] when
 * the plugins dir is absent or nothing is both installed and trusted. PURE apart from
 * the injected fs.
 */
export function resolveBootPluginPaths(
	pluginsDir: string,
	config: RefarmCliConfig,
	io: {
		readFileSync?: typeof fs.readFileSync;
		existsSync?: typeof fs.existsSync;
		readdirSync?: typeof fs.readdirSync;
		statSync?: typeof fs.statSync;
	} = {},
): string[] {
	const readFileSync = io.readFileSync ?? fs.readFileSync;
	const existsSync = io.existsSync ?? fs.existsSync;
	const readdirSync = io.readdirSync ?? fs.readdirSync;
	const statSync = io.statSync ?? fs.statSync;

	if (!existsSync(pluginsDir)) return [];

	const trusted = new Set(config.trusted_plugins ?? []);
	const wildcard = trusted.has("*");
	if (trusted.size === 0) return []; // no allowlist → Strict trusts nothing extra

	// Install dirs can be one level deep (`refarm_delegate/`) or two for scoped names
	// (`@refarm/agent/`). Enumerate both so a scoped install dir is not missed.
	const candidates: string[] = [];
	for (const entry of safeReaddir(readdirSync, pluginsDir)) {
		if (entry.startsWith(".")) continue; // skip .versions and dotfiles
		const full = path.join(pluginsDir, entry);
		if (!isDir(statSync, full)) continue;
		if (existsSync(path.join(full, "plugin.json"))) {
			candidates.push(entry);
		} else {
			// A scope dir (e.g. `@refarm`) holds one level of named plugin dirs.
			for (const sub of safeReaddir(readdirSync, full)) {
				if (existsSync(path.join(full, sub, "plugin.json"))) {
					candidates.push(path.join(entry, sub));
				}
			}
		}
	}

	const seen = new Set<string>();
	const paths: string[] = [];
	for (const dir of candidates) {
		const plugin = readInstalledPlugin(pluginsDir, dir, { readFileSync, existsSync });
		if (!plugin) continue;
		if (plugin.runtimeId === AGENT_RUNTIME_ID) continue; // loaded on its own path
		if (!wildcard && !trusted.has(plugin.runtimeId)) continue; // not trusted → skip
		if (seen.has(plugin.runtimeId)) continue; // dedup by runtime id
		seen.add(plugin.runtimeId);
		paths.push(plugin.wasmPath);
	}
	return paths.sort();
}

/** Read the sovereign config for boot resolution — the same `.refarm/config.json` the
 * host reads at load (under `refarmHome`). Missing file → empty config. */
export function readBootConfig(refarmHome: string): RefarmCliConfig {
	return readConfig(path.join(refarmHome, "config.json"));
}

function safeReaddir(readdirSync: typeof fs.readdirSync, dir: string): string[] {
	try {
		return readdirSync(dir) as unknown as string[];
	} catch {
		return [];
	}
}

function isDir(statSync: typeof fs.statSync, full: string): boolean {
	try {
		return statSync(full).isDirectory();
	} catch {
		return false;
	}
}
