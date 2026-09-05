import { assertValidPluginManifest, type PluginManifest } from "@refarm.dev/plugin-manifest";
import type { RuntimePluginLoaderTarget } from "@refarm.dev/runtime";
import fs from "node:fs";
import path from "node:path";

interface LoggerLike {
	info(...args: unknown[]): void;
	warn(...args: unknown[]): void;
}

function readManifestFromDir(pluginDir: string): PluginManifest {
	const manifestPath = path.join(pluginDir, "plugin.json");
	const raw = fs.readFileSync(manifestPath, "utf-8");
	const parsed = JSON.parse(raw) as PluginManifest;
	assertValidPluginManifest(parsed);
	return parsed;
}

/**
 * Discover installed plugin directories under ~/.refarm/plugins.
 *
 * Supports both layouts:
 *   - plugins/my-plugin/plugin.json
 *   - plugins/@scope/my-plugin/plugin.json
 */
function findPluginDirs(pluginsDir: string): string[] {
	const queue: string[] = [pluginsDir];
	const found: string[] = [];

	while (queue.length > 0) {
		const currentDir = queue.shift();
		if (!currentDir) break;

		const entries = fs.readdirSync(currentDir, { withFileTypes: true });
		for (const entry of entries) {
			if (!entry.isDirectory()) continue;

			const candidateDir = path.join(currentDir, entry.name);
			const manifestPath = path.join(candidateDir, "plugin.json");
			if (fs.existsSync(manifestPath)) {
				found.push(candidateDir);
				continue;
			}

			queue.push(candidateDir);
		}
	}

	return found;
}

export interface InstalledPluginManifest {
	id: string;
	/** The directory holding this plugin.json. */
	dir: string;
	manifest: PluginManifest;
}

/** Every readable plugin.json under ~/.refarm/plugins, with its directory. The manifest is
 *  what GET /plugins needs to answer the CLI's questions (which loaded plugin is the default
 *  responder, which path a request names) — the id alone cannot. */
export function listInstalledPluginManifests(baseDir: string): InstalledPluginManifest[] {
	const pluginsDir = path.join(baseDir, "plugins");
	if (!fs.existsSync(pluginsDir)) return [];

	const entries: InstalledPluginManifest[] = [];
	for (const pluginDir of findPluginDirs(pluginsDir)) {
		try {
			const manifest = readManifestFromDir(pluginDir);
			entries.push({ id: manifest.id, dir: pluginDir, manifest });
		} catch {
			// skip unreadable manifests silently
		}
	}
	return entries;
}

export function listInstalledPluginIds(baseDir: string): string[] {
	return listInstalledPluginManifests(baseDir).map((entry) => entry.id);
}

/** A plugin pointer node's essentials (id → hash + manifest) — the RefarmPluginPointer. */
export interface PluginPointer {
	pluginId: string;
	hash: string;
	/** The plugin.json manifest (entry stripped) that pairs with the content-addressed bytes. */
	manifest: unknown;
}

/** An orphan grant that CAN be loaded by hash: it has a pointer AND the bytes are present. */
export interface OrphanGrantLoadable {
	id: string;
	hash: string;
	manifest: string;
	assetsDir: string;
}

/** An orphan grant that is discoverable but NOT loadable (pointer present, bytes absent).
 * This is the seam for E4's peer transport — the bytes must be fetched from a peer. */
export interface OrphanGrantPending {
	id: string;
	hash: string;
	reason: "bytes-missing" | "pointer-missing";
}

export interface OrphanDiscoveryResult {
	loadable: OrphanGrantLoadable[];
	pending: OrphanGrantPending[];
}

/**
 * Discover plugins this device has a GRANT for (trusted_plugins / approvedPermissions)
 * but NO local install — the orphan-grant case that E3 loads by hash. Pure over injected
 * reads so it is testable without fs / graph: the caller supplies the grant ids, the
 * installed ids, the pointer lookup, the byte-presence check, and the assets dir.
 *
 * For each granted id with no install dir:
 *  - no pointer → pending (pointer-missing): the grant arrived but the id→hash mapping
 *    hasn't replicated yet.
 *  - pointer but no bytes → pending (bytes-missing): the E4 peer-transport seam.
 *  - pointer AND bytes → loadable {id, hash, manifest, assetsDir} — the exact triple the
 *    daemon's --plugin-by-hash / POST /plugins/load-by-hash consumes.
 */
export function discoverOrphanGrants(deps: {
	grantedIds: readonly string[];
	installedIds: readonly string[];
	pointerFor: (id: string) => PluginPointer | null;
	hasBytes: (hash: string) => boolean;
	assetsDir: string;
}): OrphanDiscoveryResult {
	const installed = new Set(deps.installedIds);
	const loadable: OrphanGrantLoadable[] = [];
	const pending: OrphanGrantPending[] = [];

	for (const id of new Set(deps.grantedIds)) {
		if (installed.has(id)) continue; // has a local install → not an orphan

		const pointer = deps.pointerFor(id);
		if (!pointer) {
			pending.push({ id, hash: "", reason: "pointer-missing" });
			continue;
		}
		if (!deps.hasBytes(pointer.hash)) {
			pending.push({ id, hash: pointer.hash, reason: "bytes-missing" });
			continue;
		}
		loadable.push({
			id,
			hash: pointer.hash,
			manifest: JSON.stringify(pointer.manifest),
			assetsDir: deps.assetsDir,
		});
	}

	return { loadable, pending };
}

export async function loadInstalledPlugins(
	tractor: RuntimePluginLoaderTarget,
	baseDir: string,
	options?: { pluginFilter?: string[] },
	logger: LoggerLike = console,
): Promise<{ loaded: number; skipped: number }> {
	const pluginsDir = path.join(baseDir, "plugins");
	if (!fs.existsSync(pluginsDir)) {
		return { loaded: 0, skipped: 0 };
	}

	const pluginDirs = findPluginDirs(pluginsDir);
	let loaded = 0;
	let skipped = 0;

	for (const pluginDir of pluginDirs) {
		try {
			const manifest = readManifestFromDir(pluginDir);
			if (options?.pluginFilter && !options.pluginFilter.includes(manifest.id)) {
				continue;
			}
			await tractor.registry.register(manifest);
			await tractor.registry.trust(manifest.id);
			await tractor.plugins.load(manifest);
			loaded += 1;
			logger.info(`[farmhand] Installed plugin loaded: ${manifest.id} (${manifest.version})`);
		} catch (error: unknown) {
			skipped += 1;
			const message = error instanceof Error ? error.message : String(error);
			const pluginLabel = path.relative(pluginsDir, pluginDir) || pluginDir;
			logger.warn(`[farmhand] Failed to load installed plugin ${pluginLabel}: ${message}`);
		}
	}

	return { loaded, skipped };
}
