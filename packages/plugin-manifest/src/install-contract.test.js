import { describe, expect, it, vi } from "vitest";
import { installWasmArtifact } from "./install-contract.js";

function createMemoryCache() {
	const map = new Map();
	return {
		cache: {
			get: vi.fn(async (pluginId) => map.get(pluginId) ?? null),
			set: vi.fn(async (pluginId, bytes) => {
				map.set(pluginId, bytes);
			}),
			evict: vi.fn(async (pluginId) => {
				map.delete(pluginId);
			}),
		},
		map,
	};
}

async function toIntegrity(content) {
	const bytes = new TextEncoder().encode(content);
	const digest = await crypto.subtle.digest("SHA-256", bytes);
	return `sha256-${Buffer.from(new Uint8Array(digest)).toString("base64")}`;
}

describe("installWasmArtifact", () => {
	it("returns cache hit without fetching when cached artifact matches integrity", async () => {
		const { cache, map } = createMemoryCache();
		const buffer = new TextEncoder().encode("hello").buffer;
		const integrity = await toIntegrity("hello");
		map.set("plugin-a", buffer);

		const fetchFn = vi.fn();
		const result = await installWasmArtifact(
			{
				pluginId: "plugin-a",
				wasmUrl: "https://example.com/plugin.wasm",
				integrity,
			},
			{ cache, fetchFn },
		);

		expect(result.cached).toBe(true);
		expect(fetchFn).not.toHaveBeenCalled();
	});

	it("evicts bad cache and refetches", async () => {
		const { cache, map } = createMemoryCache();
		map.set("plugin-a", new TextEncoder().encode("tampered").buffer);
		const integrity = await toIntegrity("fresh");
		const freshBuffer = new TextEncoder().encode("fresh").buffer;

		const fetchFn = vi.fn().mockResolvedValue({
			ok: true,
			statusText: "OK",
			arrayBuffer: async () => freshBuffer,
		});

		const result = await installWasmArtifact(
			{
				pluginId: "plugin-a",
				wasmUrl: "https://example.com/plugin.wasm",
				integrity,
			},
			{ cache, fetchFn },
		);

		expect(cache.evict).toHaveBeenCalledWith("plugin-a");
		expect(fetchFn).toHaveBeenCalledTimes(1);
		expect(result.cached).toBe(false);
	});

	it("fails fast on malformed integrity", async () => {
		const { cache } = createMemoryCache();
		const fetchFn = vi.fn();

		await expect(
			installWasmArtifact(
				{
					pluginId: "plugin-a",
					wasmUrl: "https://example.com/plugin.wasm",
					integrity: "sha256-not-valid",
				},
				{ cache, fetchFn },
			),
		).rejects.toThrow(
			"Integrity digest must be 64-char hex or base64 sha256 value",
		);
		expect(fetchFn).not.toHaveBeenCalled();
	});
});
