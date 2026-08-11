import { type PluginPackageSource } from "@refarm.dev/barn";
import {
	surfaceablePluginVerbsFrom,
	type SurfaceablePluginVerb,
} from "@refarm.dev/capability-host";
import { BUNDLED_PLUGIN_DESCRIPTORS, pluginIdToFsToken } from "@refarm.dev/config/plugin-identity";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pluginsBaseDir } from "../utils/refarm-home.js";
import type { ModelRateCatalogMaterialization } from "./model-rate-catalog.js";
import { RUNTIME_AGENT_RELOAD_JSON_COMMAND } from "./plugin-handoffs.js";

// Plugins bundled with the refarm npm package — auto-installed and updated by farmhand on
// boot. The agnostic BUNDLED_PLUGIN_DESCRIPTORS carries the set; this app-level alias is
// where the "refarm" brand attaches (the generic config package stays product-neutral).
export const BUNDLED_PLUGINS = BUNDLED_PLUGIN_DESCRIPTORS;
export type BundledPlugin = (typeof BUNDLED_PLUGIN_DESCRIPTORS)[number];
export const PLUGIN_RELOAD_RUNTIME_AGENT_JSON_COMMAND = RUNTIME_AGENT_RELOAD_JSON_COMMAND;

/**
 * Where a plugin comes from — its provenance (ADR-086). One vocabulary the CLI
 * reports and `plugin list --origin` filters on. `local` (authored under
 * .refarm/extensions/), `installed` (materialized), `bundled` (shipped with
 * refarm), and the resolver origins `npm` / `git` / `url` (admitted by the vocab,
 * matched by nothing until the resolver wires them — the list never over-claims
 * coverage). This is the app-owned surface that the §8 runtime notions
 * (`PluginPackageSource` in barn, install-plugin provenance in tractor-ts)
 * converge onto later.
 */
export type PluginOrigin = "local" | "installed" | "bundled" | "npm" | "git" | "url";

/**
 * Classify an install reference by its SHAPE (ADR-086) — the operator says
 * *install this*, the reference says *from where*. A git URL is checked before
 * the generic URL/npm cases (`git+…`, or a host+`.git`); an `@scope/pkg` or bare
 * package name is npm; an `http(s)://…` is a direct descriptor URL; everything
 * else is treated as a local path (the reviewed-directory case, which
 * `existsSync` ultimately validates). Only `local` is materializable today; the
 * rest are recognized so `plugin install` can route them to a loud
 * "resolver-not-wired" instead of guessing.
 */
