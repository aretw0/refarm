import * as heartwood from "@refarm.dev/heartwood";
import { PluginManifest } from "@refarm.dev/plugin-manifest";

export interface RegistryEntry {
    manifest: PluginManifest;
    status: "registered" | "validated" | "active" | "error";
    timestamp: string;
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
    async register(manifest: PluginManifest): Promise<string> {
        if (!manifest.id) {
            throw new Error("Plugin must have a unique identifier (id)");
        }
        
        this.plugins.set(manifest.id, {
            manifest,
            status: "registered",
            timestamp: new Date().toISOString()
        });
        
        return manifest.id;
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
}
