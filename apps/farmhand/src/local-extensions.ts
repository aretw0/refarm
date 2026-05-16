import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { PluginManifest } from "@refarm.dev/plugin-manifest";

interface ExtJson {
  id: string;
  name: string;
  version: string;
  capabilities?: {
    provides?: string[];
    requires?: string[];
    providesApi?: string[];
    requiresApi?: string[];
  };
}

interface PluginLoaderTarget {
  registry: {
    register(manifest: PluginManifest): Promise<string>;
    trust(pluginId: string): Promise<void>;
  };
  plugins: {
    load(manifest: PluginManifest): Promise<unknown>;
  };
}

interface LoggerLike {
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
}

function scanExtensionDirs(baseDir: string): string[] {
  const extensionsDir = path.join(baseDir, ".refarm", "extensions");
  if (!fs.existsSync(extensionsDir)) return [];

  const entries = fs.readdirSync(extensionsDir, { withFileTypes: true });
  return entries
    .filter((e) => e.isDirectory())
    .map((e) => path.join(extensionsDir, e.name));
}

function readExtJson(extDir: string): ExtJson | null {
  try {
    const raw = fs.readFileSync(path.join(extDir, "ext.json"), "utf-8");
    const parsed = JSON.parse(raw) as ExtJson;
    if (!parsed.id || !parsed.name || !parsed.version) return null;
    return parsed;
  } catch {
    return null;
  }
}

function buildManifest(ext: ExtJson, extDir: string): PluginManifest {
  const entryPath = path.join(extDir, "index.js");
  return {
    id: ext.id,
    name: ext.name,
    version: ext.version,
    entry: pathToFileURL(entryPath).href,
    integrity: "",
    capabilities: {
      provides: ext.capabilities?.provides ?? [],
      requires: ext.capabilities?.requires ?? [],
      providesApi: ext.capabilities?.providesApi ?? [],
      requiresApi: ext.capabilities?.requiresApi ?? [],
    },
    permissions: [],
    targets: ["server"],
    observability: {
      hooks: [],
    },
    certification: {
      license: "UNLICENSED",
      a11yLevel: 0,
      languages: ["en"],
    },
  } as unknown as PluginManifest;
}

export class LocalExtensionRegistry {
  private loadedIds: string[] = [];

  constructor(
    private cwd: string,
    private homeDir: string,
    private logger: LoggerLike = console,
  ) {}

  getLoadedIds(): string[] {
    return [...this.loadedIds];
  }

  private collectExtDirs(): string[] {
    return [
      ...scanExtensionDirs(this.cwd),
      ...scanExtensionDirs(this.homeDir),
    ];
  }

  async load(tractor: PluginLoaderTarget): Promise<{ loaded: number; skipped: number }> {
    const extDirs = this.collectExtDirs();
    let loaded = 0;
    let skipped = 0;

    for (const extDir of extDirs) {
      const ext = readExtJson(extDir);
      if (!ext) {
        skipped++;
        this.logger.warn(`[farmhand] local-ext: skipping ${extDir} (invalid ext.json)`);
        continue;
      }

      const entryPath = path.join(extDir, "index.js");
      if (!fs.existsSync(entryPath)) {
        skipped++;
        this.logger.warn(`[farmhand] local-ext: skipping ${ext.id} (index.js not found)`);
        continue;
      }

      try {
        const manifest = buildManifest(ext, extDir);
        await tractor.registry.register(manifest);
        await tractor.registry.trust(ext.id);
        await tractor.plugins.load(manifest);
        this.loadedIds = [...new Set([...this.loadedIds, ext.id])];
        loaded++;
        this.logger.info(`[farmhand] local-ext: loaded ${ext.id} (${extDir})`);
      } catch (err) {
        skipped++;
        this.logger.warn(
          `[farmhand] local-ext: failed to load ${ext.id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    return { loaded, skipped };
  }

  async reload(tractor: PluginLoaderTarget, pluginId: string): Promise<void> {
    const extDirs = this.collectExtDirs();

    for (const extDir of extDirs) {
      const ext = readExtJson(extDir);
      if (!ext || ext.id !== pluginId) continue;

      const entryPath = path.join(extDir, "index.js");
      if (!fs.existsSync(entryPath)) {
        throw new Error(`[local-ext] index.js not found for ${pluginId}`);
      }

      const manifest = buildManifest(ext, extDir);
      await tractor.registry.register(manifest);
      await tractor.registry.trust(ext.id);
      await tractor.plugins.load(manifest);
      return;
    }

    throw new Error(`[local-ext] Extension directory not found for ${pluginId}`);
  }
}
