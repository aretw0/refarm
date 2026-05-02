import fs from "node:fs";
import path from "node:path";
import {
	assertValidPluginManifest,
	type PluginManifest,
} from "@refarm.dev/plugin-manifest";

interface PluginLoaderTarget {
	registry: {
		register(manifest: PluginManifest): Promise<void>;
		trust(pluginId: string): Promise<void>;
	};
	plugins: {
		load(manifest: PluginManifest): Promise<void>;
	};
}

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

export async function loadInstalledPlugins(
	tractor: PluginLoaderTarget,
	baseDir: string,
	logger: LoggerLike = console,
): Promise<{ loaded: number; skipped: number }> {
	const pluginsDir = path.join(baseDir, "plugins");
	if (!fs.existsSync(pluginsDir)) {
		return { loaded: 0, skipped: 0 };
	}

	const entries = fs.readdirSync(pluginsDir, { withFileTypes: true });
	let loaded = 0;
	let skipped = 0;

	for (const entry of entries) {
		if (!entry.isDirectory()) continue;
		const pluginDir = path.join(pluginsDir, entry.name);
		const manifestPath = path.join(pluginDir, "plugin.json");
		if (!fs.existsSync(manifestPath)) {
			logger.warn(
				`[farmhand] Skipping installed plugin ${entry.name}: missing plugin.json`,
			);
			skipped += 1;
			continue;
		}

		try {
			const manifest = readManifestFromDir(pluginDir);
			await tractor.registry.register(manifest);
			await tractor.registry.trust(manifest.id);
			await tractor.plugins.load(manifest);
			loaded += 1;
			logger.info(
				`[farmhand] Installed plugin loaded: ${manifest.id} (${manifest.version})`,
			);
		} catch (error: unknown) {
			skipped += 1;
			const message = error instanceof Error ? error.message : String(error);
			logger.warn(
				`[farmhand] Failed to load installed plugin ${entry.name}: ${message}`,
			);
		}
	}

	return { loaded, skipped };
}
