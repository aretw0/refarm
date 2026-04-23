import { beforeEach, describe, expect, it, vi } from "vitest";
import { Barn } from "../src/index";

async function sha256IntegrityFor(content: string): Promise<string> {
	const bytes = new TextEncoder().encode(content);
	const digest = await crypto.subtle.digest("SHA-256", bytes);
	return `sha256-${Buffer.from(new Uint8Array(digest)).toString("base64")}`;
}

describe("Barn (O Celeiro) - Integration Tests", () => {
	let barn: Barn;

	beforeEach(() => {
		barn = new Barn();
		global.fetch = vi.fn();
	});

	it("should allow installing a new plugin with valid metadata", async () => {
		const url = "http://localhost:8080/my-plugin.wasm";
		const integrity = await sha256IntegrityFor("good content");

		(global.fetch as any).mockResolvedValue({
			ok: true,
			statusText: "OK",
			arrayBuffer: async () => new TextEncoder().encode("good content").buffer,
		});

		const plugin = await barn.installPlugin(url, integrity);

		expect(plugin).toBeDefined();
		expect(plugin.status).toBe("installed");
		expect(plugin.id).toContain("urn:refarm:plugin:");
		expect(plugin.cacheStatus).toBe("miss");
		expect(plugin.wasmHash).toBe(integrity);
	});

	it("should fail installation if SHA-256 integrity check fails", async () => {
		const url = "http://localhost:8080/bad-plugin.wasm";
		const integrity = await sha256IntegrityFor("expected content");

		(global.fetch as any).mockResolvedValue({
			ok: true,
			statusText: "OK",
			arrayBuffer: async () => new TextEncoder().encode("bad content").buffer,
		});

		await expect(barn.installPlugin(url, integrity)).rejects.toThrow(
			"Integrity verification failed",
		);
	});

	it("should reject malformed integrity digests before fetch", async () => {
		const url = "http://localhost:8080/bad-integrity.wasm";

		await expect(
			barn.installPlugin(url, "sha256-not-a-real-digest"),
		).rejects.toThrow(
			"Integrity digest must be 64-char hex or base64 sha256 value",
		);
		expect(global.fetch).not.toHaveBeenCalled();
	});

	it("should list installed plugins in the inventory", async () => {
		const url = "http://localhost:8080/my-plugin.wasm";
		const integrity = await sha256IntegrityFor("good content");

		(global.fetch as any).mockResolvedValue({
			ok: true,
			statusText: "OK",
			arrayBuffer: async () => new TextEncoder().encode("good content").buffer,
		});

		await barn.installPlugin(url, integrity);
		const plugins = await barn.listPlugins();

		expect(plugins.length).toBeGreaterThan(0);
		expect(plugins[0].url).toBe(url);
	});

	it("should uninstall a plugin and cleanup resources", async () => {
		const url = "http://localhost:8080/temp-plugin.wasm";
		const integrity = await sha256IntegrityFor("temp");

		(global.fetch as any).mockResolvedValue({
			ok: true,
			statusText: "OK",
			arrayBuffer: async () => new TextEncoder().encode("temp").buffer,
		});

		const plugin = await barn.installPlugin(url, integrity);
		await barn.uninstallPlugin(plugin.id);

		const plugins = await barn.listPlugins();
		expect(plugins.find((p) => p.id === plugin.id)).toBeUndefined();
	});

	it("should use cache hit and avoid re-fetch for same url + integrity", async () => {
		const url = "http://localhost:8080/cached-plugin.wasm";
		const integrity = await sha256IntegrityFor("cached content");

		(global.fetch as any).mockResolvedValue({
			ok: true,
			statusText: "OK",
			arrayBuffer: async () =>
				new TextEncoder().encode("cached content").buffer,
		});

		const first = await barn.installPlugin(url, integrity);
		const second = await barn.installPlugin(url, integrity);

		expect(first.cacheStatus).toBe("miss");
		expect(second.cacheStatus).toBe("hit");
		expect(global.fetch).toHaveBeenCalledTimes(1);
	});

	it("should reject cached artifact when requested integrity differs", async () => {
		const url = "http://localhost:8080/cached-plugin.wasm";
		const installedIntegrity = await sha256IntegrityFor("cached content");
		const mismatchedIntegrity = await sha256IntegrityFor("other content");

		(global.fetch as any).mockResolvedValue({
			ok: true,
			statusText: "OK",
			arrayBuffer: async () =>
				new TextEncoder().encode("cached content").buffer,
		});

		await barn.installPlugin(url, installedIntegrity);

		await expect(barn.installPlugin(url, mismatchedIntegrity)).rejects.toThrow(
			"Integrity verification failed (cached artifact mismatch)",
		);
		expect(global.fetch).toHaveBeenCalledTimes(1);
	});
});
