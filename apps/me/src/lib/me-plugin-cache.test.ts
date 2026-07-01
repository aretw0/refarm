import { describe, expect, it, vi } from "vitest";
import {
	proveRefarmMePluginCache,
	type RefarmMePluginCacheProofInput,
} from "./me-plugin-cache";

vi.mock("@refarm.dev/tractor/browser", () => ({
	evictPlugin: vi.fn(),
	getCachedPlugin: vi.fn(async () => new ArrayBuffer(8)),
	installPlugin: vi.fn(async () => ({
		pluginId: "@refarm.me/cache-proof",
		wasmUrl: "https://example.test/plugin.wasm",
		cached: true,
		byteLength: 8,
		wasmHash: "sha256-proof",
		artifactKind: "module",
		cachePath: "/refarm/barn/implements/_refarm_me_cache-proof.wasm",
	})),
}));

describe("refarm.me plugin cache proof", () => {
	it("reports a persisted Tractor browser cache hit", async () => {
		const input: RefarmMePluginCacheProofInput = {
			manifest: {
				id: "@refarm.me/cache-proof",
				name: "Cache Proof",
				version: "0.1.0",
				entry: "https://example.test/plugin.wasm",
				capabilities: { provides: [], requires: [] },
				permissions: [],
				targets: ["browser"],
				observability: { hooks: [] },
				certification: { license: "MIT", a11yLevel: 0, languages: ["en"] },
				integrity: "sha256-proof",
			},
			wasmUrl: "https://example.test/plugin.wasm",
		};

		await expect(proveRefarmMePluginCache(input)).resolves.toMatchObject({
			pluginId: "@refarm.me/cache-proof",
			cached: true,
			byteLength: 8,
			cachedByteLength: 8,
			persisted: true,
			cachePath: "/refarm/barn/implements/_refarm_me_cache-proof.wasm",
		});
	});
});
