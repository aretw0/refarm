import { assertValidPluginManifest, type PluginManifest } from "@refarm.dev/plugin-manifest";
import { parseSkillMarkdown } from "@refarm.dev/skill-contract-v1";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";

import {
	loadCheckersFromManifest,
	loadProfilesFromManifest,
	loadSkillsFromManifest,
	loadThemesFromManifest,
	ThemeRegistry,
	translateAgentSkill,
	type LoadedProfile,
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
export function loadSkillsFromPluginsDir(pluginsDir: string): DiscoverSkillsResult {
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
		const result: LoadSkillsResult = loadSkillsFromManifest(manifest, loadAsset);

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

/** A checker component located on disk, ready for the host to load + sandbox. */
export interface DiscoveredCheckerComponent {
	pluginId: string;
	surfaceId: string;
	/** Absolute directory holding the transpiled component (its jco pkg dir). */
	pkgDir: string;
	/** The entry `.js` glue file name inside `pkgDir`. */
	entry: string;
}

export interface DiscoverCheckersResult {
	checkers: DiscoveredCheckerComponent[];
	rejected: {
		pluginId: string | null;
		pluginDir: string;
		issues: string[];
	}[];
}

/**
 * Enumerate installed plugins under `pluginsDir` and locate every
 * quality-checker surface each declares, resolving its component entry asset to
 * an absolute `{pkgDir, entry}` the host loader consumes. Like the skill scan,
 * this only LOCATES the component; loading + sandboxing (deny-all) is the host's
 * job, so a checker plugin cannot run anything just by being discovered.
 */
export function loadCheckersFromPluginsDir(pluginsDir: string): DiscoverCheckersResult {
	const checkers: DiscoveredCheckerComponent[] = [];
	const rejected: DiscoverCheckersResult["rejected"] = [];

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

		const result = loadCheckersFromManifest(manifest);
		for (const checker of result.loaded) {
			const entryPath = join(pluginDir, checker.entryAsset);
			checkers.push({
				pluginId: manifest.id,
				surfaceId: checker.surfaceId,
				pkgDir: dirname(entryPath),
				entry: basename(entryPath),
			});
		}
		for (const reject of result.rejected) {
			rejected.push({
				pluginId: manifest.id,
				pluginDir,
				issues: reject.issues,
			});
		}
	}

	return { checkers, rejected };
}

/** An Agent Skill imported into refarm's model, tagged with where it came from. */
export interface ImportedAgentSkill extends LoadedSkill {
	/** The skill directory it was read from. */
	skillDir: string;
	/** True if the translator injected a name / normalized newlines. */
	translated: { nameInjected: boolean; newlinesNormalized: boolean };
}

export interface ImportAgentSkillsResult {
	skills: ImportedAgentSkill[];
	rejected: { skillDir: string; issues: string[] }[];
}

/** Discover `SKILL.md` files under a skills root (a dir with `<name>/SKILL.md`
 * children, or SKILL.md nested deeper). Mirrors the Agent Skills discovery rule. */
function findSkillMarkdownDirs(root: string): string[] {
	if (!existsSync(root)) return [];
	const found: string[] = [];
	const queue: string[] = [root];
	while (queue.length > 0) {
		const dir = queue.shift();
		if (!dir) break;
		if (existsSync(join(dir, "SKILL.md"))) {
			found.push(dir);
			continue; // a skill dir owns its subtree; don't descend into it
		}
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			if (entry.isDirectory()) queue.push(join(dir, entry.name));
		}
	}
	return found;
}

/**
 * Import **Agent Skills** (the portable agentskills.io format — produced by pi,
 * Claude, and any spec-conformant agent) under `skillsRoot` into refarm's skill
 * model. Each `SKILL.md` is translated (newline-normalized, name injected from
 * its dir when absent) and parsed by `parseSkillMarkdown` — the SAME contract
 * refarm's own skills use. This is the convergence FRONT-half proven on real
 * corpus: an external skill becomes a refarm LoadedSkill
 * (name/description/instructions) with no new contract and no §8 surface touched.
 * It reaches the agent as instructions (data flowing through the
 * consumer-agnostic loader), NOT as a linked component — so it passes the
 * plugin-extends-plugin recursion without the (unbuilt) live link. A malformed
 * skill is rejected, never thrown.
 */
export function loadAgentSkillsFromDir(skillsRoot: string): ImportAgentSkillsResult {
	const skills: ImportedAgentSkill[] = [];
	const rejected: { skillDir: string; issues: string[] }[] = [];

	for (const skillDir of findSkillMarkdownDirs(skillsRoot)) {
		let raw: string;
		try {
			raw = readFileSync(join(skillDir, "SKILL.md"), "utf-8");
		} catch (error) {
			rejected.push({
				skillDir,
				issues: [
					`could not read SKILL.md: ${error instanceof Error ? error.message : String(error)}`,
				],
			});
			continue;
		}

		const translation = translateAgentSkill(raw, basename(skillDir));
		const parsed = parseSkillMarkdown(translation.source);
		if (!parsed.ok || !parsed.manifest) {
			rejected.push({
				skillDir,
				issues: parsed.issues.map((i) => `${i.code}: ${i.message}`),
			});
			continue;
		}
		const m = parsed.manifest;
		skills.push({
			surfaceId: basename(skillDir),
			id: m.id,
			name: m.name,
			...(m.description ? { description: m.description } : {}),
			requiredCapabilities: m.capabilities.requires,
			instructions: m.instructions,
			source: m.source,
			skillDir,
			translated: {
				nameInjected: translation.nameInjected,
				newlinesNormalized: translation.newlinesNormalized,
			},
		});
	}

	return { skills, rejected };
}

