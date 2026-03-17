import * as heartwood from "@refarm.dev/heartwood";
import { PluginManifest } from "@refarm.dev/plugin-manifest";

export interface RegistryPersistenceOptions {
  /** Absolute path to the JSON file used to persist registry state. */
  path: string;
}

export interface RegistryEntry {
    manifest: PluginManifest;
    status: "registered" | "validated" | "active" | "error";
    timestamp: string;
    sourceUrl?: string; // Origin URL for remote plugins
    error?: string;
}

/**
 * SovereignRegistry: Manages plugin discovery, validation, and activation.
 * Hardened via Heartwood (WASM).
 */
export class SovereignRegistry {
    private plugins: Map<string, RegistryEntry>;
    private config: Record<string, any>;
    private _persistPath?: string;

    constructor(config: Record<string, any> = {}, persistence?: RegistryPersistenceOptions) {
        this.plugins = new Map();
        this.config = config;
        this._persistPath = persistence?.path;
    }

    /**
     * Factory: creates a registry and loads persisted state from `persistencePath`.
     * Falls back to an empty registry if the file doesn't exist yet.
     */
    static async createWithPersistence(persistencePath: string): Promise<SovereignRegistry> {
        const registry = new SovereignRegistry({}, { path: persistencePath });
        await registry._loadState();
        return registry;
    }

    private async _saveState(): Promise<void> {
        if (!this._persistPath) return;
        const { writeFile, mkdir } = await import("node:fs/promises");
        const { dirname } = await import("node:path");
        await mkdir(dirname(this._persistPath), { recursive: true });
        await writeFile(this._persistPath, JSON.stringify(this.exportState(), null, 2), "utf-8");
    }

    private async _loadState(): Promise<void> {
        if (!this._persistPath) return;
        const { readFile } = await import("node:fs/promises");
        try {
            const raw = await readFile(this._persistPath, "utf-8");
            const entries: RegistryEntry[] = JSON.parse(raw);
            this.importState(entries);
        } catch (e: any) {
            if (e?.code !== "ENOENT") {
                console.warn(`[registry] Could not load persisted state from ${this._persistPath}:`, e.message);
            }
            // ENOENT → first boot, start empty
        }
    }

    /**
     * Trust a registered plugin without cryptographic validation.
     * Use in daemon/CLI contexts where the plugin source is already verified
     * by other means (e.g. local file system, pinned WASM hash).
     */
    async trust(id: string): Promise<void> {
        const plugin = this.plugins.get(id);
        if (!plugin) throw new Error(`[registry] Plugin ${id} not found`);
        plugin.status = "validated";
        await this._saveState();
    }

    /**
     * Registers a new plugin by its manifest.
     */
    async register(manifest: PluginManifest, sourceUrl?: string): Promise<string> {
        if (!manifest.id) {
            throw new Error("Plugin must have a unique identifier (id)");
        }
        
        this.plugins.set(manifest.id, {
            manifest,
            status: "registered",
            timestamp: new Date().toISOString(),
            sourceUrl
        });
        await this._saveState();
        return manifest.id;
    }

    /**
     * Resolves a plugin from a remote source.
     * In Phase 6, this supports HTTP/JSON resolution.
     */
    async resolveRemote(id: string, sourceUrl: string): Promise<RegistryEntry> {
        try {
            const response = await fetch(sourceUrl);
            if (!response.ok) {
                throw new Error(`Failed to fetch manifest from ${sourceUrl}: ${response.statusText}`);
            }
            
            const manifest = await response.json() as PluginManifest;
            if (manifest.id !== id) {
                throw new Error(`Manifest ID mismatch: expected ${id}, got ${manifest.id}`);
            }

            await this.register(manifest, sourceUrl);
            const entry = this.getPlugin(id);
            if (!entry) throw new Error("Failed to retrieve registered plugin");
            
            return entry;
        } catch (e: any) {
            throw new Error(`Remote resolution failed for ${id}: ${e.message}`);
        }
    }

    /**
     * Resolves a plugin by its ID.
     */
    getPlugin(id: string): RegistryEntry | undefined {
        return this.plugins.get(id);
    }

    /**
     * Lists all registered plugins.
     */
    listPlugins(): RegistryEntry[] {
        return Array.from(this.plugins.values());
    }

    /**
     * Validates a plugin against Refarm security policies using Heartwood.
     */
    async validatePlugin(id: string, signatureHex: string, publicKeyHex: string): Promise<boolean> {
        const plugin = this.getPlugin(id);
        if (!plugin) throw new Error(`Plugin ${id} not found`);

        try {
            const signature = Uint8Array.from(Buffer.from(signatureHex, "hex"));
            const publicKey = Uint8Array.from(Buffer.from(publicKeyHex, "hex"));
            const manifestData = new TextEncoder().encode(JSON.stringify(plugin.manifest));

            const isValid = heartwood.verify(manifestData, signature, publicKey);
            
            if (isValid) {
                plugin.status = "validated";
                return true;
            } else {
                plugin.status = "error";
                plugin.error = "Invalid cryptographic signature";
                return false;
            }
        } catch (e: any) {
            plugin.status = "error";
            plugin.error = e.message;
            throw e;
        }
    }

    /**
     * Activates a validated plugin.
     */
    async activatePlugin(id: string): Promise<void> {
        const plugin = this.getPlugin(id);
        if (!plugin) throw new Error(`Plugin ${id} not found`);
        if (plugin.status !== "validated") {
            throw new Error(`Plugin ${id} must be validated before activation (current status: ${plugin.status})`);
        }
        
        plugin.status = "active";
        plugin.timestamp = new Date().toISOString();
        await this._saveState();
    }

    /**
     * Deactivates an active plugin.
     */
    async deactivatePlugin(id: string): Promise<void> {
        const plugin = this.getPlugin(id);
        if (!plugin) throw new Error(`Plugin ${id} not found`);
        
        plugin.status = "validated"; // Return to validated state
        plugin.timestamp = new Date().toISOString();
        await this._saveState();
    }

    /**
     * Exports the current registry state as a JSON-serializable array.
     */
    exportState(): RegistryEntry[] {
        return Array.from(this.plugins.values());
    }

    /**
     * Imports a registry state from a stored array.
     */
    importState(entries: RegistryEntry[]): void {
        for (const entry of entries) {
            this.plugins.set(entry.manifest.id, entry);
        }
    }
}
