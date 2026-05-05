import { describe, expect, it, vi } from "vitest";
import {
	detectWasmBinaryKind,
	installWasmArtifact,
} from "./install-contract.js";

function createMemoryCache() {
	const map = new Map();
	const metadataMap = new Map();
	return {
		cache: {
			get: vi.fn(async (pluginId) => map.get(pluginId) ?? null),
			set: vi.fn(async (pluginId, bytes, metadata) => {
				map.set(pluginId, bytes);
				metadataMap.set(pluginId, metadata);
			}),
			evict: vi.fn(async (pluginId) => {
				map.delete(pluginId);
				metadataMap.delete(pluginId);
			}),
		},
		map,
		metadataMap,
	};
}

async function toIntegrity(content) {
	const bytes = new TextEncoder().encode(content);
	const digest = await crypto.subtle.digest("SHA-256", bytes);
	return `sha256-${Buffer.from(new Uint8Array(digest)).toString("base64")}`;
}

describe("installWasmArtifact", () => {
	it("detects wasm binary kind from header", () => {
		const moduleBytes = new Uint8Array([
			0x00,
			0x61,
			0x73,
			0x6d,
			0x01,
			0x00,
			0x00,
			0x00,
		]).buffer;
		const componentBytes = new Uint8Array([
			0x00,
			0x61,
			0x73,
			0x6d,
			0x0a,
			0x00,
			0x01,
			0x00,
		]).buffer;

		expect(detectWasmBinaryKind(moduleBytes)).toBe("module");
		expect(detectWasmBinaryKind(componentBytes)).toBe("component");
		expect(detectWasmBinaryKind(new ArrayBuffer(2))).toBe("unknown");
	});

	it("returns cache hit without fetching when cached artifact matches integrity", async () => {
		const { cache, map, metadataMap } = createMemoryCache();
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
		expect(result.artifactKind).toBe("unknown");
		expect(fetchFn).not.toHaveBeenCalled();
		expect(metadataMap.get("plugin-a")).toBeUndefined();
	});

	it("updates cache metadata on cache hit when metadata extensions are provided", async () => {
		const { cache, map, metadataMap } = createMemoryCache();
		const wasmBytes = new Uint8Array([
			0x00,
			0x61,
			0x73,
			0x6d,
			0x0a,
			0x00,
			0x01,
			0x00,
		]).buffer;
		const digest = await crypto.subtle.digest("SHA-256", wasmBytes);
		const integrity = `sha256-${Buffer.from(new Uint8Array(digest)).toString("base64")}`;
		map.set("plugin-a", wasmBytes);

		await installWasmArtifact(
			{
				pluginId: "plugin-a",
				wasmUrl: "https://example.com/plugin.wasm",
				integrity,
				metadataExtensions: {
					browserRuntimeModule: {
						url: "https://example.com/plugin.browser.mjs",
						integrity: "sha256-module",
						format: "esm",
					},
				},
			},
			{ cache, fetchFn: vi.fn() },
		);

		expect(cache.set).toHaveBeenCalledTimes(1);
		expect(metadataMap.get("plugin-a")).toEqual(
			expect.objectContaining({
				artifactKind: "component",
				browserRuntimeModule: {
					url: "https://example.com/plugin.browser.mjs",
					integrity: "sha256-module",
					format: "esm",
				},
			}),
		);
	});

	it("evicts bad cache and refetches with artifact metadata", async () => {
		const { cache, map, metadataMap } = createMemoryCache();
		map.set("plugin-a", new TextEncoder().encode("tampered").buffer);
		const freshBuffer = new Uint8Array([
			0x00,
			0x61,
			0x73,
			0x6d,
			0x01,
			0x00,
			0x00,
			0x00,
		]).buffer;
		const digest = await crypto.subtle.digest("SHA-256", freshBuffer);
		const integrity = `sha256-${Buffer.from(new Uint8Array(digest)).toString("base64")}`;

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
		expect(result.artifactKind).toBe("module");
		expect(metadataMap.get("plugin-a")).toEqual(
			expect.objectContaining({
				artifactKind: "module",
			}),
		);
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