/** A theme pack discovered from an installed plugin, tagged with its origin. */
export interface DiscoveredTheme {
	/** The registered theme id (as declared by the plugin's asset surface). */
	id: string;
	/** Plugin manifest id the theme surface belongs to. */
	pluginId: string;
	/** Absolute plugin directory the theme asset was read from. */
	pluginDir: string;
}

export interface DiscoverThemesResult {
	/** Themes that resolved + registered across every installed plugin. */
	themes: DiscoveredTheme[];
	/** The registry the themes registered into (resolvable by id for a projector). */
	registry: ThemeRegistry;
	/** Per-plugin/per-theme load failures (bad manifest, missing tokens). */
	rejected: {
		pluginId: string | null;
		pluginDir: string;
		id?: string;
		issues: string[];
	}[];
}

/**
 * Enumerate installed plugins under `pluginsDir` and register every asset-layer
 * theme-pack surface each declares — the fs-backed composition of
 * {@link findPluginDirs} + {@link loadThemesFromManifest}, the theme twin of
 * {@link loadSkillsFromPluginsDir}. A host (the `theme` verb) calls this to answer
 * "what themes exist?" and to get a populated {@link ThemeRegistry} a renderer can
 * resolve by id. A theme is inert token DATA (no behavior), so this is a safe
 * plugin-contribution front: a broken/non-conformant pack is recorded in
 * `rejected`, never thrown, so one bad plugin cannot hide the others' themes.
 */
export function loadThemesFromPluginsDir(
	pluginsDir: string,
	registry: ThemeRegistry = new ThemeRegistry(),
): DiscoverThemesResult {
	const themes: DiscoveredTheme[] = [];
	const rejected: DiscoverThemesResult["rejected"] = [];

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

		const loadAsset = (assetPath: string): unknown =>
			JSON.parse(readFileSync(join(pluginDir, assetPath), "utf-8"));
		const result = loadThemesFromManifest(manifest, loadAsset, registry);

		for (const id of result.registered) {
			themes.push({ id, pluginId: manifest.id, pluginDir });
		}
		for (const reject of result.rejected) {
			rejected.push({
				pluginId: manifest.id,
				pluginDir,
				id: reject.id,
				issues:
					reject.missing.length > 0
						? [`theme "${reject.id}" is missing tokens: ${reject.missing.join(", ")}`]
						: [`theme "${reject.id}" was rejected`],
			});
		}
	}

	return { themes, registry, rejected };
}

/** A quality profile discovered from an installed plugin, tagged with origin. */
export interface DiscoveredProfile extends LoadedProfile {
	/** Plugin manifest id the profile surface belongs to. */
	pluginId: string;
	/** Absolute plugin directory the profile asset was read from. */
	pluginDir: string;
}

export interface DiscoverProfilesResult {
	/** Profiles that loaded + validated across every installed plugin. */
	profiles: DiscoveredProfile[];
	/** Per-plugin/per-profile load failures (bad manifest, malformed ruleset). */
	rejected: {
		pluginId: string | null;
		pluginDir: string;
		issues: string[];
	}[];
}

/**
 * Enumerate installed plugins under `pluginsDir` and load every quality-profile
 * surface each declares — the fs-backed composition of {@link findPluginDirs} +
 * {@link loadProfilesFromManifest}, the profile twin of
 * {@link loadThemesFromPluginsDir}. A host (the `skill check` verb) calls this to
 * feed plugin-contributed rulesets to its sandboxed checkers alongside the
 * built-in profile. A profile is inert rules-as-data (no behavior), so this is a
 * safe plugin-contribution front; a malformed profile is recorded in `rejected`,
 * never thrown.
 */
export function loadProfilesFromPluginsDir(pluginsDir: string): DiscoverProfilesResult {
	const profiles: DiscoveredProfile[] = [];
	const rejected: DiscoverProfilesResult["rejected"] = [];

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

		const loadAsset = (assetPath: string): unknown =>
			JSON.parse(readFileSync(join(pluginDir, assetPath), "utf-8"));
		const result = loadProfilesFromManifest(manifest, loadAsset);

		for (const profile of result.loaded) {
			profiles.push({ ...profile, pluginId: manifest.id, pluginDir });
		}
		for (const reject of result.rejected) {
			rejected.push({
				pluginId: manifest.id,
				pluginDir,
				issues: reject.issues,
			});
		}
	}

	return { profiles, rejected };
}