export function detectPluginOrigin(ref: string): PluginOrigin {
	const value = ref.trim();
	if (
		value.startsWith("git+") ||
		value.startsWith("git@") ||
		/^(https?|ssh):\/\/.*\.git($|#|\?)/i.test(value) ||
		value.endsWith(".git")
	) {
		return "git";
	}
	if (/^https?:\/\//i.test(value)) return "url";
	// A leading `.`, `/`, or `~` is unambiguously a filesystem path → local.
	if (value.startsWith(".") || value.startsWith("/") || value.startsWith("~")) {
		return "local";
	}
	// npm: an `@scope/name` (the one `/` is the scope separator, NOT a path), or a
	// bare package name with no path separator at all (e.g. `left-pad`).
	if (/^@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*$/i.test(value)) return "npm";
	if (!value.includes("/") && /^[a-z0-9][a-z0-9._-]*$/i.test(value)) return "npm";
	// Anything else (a bare relative path like `prepared/plugin`, a Windows path)
	// is treated as local — existsSync ultimately validates it.
	return "local";
}

export interface PluginListEntry {
	id: string;
	version: string | null;
	/** The plugin's origin (ADR-086); was frozen at "bundled" before the origin axis. */
	source: PluginOrigin;
	packageSource: PluginPackageSource;
	packageDir: string | null;
	installed: boolean;
	/** Set for `local` plugins (authored under .refarm/extensions/): where + which scope. */
	scope?: "project" | "global";
	dir?: string;
}

export interface PluginListReport {
	plugins: PluginListEntry[];
	ok?: true;
	nextAction?: string | null;
	nextActions?: string[];
	nextCommand?: string | null;
	nextCommands?: string[];
}

export interface RuntimePluginStatusEntry {
	id: string;
	installed: boolean;
	loaded: boolean;
	local: boolean;
}

export interface RuntimePluginStatusReport {
	command: "plugin";
	operation: "status";
	ok: boolean;
	available: boolean;
	plugins: RuntimePluginStatusEntry[];
	nextAction: string | null;
	nextActions: string[];
	nextCommand: string | null;
	nextCommands: string[];
	recommendations?: RuntimePluginRecommendation[];
	recovery?: {
		ensure: string;
		start: string;
		status: string;
		doctorNextAction: string;
		doctor: string;
	};
}

export interface RuntimePluginRecommendation {
	diagnostic: string;
	severity: "failure" | "warning" | "info";
	summary: string;
	action: string;
	command?: string;
}

export type PluginInstallStatus = "installed" | "cached" | "failed";

export interface PluginInstallResult {
	id: string;
	packageName: string;
	status: PluginInstallStatus;
	version: string | null;
	packageSource: PluginPackageSource;
	packageDir?: string;
	/**
	 * WHERE this plugin was installed — the directory the daemon will load it from.
	 *
	 * Added 2026-08-05 because its absence made a whole class of confusion undiagnosable. Two
	 * installers were writing the agent to two directories and the daemon loaded only one, so
	 * `refarm plugin install` truthfully answered `already up-to-date` about ITS directory while
	 * a stale plugin kept being loaded from the other. The operator, and the assistant helping
	 * him, mis-diagnosed that three times in a row from the symptom.
	 *
	 * One installer owns the path now, so the ambiguity is gone — but a report that says WHERE
	 * turns "it says up-to-date and it is not" from an investigation into a glance, and the next
	 * layout question will not be the last.
	 *
	 * Present on every outcome including `cached`: a cached result is exactly the case where
	 * knowing which directory was consulted matters most.
	 */
	installedPath?: string;
	message?: string;
	buildCommand?: string;
	bytes?: number;
	integrity?: string;
}

export interface PluginInstallReport {
	failed: number;
	plugins: PluginInstallResult[];
	/**
	 * The runtime's rate catalog rides the same pass (see ./model-rate-catalog.ts). It is
	 * NOT a plugin and never fails the install, but it IS part of what this pass put — or
	 * declined to put — in the sovereign dir, so it belongs in the report a human reads,
	 * not only in the JSON a tool parses.
	 */
	modelRateCatalog?: ModelRateCatalogMaterialization;
	ok?: boolean;
	error?: string;
	nextAction?: string | null;
	nextActions?: string[];
	nextCommand?: string | null;
	nextCommands?: string[];
}

// The filesystem-safe plugin-id projection lives with the rest of plugin
// identity in @refarm.dev/config (neutral, shared by the CLI, the Barn, and any
// storage backend) — never reimplemented per consumer. Re-exported so the
// existing plugin-* command imports keep one import site, and used by
// sentinelPath below.
export { pluginIdToFsToken };

// WHERE an installed plugin lives is one function, in one module (./plugin-install-path.ts)
// — see its header for why. `pluginsBaseDir` used to be defined twice (here, and in
// ../utils/refarm-home.ts) with a subtly different answer for a relative REFARM_HOME; both
// import sites now resolve to the single sovereign-directories definition.
export {
	INSTALLED_PLUGIN_WASM_FILENAME,
	installedPluginDir,
	installedPluginWasmPath,
	legacyScopedPluginWasmPath,
} from "./plugin-install-path.js";
export { pluginsBaseDir };

export function readPackageVersion(pkgDir: string): string | null {
	try {
		const pkgJson = JSON.parse(readFileSync(path.join(pkgDir, "package.json"), "utf-8")) as {
			version?: string;
		};
		return pkgJson.version ?? null;
	} catch {
		return null;
	}
}

export function sentinelPath(pluginId: string): string {
	return path.join(pluginsBaseDir(), ".versions", pluginIdToFsToken(pluginId));
}

export async function readInstalledVersion(pluginId: string): Promise<string | null> {
	try {
		return (await readFile(sentinelPath(pluginId), "utf-8")).trim();
	} catch {
		return null;
	}
}

/** The essentials the surface adapter needs from an installed plugin manifest. */
export interface InstalledPluginManifest {
	id: string;
	capabilities?: { provides?: string[]; subscribes?: string[] };
}

interface LocalExtensionManifest {
	id: string;
	capabilities?: { provides?: string[]; subscribes?: string[] };
}

/**
 * Read every installed plugin's `plugin.json` under the plugins dir (both
 * `plugins/<id>/` and `plugins/@scope/<id>/` layouts). Synchronous + best-effort:
 * an unreadable/invalid manifest is skipped, and a missing plugins dir yields []. Used
 * at import by the capability registry to surface plugin-contributed verbs (slice b).
 */
export function readInstalledPluginManifests(): InstalledPluginManifest[] {
	const pluginsDir = pluginsBaseDir();
	if (!existsSync(pluginsDir)) return [];

	const out: InstalledPluginManifest[] = [];
	const queue = [pluginsDir];
	while (queue.length > 0) {
		const dir = queue.shift();
		if (!dir) break;
		let entries;
		try {
			entries = readdirSync(dir, { withFileTypes: true });
		} catch {
			continue;
		}
		for (const entry of entries) {
			if (!entry.isDirectory() || entry.name === ".versions") continue;
			const candidate = path.join(dir, entry.name);
			const manifestPath = path.join(candidate, "plugin.json");
			if (existsSync(manifestPath)) {
				try {
					out.push(JSON.parse(readFileSync(manifestPath, "utf-8")) as InstalledPluginManifest);
				} catch {
					// skip an unreadable/invalid manifest
				}
			} else {
				queue.push(candidate); // descend into @scope/
			}
		}
	}
	return out;
}

function readLocalExtensionManifest(extDir: string): InstalledPluginManifest | null {
	const manifestPath = path.join(extDir, "ext.json");
	if (!existsSync(manifestPath)) return null;
	try {
		const manifest = JSON.parse(readFileSync(manifestPath, "utf-8")) as LocalExtensionManifest;
		if (!manifest.id) return null;
		return {
			id: manifest.id,
			capabilities: {
				provides: manifest.capabilities?.provides ?? [],
				subscribes: manifest.capabilities?.subscribes ?? [],
			},
		};
	} catch {
		return null;
	}
}

function readLocalExtensionBase(baseDir: string): InstalledPluginManifest[] {
	const extensionsDir = path.join(baseDir, ".refarm", "extensions");
	if (!existsSync(extensionsDir)) return [];
	let entries;
	try {
		entries = readdirSync(extensionsDir, { withFileTypes: true });
	} catch {
		return [];
	}
	const manifests: InstalledPluginManifest[] = [];
	for (const entry of entries) {
		if (!entry.isDirectory()) continue;
		const manifest = readLocalExtensionManifest(path.join(extensionsDir, entry.name));
		if (manifest) manifests.push(manifest);
	}
	return manifests;
}

export function readLocalExtensionManifests(
	// os-resolution: project — the project-local .refarm/extensions tier, which is anchored where the operator stands
	cwd = process.cwd(),
	// os-resolution: node — the operator extensions dir, which plugin-local.ts resolves via resolveRefarmHome for the SAME path
	homeDir = os.homedir(),
): InstalledPluginManifest[] {
	return [...readLocalExtensionBase(cwd), ...readLocalExtensionBase(homeDir)];
}

export function readSurfaceablePluginManifests(): InstalledPluginManifest[] {
	return [...readInstalledPluginManifests(), ...readLocalExtensionManifests()];
}

export function readSurfaceablePluginVerbs(
	// os-resolution: project — the project-local .refarm/extensions tier, which is anchored where the operator stands
	cwd = process.cwd(),
	// os-resolution: node — the operator extensions dir, which plugin-local.ts resolves via resolveRefarmHome for the SAME path
	homeDir = os.homedir(),
	installedManifests = readInstalledPluginManifests(),
): SurfaceablePluginVerb[] {
	return [...installedManifests, ...readLocalExtensionManifests(cwd, homeDir)].flatMap((manifest) =>
		surfaceablePluginVerbsFrom(manifest),
	);
}
