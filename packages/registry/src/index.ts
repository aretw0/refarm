import * as heartwood from "@refarm.dev/heartwood";
import { PluginManifest } from "@refarm.dev/plugin-manifest";

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

    constructor(config: Record<string, any> = {}) {
        this.plugins = new Map();
        this.config = config;
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
    }

    /**
     * Deactivates an active plugin.
     */
    async deactivatePlugin(id: string): Promise<void> {
        const plugin = this.getPlugin(id);
        if (!plugin) throw new Error(`Plugin ${id} not found`);
        
        plugin.status = "validated"; // Return to validated state
        plugin.timestamp = new Date().toISOString();
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
