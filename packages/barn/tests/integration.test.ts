import { beforeEach, describe, expect, it, vi } from "vitest";
import { Barn } from "../src/index";

describe("Barn (O Celeiro) - Integration Tests", () => {
  let barn: Barn;

  beforeEach(() => {
    barn = new Barn();
    // Mock fetch for integration tests
    global.fetch = vi.fn();
  });

  it("should allow installing a new plugin with valid metadata", async () => {
    const url = "http://localhost:8080/my-plugin.wasm";
    const integrity = "sha256-abc123xyz";
    
    // Mock successful fetch
    (global.fetch as any).mockResolvedValue({
        ok: true,
        arrayBuffer: async () => new TextEncoder().encode("good content").buffer
    });

    const plugin = await barn.installPlugin(url, integrity);

    expect(plugin).toBeDefined();
    expect(plugin.status).toBe("installed");
    expect(plugin.id).toContain("urn:refarm:plugin:");
  });

  it("should fail installation if SHA-256 integrity check fails", async () => {
    const url = "http://localhost:8080/bad-plugin.wasm";
    const integrity = "sha256-correct-hash";
    
    // Mock successful fetch but with different content
    (global.fetch as any).mockResolvedValue({
        ok: true,
        arrayBuffer: async () => new TextEncoder().encode("bad content").buffer
    });

    await expect(barn.installPlugin(url, integrity))
        .rejects.toThrow("Integrity verification failed");
  });

  it("should list installed plugins in the inventory", async () => {
    const url = "http://localhost:8080/my-plugin.wasm";
    const integrity = "sha256-abc123xyz";
    
    (global.fetch as any).mockResolvedValue({
        ok: true,
        arrayBuffer: async () => new TextEncoder().encode("good content").buffer
    });

    await barn.installPlugin(url, integrity);
    const plugins = await barn.listPlugins();

    expect(plugins.length).toBeGreaterThan(0);
    expect(plugins[0].url).toBe(url);
  });

  it("should uninstall a plugin and cleanup resources", async () => {
    const url = "http://localhost:8080/temp-plugin.wasm";
    const integrity = "sha256-temp";
    
    (global.fetch as any).mockResolvedValue({
        ok: true,
        arrayBuffer: async () => new TextEncoder().encode("temp").buffer
    });

    const plugin = await barn.installPlugin(url, integrity);
    await barn.uninstallPlugin(plugin.id);
    
    const plugins = await barn.listPlugins();
    expect(plugins.find(p => p.id === plugin.id)).toBeUndefined();
  });
});
