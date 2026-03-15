import { describe, it, expect, beforeEach } from "vitest";
import { SovereignRegistry } from "./index.js";
import { KeyManager } from "../../silo/src/key-manager.js";
import { Buffer } from "node:buffer";

describe("SovereignRegistry", () => {
    let registry: SovereignRegistry;

    beforeEach(() => {
        registry = new SovereignRegistry();
    });

    it("should register a plugin manifest", async () => {
        const manifest = {
            id: "io.refarm.test-plugin",
            version: "1.0.0",
            name: "Test Plugin"
        };
        
        const id = await registry.register(manifest);
        expect(id).toBe("io.refarm.test-plugin");
        
        const plugin = registry.getPlugin(id);
        expect(plugin.manifest.name).toBe("Test Plugin");
        expect(plugin.status).toBe("registered");
    });

    it("should list all registered plugins", async () => {
        await registry.register({ id: "p1", version: "1" });
        await registry.register({ id: "p2", version: "1" });
        
        const plugins = registry.listPlugins();
        expect(plugins).toHaveLength(2);
    });

    it("should fail to register a plugin without ID", async () => {
        const manifest = { version: "1.0.0" } as any;
        await expect(registry.register(manifest)).rejects.toThrow("Plugin must have a unique identifier");
    });

    it("should resolve a plugin from a remote URL", async () => {
        const mockManifest = {
            id: "remote-plugin",
            version: "2.0.0",
            name: "Remote Plugin"
        };

        // Mock fetch
        global.fetch = vi.fn().mockResolvedValue({
            ok: true,
            json: async () => mockManifest
        });

        const entry = await registry.resolveRemote("remote-plugin", "https://api.refarm.dev/plugins/remote-plugin");
        
        expect(entry.manifest.id).toBe("remote-plugin");
        expect(entry.sourceUrl).toBe("https://api.refarm.dev/plugins/remote-plugin");
        expect(registry.getPlugin("remote-plugin")).toBeDefined();
    });

    it("should manage plugin lifecycle (activate/deactivate)", async () => {
        const keyManager = new KeyManager();
        const keypair = await keyManager.generateMasterKey();
        const manifest = { id: "lifecycle-plugin", version: "1" } as any;
        
        await registry.register(manifest);
        
        // Validation required before activation
        await expect(registry.activatePlugin("lifecycle-plugin")).rejects.toThrow("must be validated before activation");

        const signature = await keyManager.sign(JSON.stringify(manifest), keypair.privateKey);
        await registry.validatePlugin("lifecycle-plugin", signature, keypair.publicKey);
        
        expect(registry.getPlugin("lifecycle-plugin")?.status).toBe("validated");

        // Activate
        await registry.activatePlugin("lifecycle-plugin");
        expect(registry.getPlugin("lifecycle-plugin")?.status).toBe("active");

        // Deactivate
        await registry.deactivatePlugin("lifecycle-plugin");
        expect(registry.getPlugin("lifecycle-plugin")?.status).toBe("validated");
    });

    it("should validate a plugin signature using Heartwood", async () => {
        const keyManager = new KeyManager();
        const keypair = await keyManager.generateMasterKey();
        
        const manifest = {
            id: "io.refarm.secure-plugin",
            version: "1.0.0"
        } as any;
        
        await registry.register(manifest);
        
        // Sign manifest
        const manifestData = JSON.stringify(manifest);
        const signature = await keyManager.sign(manifestData, keypair.privateKey);
        
        const isValid = await registry.validatePlugin(manifest.id, signature, keypair.publicKey);
        expect(isValid).toBe(true);
        expect(registry.getPlugin(manifest.id)?.status).toBe("validated");
    });
});
