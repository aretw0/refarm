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
