import {
	assertValidPluginManifest,
	type PluginManifest,
} from "@refarm.dev/plugin-manifest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import {
	loadSkillsFromManifest,
	type LoadedSkill,
	type LoadSkillsResult,
} from "./index.js";

/**
 * The Node/fs host side of the surface loader. `index.ts` stays pure (asset I/O
 * injected); this module is the one place that actually touches the filesystem —
 * it enumerates installed plugin directories and supplies the `loadAsset` closure
 * the pure loader needs. Kept out of the main entry (a `/node` subpath, mirroring
 * @refarm.dev/storage-fs) so a browser/edge consumer of the pure loader never
 * pulls `node:fs`.
 *
 * WHY here and not in an app: enumeration + asset reading were duplicated (a
 * private scanner in apps/farmhand, and nothing reusable for apps/refarm, which
 * cannot import farmhand). Home is the surface-loader package both hosts already
 * depend on, so the scan exists ONCE.
 */

/** Read + validate a plugin manifest from `<pluginDir>/plugin.json`. */
export function readPluginManifest(pluginDir: string): PluginManifest {
	const raw = readFileSync(join(pluginDir, "plugin.json"), "utf-8");
	const parsed = JSON.parse(raw) as PluginManifest;
	assertValidPluginManifest(parsed);
	return parsed;
}

/**
 * Discover installed plugin directories under a plugins root. Supports both
 * layouts a host installs into:
 *   - `<pluginsDir>/<id>/plugin.json`
 *   - `<pluginsDir>/@scope/<id>/plugin.json`
 * A missing root yields an empty list (nothing installed yet is not an error).
 */
export function findPluginDirs(pluginsDir: string): string[] {
	if (!existsSync(pluginsDir)) return [];
	const queue: string[] = [pluginsDir];
	const found: string[] = [];
	while (queue.length > 0) {
		const currentDir = queue.shift();
		if (!currentDir) break;
		for (const entry of readdirSync(currentDir, { withFileTypes: true })) {
			if (!entry.isDirectory()) continue;
			const candidateDir = join(currentDir, entry.name);
			if (existsSync(join(candidateDir, "plugin.json"))) {
				found.push(candidateDir);
				continue;
			}
			queue.push(candidateDir);
		}
	}
	return found;
}

/** A skill loaded from disk, tagged with the plugin it came from. */
export interface DiscoveredSkill extends LoadedSkill {
	/** Plugin manifest id the skill's surface belongs to. */
	pluginId: string;
	/** Absolute plugin directory the SKILL.md was read from. */
	pluginDir: string;
}

export interface DiscoverSkillsResult {
	/** Skills that parsed and validated across every installed plugin. */
	skills: DiscoveredSkill[];
	/** Per-plugin load failures (a bad manifest or a rejected skill surface). */
	rejected: {
		pluginId: string | null;
		pluginDir: string;
		issues: string[];
	}[];
}

/**
 * Enumerate installed plugins under `pluginsDir` and load every pi/skill surface
 * each declares, reading its SKILL.md relative to that plugin's directory. This
 * is the fs-backed composition of {@link findPluginDirs} + {@link loadSkillsFromManifest}
 * that a host (the CLI/REPL `skill` verb) calls to answer "what skills exist?".
 * An unreadable manifest is recorded in `rejected`, never thrown — one broken
 * plugin must not hide every other plugin's skills.
 */
export function loadSkillsFromPluginsDir(
	pluginsDir: string,
): DiscoverSkillsResult {
	const skills: DiscoveredSkill[] = [];
	const rejected: DiscoverSkillsResult["rejected"] = [];

	for (const pluginDir of findPluginDirs(pluginsDir)) {
		let manifest: PluginManifest;
		try {
			manifest = readPluginManifest(pluginDir);
		} catch (error) {
			rejected.push({
				pluginId: null,
				pluginDir,
				issues: [
					`could not read plugin manifest: ${error instanceof Error ? error.message : String(error)}`,
				],
			});
			continue;
		}

		const loadAsset = (assetPath: string): string =>
			readFileSync(join(pluginDir, assetPath), "utf-8");
		const result: LoadSkillsResult = loadSkillsFromManifest(
			manifest,
			loadAsset,
		);

		for (const skill of result.loaded) {
			skills.push({ ...skill, pluginId: manifest.id, pluginDir });
		}
		for (const reject of result.rejected) {
			rejected.push({
				pluginId: manifest.id,
				pluginDir,
				issues: reject.issues,
			});
		}
	}

	return { skills, rejected };
}
