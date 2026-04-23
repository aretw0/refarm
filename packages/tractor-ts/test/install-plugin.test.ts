import { beforeEach, describe, expect, it, vi } from "vitest";
import { installPlugin } from "../src/lib/install-plugin";

// Mock OPFS cache module
vi.mock("../src/lib/opfs-plugin-cache", () => ({
	cachePlugin: vi.fn().mockResolvedValue(undefined),
	cachePluginRuntimeModule: vi.fn().mockResolvedValue(undefined),
	getCachedPlugin: vi.fn().mockResolvedValue(null),
	evictPlugin: vi.fn().mockResolvedValue(undefined),
	getPluginCachePath: vi
		.fn()
		.mockImplementation(
			(pluginId: string) => `/refarm/barn/implements/${pluginId}.wasm`,
		),
	getPluginRuntimeModuleCachePath: vi
		.fn()
		.mockImplementation(
			(pluginId: string) => `/refarm/barn/implements/${pluginId}.mjs`,
		),
}));

import {
	cachePlugin,
	cachePluginRuntimeModule,
	evictPlugin,
	getCachedPlugin,
} from "../src/lib/opfs-plugin-cache";

async function computeSRI(buffer: ArrayBuffer): Promise<string> {
	const hashBuffer = await globalThis.crypto.subtle.digest("SHA-256", buffer);
	const hashBytes = new Uint8Array(hashBuffer);
	let binaryString = "";
	for (const byte of hashBytes) binaryString += String.fromCharCode(byte);
	return `sha256-${btoa(binaryString)}`;
}

async function computeSRIFromText(source: string): Promise<string> {
	const bytes = new TextEncoder().encode(source).buffer;
	return computeSRI(bytes);
}

function stableCanonicalize(value: unknown): unknown {
	if (Array.isArray(value)) {
		return value.map((item) => stableCanonicalize(item));
	}

	if (value && typeof value === "object") {
		return Object.fromEntries(
			Object.entries(value as Record<string, unknown>)
				.sort(([a], [b]) => a.localeCompare(b))
				.map(([key, itemValue]) => [key, stableCanonicalize(itemValue)]),
		);
	}

	return value;
}

async function computeDescriptorIntegrity(
	descriptorWithoutIntegrity: Record<string, unknown>,
): Promise<string> {
	return computeSRIFromText(
		JSON.stringify(stableCanonicalize(descriptorWithoutIntegrity)),
	);
}

describe("installPlugin", () => {
	const mockBuffer = new ArrayBuffer(1024);
	let manifestWithIntegrity: any;

	beforeEach(async () => {
		vi.clearAllMocks();
		(getCachedPlugin as any).mockResolvedValue(null);
		(cachePlugin as any).mockResolvedValue(undefined);

		global.fetch = vi.fn().mockResolvedValue({
			ok: true,
			statusText: "OK",
			arrayBuffer: async () => mockBuffer,
		});

		manifestWithIntegrity = {
			id: "test-plugin",
			name: "Test Plugin",
			version: "0.1.0",
			entry: "https://example.com/test.wasm",
			capabilities: { provides: [], requires: [] },
			permissions: [],
			targets: ["browser"],
			observability: { hooks: [] },
			certification: { license: "MIT", a11yLevel: 0, languages: ["en"] },
			integrity: await computeSRI(mockBuffer),
		};
	});

	it("fetches WASM and caches it when not already cached", async () => {
		const result = await installPlugin(
			manifestWithIntegrity,
			"https://example.com/test.wasm",
		);

		expect(global.fetch).toHaveBeenCalledWith("https://example.com/test.wasm");
		expect(cachePlugin).toHaveBeenCalledWith(
			"test-plugin",
			mockBuffer,
			expect.objectContaining({
				pluginId: "test-plugin",
				wasmUrl: "https://example.com/test.wasm",
				integrity: manifestWithIntegrity.integrity,
			}),
		);
		expect(result.cached).toBe(false);
		expect(result.byteLength).toBe(1024);
		expect(result.artifactKind).toBe("unknown");
		expect(result.cachePath).toContain("/refarm/barn/implements");
	});

	it("returns cached version without fetching when already cached", async () => {
		const cachedBuffer = mockBuffer;
		(getCachedPlugin as any).mockResolvedValue(cachedBuffer);

		const result = await installPlugin(
			manifestWithIntegrity,
			"https://example.com/test.wasm",
		);

		expect(global.fetch).not.toHaveBeenCalled();
		expect(result.cached).toBe(true);
		expect(result.byteLength).toBe(1024);
		expect(result.artifactKind).toBe("unknown");
	});

	it("evicts and re-fetches when cached artifact fails integrity", async () => {
		const tamperedCache = new ArrayBuffer(512);
		(getCachedPlugin as any).mockResolvedValue(tamperedCache);

		const result = await installPlugin(
			manifestWithIntegrity,
			"https://example.com/test.wasm",
		);

		expect(global.fetch).toHaveBeenCalledTimes(1);
		expect(result.cached).toBe(false);
		expect(result.byteLength).toBe(1024);
		expect(evictPlugin).toHaveBeenCalledWith("test-plugin");
	});

	it("bypasses cache when force: true", async () => {
		const cachedBuffer = new ArrayBuffer(512);
		(getCachedPlugin as any).mockResolvedValue(cachedBuffer);

		const result = await installPlugin(
			manifestWithIntegrity,
			"https://example.com/test.wasm",
			{ force: true },
		);

		expect(global.fetch).toHaveBeenCalled();
		expect(result.cached).toBe(false);
	});

	it("installs optional browser runtime module with integrity verification", async () => {
		const runtimeModuleSource =
			"export default { async setup(){}, async ping(){ return 'component-ok'; } }";
		const runtimeModuleIntegrity =
			await computeSRIFromText(runtimeModuleSource);

		(global.fetch as any).mockImplementation(async (url: string) => {
			if (url.endsWith(".mjs")) {
				return {
					ok: true,
					statusText: "OK",
					text: async () => runtimeModuleSource,
				};
			}

			return {
				ok: true,
				statusText: "OK",
				arrayBuffer: async () => mockBuffer,
			};
		});

		const result = await installPlugin(
			manifestWithIntegrity,
			"https://example.com/test.wasm",
			{
				browserRuntimeModule: {
					url: "https://example.com/test.browser.mjs",
					integrity: runtimeModuleIntegrity,
				},
			},
		);

		expect(cachePluginRuntimeModule).toHaveBeenCalledWith(
			"test-plugin",
			runtimeModuleSource,
		);
		expect(cachePlugin).toHaveBeenCalledWith(
			"test-plugin",
			mockBuffer,
			expect.objectContaining({
				browserRuntimeModule: {
					url: "https://example.com/test.browser.mjs",
					integrity: runtimeModuleIntegrity,
					format: "esm",
				},
			}),
		);
		expect(result.runtimeModuleCachePath).toContain("/refarm/barn/implements");
	});

	it("installs component runtime sidecar via descriptor object", async () => {
		const runtimeModuleSource =
			"export default { async setup(){}, async ping(){ return 'component-descriptor'; } }";
		const runtimeModuleIntegrity =
			await computeSRIFromText(runtimeModuleSource);

		(global.fetch as any).mockImplementation(async (url: string) => {
			if (url.endsWith(".mjs")) {
				return {
					ok: true,
					statusText: "OK",
					text: async () => runtimeModuleSource,
				};
			}

			return {
				ok: true,
				statusText: "OK",
				arrayBuffer: async () => mockBuffer,
			};
		});

		await installPlugin(
			manifestWithIntegrity,
			"https://example.com/test.wasm",
			{
				browserRuntimeModuleDescriptor: {
					schemaVersion: 1,
					pluginId: "test-plugin",
					componentWasmUrl: "https://example.com/test.wasm",
					module: {
						url: "https://example.com/test.browser.mjs",
						integrity: runtimeModuleIntegrity,
						format: "esm",
					},
					toolchain: {
						name: "tractor-sidecar",
						version: "0.1.0",
						generatedAt: "2026-04-23T00:00:00.000Z",
					},
					provenance: {
						commitSha: "1111111111111111111111111111111111111111",
						buildId: "build-install-plugin-test",
						sourceRepository: "https://github.com/refarm-dev/refarm",
					},
				},
			},
		);

		expect(cachePlugin).toHaveBeenCalledWith(
			"test-plugin",
			mockBuffer,
			expect.objectContaining({
				browserRuntimeDescriptor: expect.objectContaining({
					schemaVersion: 1,
					source: "descriptor",
				}),
				browserRuntimeToolchain: expect.objectContaining({
					name: "tractor-sidecar",
				}),
				browserRuntimeProvenance: expect.objectContaining({
					source: "descriptor",
					buildId: "build-install-plugin-test",
				}),
			}),
		);
	});

	it("installs component runtime sidecar via descriptor URL under package-embedded policy", async () => {
		const runtimeModuleSource =
			"export default { async setup(){}, async ping(){ return 'component-descriptor-url'; } }";
		const runtimeModuleIntegrity =
			await computeSRIFromText(runtimeModuleSource);

		(global.fetch as any).mockImplementation(async (url: string) => {
			if (url.endsWith(".runtime-descriptor.json")) {
				return {
					ok: true,
					statusText: "OK",
					json: async () => ({
						schemaVersion: 1,
						pluginId: "test-plugin",
						componentWasmUrl: "https://example.com/test.wasm",
						module: {
							url: "https://example.com/test.browser.mjs",
							integrity: runtimeModuleIntegrity,
							format: "esm",
						},
						toolchain: {
							name: "tractor-sidecar",
							version: "0.1.0",
						},
						provenance: {
							commitSha: "1111111111111111111111111111111111111111",
							buildId: "build-url-descriptor",
							sourceRepository: "https://github.com/refarm-dev/refarm",
						},
					}),
				};
			}

			if (url.endsWith(".mjs")) {
				return {
					ok: true,
					statusText: "OK",
					text: async () => runtimeModuleSource,
				};
			}

			return {
				ok: true,
				statusText: "OK",
				arrayBuffer: async () => mockBuffer,
			};
		});

		await installPlugin(
			manifestWithIntegrity,
			"https://example.com/test.wasm",
			{
				browserRuntimeModuleDescriptor: {
					url: "https://example.com/test.runtime-descriptor.json",
				},
			},
		);

		expect(cachePluginRuntimeModule).toHaveBeenCalledWith(
			"test-plugin",
			runtimeModuleSource,
		);
	});

	it("rejects cross-origin descriptor URL for package-embedded policy", async () => {
		await expect(
			installPlugin(manifestWithIntegrity, "https://example.com/test.wasm", {
				browserRuntimeModuleDescriptor: {
					url: "https://cdn.other.test/test.runtime-descriptor.json",
				},
			}),
		).rejects.toThrow(
			"policy package-embedded requires descriptor URL origin to match",
		);
	});

	it("requires provenance.sourceRepository for external-signed descriptor policy", async () => {
		const runtimeModuleSource =
			"export default { async setup(){}, async ping(){ return 'component-external-no-repo'; } }";
		const runtimeModuleIntegrity =
			await computeSRIFromText(runtimeModuleSource);

		(global.fetch as any).mockImplementation(async (url: string) => {
			if (url.includes("external.runtime-descriptor.json")) {
				return {
					ok: true,
					statusText: "OK",
					json: async () => {
						const descriptorWithoutIntegrity = {
							schemaVersion: 1,
							pluginId: "test-plugin",
							componentWasmUrl: "https://example.com/test.wasm",
							module: {
								url: "https://cdn.other.test/test.browser.mjs",
								integrity: runtimeModuleIntegrity,
								format: "esm",
							},
							toolchain: {
								name: "tractor-sidecar",
								version: "0.1.0",
							},
							provenance: {
								commitSha: "1111111111111111111111111111111111111111",
								buildId: "build-external",
							},
						};

						return {
							...descriptorWithoutIntegrity,
							descriptorIntegrity: await computeDescriptorIntegrity(
								descriptorWithoutIntegrity,
							),
						};
					},
				};
			}

			if (url.endsWith(".mjs")) {
				return {
					ok: true,
					statusText: "OK",
					text: async () => runtimeModuleSource,
				};
			}

			return {
				ok: true,
				statusText: "OK",
				arrayBuffer: async () => mockBuffer,
			};
		});

		await expect(
			installPlugin(manifestWithIntegrity, "https://example.com/test.wasm", {
				browserRuntimeModuleDescriptor: {
					url: "https://cdn.other.test/external.runtime-descriptor.json",
				},
				descriptorDistributionPolicy: "external-signed",
				descriptorTrustedOrigins: ["https://cdn.other.test"],
			}),
		).rejects.toThrow("requires provenance.sourceRepository");
	});

	it("allows cross-origin descriptor URL when external-signed policy has trusted origin", async () => {
		const runtimeModuleSource =
			"export default { async setup(){}, async ping(){ return 'component-external-signed'; } }";
		const runtimeModuleIntegrity =
			await computeSRIFromText(runtimeModuleSource);

		(global.fetch as any).mockImplementation(async (url: string) => {
			if (url.includes("external.runtime-descriptor.json")) {
				return {
					ok: true,
					statusText: "OK",
					json: async () => {
						const descriptorWithoutIntegrity = {
							schemaVersion: 1,
							pluginId: "test-plugin",
							componentWasmUrl: "https://example.com/test.wasm",
							module: {
								url: "https://cdn.other.test/test.browser.mjs",
								integrity: runtimeModuleIntegrity,
								format: "esm",
							},
							toolchain: {
								name: "tractor-sidecar",
								version: "0.1.0",
							},
							provenance: {
								commitSha: "1111111111111111111111111111111111111111",
								buildId: "build-external",
								sourceRepository:
									"https://github.com/refarm-dev/refarm",
							},
						};

						return {
							...descriptorWithoutIntegrity,
							descriptorIntegrity: await computeDescriptorIntegrity(
								descriptorWithoutIntegrity,
							),
						};
					},
				};
			}

			if (url.endsWith(".mjs")) {
				return {
					ok: true,
					statusText: "OK",
					text: async () => runtimeModuleSource,
				};
			}

			return {
				ok: true,
				statusText: "OK",
				arrayBuffer: async () => mockBuffer,
			};
		});

		await installPlugin(
			manifestWithIntegrity,
			"https://example.com/test.wasm",
			{
				browserRuntimeModuleDescriptor: {
					url: "https://cdn.other.test/external.runtime-descriptor.json",
				},
				descriptorDistributionPolicy: "external-signed",
				descriptorTrustedOrigins: ["https://cdn.other.test"],
			},
		);

		expect(cachePluginRuntimeModule).toHaveBeenCalledWith(
			"test-plugin",
			runtimeModuleSource,
		);
	});

	it("rejects descriptor plugin mismatch", async () => {
		await expect(
			installPlugin(manifestWithIntegrity, "https://example.com/test.wasm", {
				browserRuntimeModuleDescriptor: {
					schemaVersion: 1,
					pluginId: "wrong-plugin",
					componentWasmUrl: "https://example.com/test.wasm",
					module: {
						url: "https://example.com/test.browser.mjs",
						integrity: "sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
					},
					toolchain: {
						name: "tractor-sidecar",
						version: "0.1.0",
					},
					provenance: {
						commitSha: "1111111111111111111111111111111111111111",
						buildId: "build-mismatch",
					},
				},
			}),
		).rejects.toThrow("descriptor pluginId mismatch");
	});

	it("rejects descriptor without provenance commit/build metadata", async () => {
		await expect(
			installPlugin(manifestWithIntegrity, "https://example.com/test.wasm", {
				browserRuntimeModuleDescriptor: {
					schemaVersion: 1,
					pluginId: "test-plugin",
					componentWasmUrl: "https://example.com/test.wasm",
					module: {
						url: "https://example.com/test.browser.mjs",
						integrity: "sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
					},
					toolchain: {
						name: "tractor-sidecar",
						version: "0.1.0",
					},
					provenance: {
						commitSha: "short-sha",
						buildId: "",
					},
				} as any,
			}),
		).rejects.toThrow("requires provenance buildId + full commitSha");
	});

	it("requires descriptorIntegrity when using external-signed descriptor policy", async () => {
		const runtimeModuleSource =
			"export default { async setup(){}, async ping(){ return 'component-ext-policy'; } }";
		const runtimeModuleIntegrity =
			await computeSRIFromText(runtimeModuleSource);

		(global.fetch as any).mockImplementation(async (url: string) => {
			if (url.endsWith(".mjs")) {
				return {
					ok: true,
					statusText: "OK",
					text: async () => runtimeModuleSource,
				};
			}

			return {
				ok: true,
				statusText: "OK",
				arrayBuffer: async () => mockBuffer,
			};
		});

		await expect(
			installPlugin(manifestWithIntegrity, "https://example.com/test.wasm", {
				browserRuntimeModuleDescriptor: {
					schemaVersion: 1,
					pluginId: "test-plugin",
					componentWasmUrl: "https://example.com/test.wasm",
					module: {
						url: "https://example.com/test.browser.mjs",
						integrity: runtimeModuleIntegrity,
					},
					toolchain: {
						name: "tractor-sidecar",
						version: "0.1.0",
					},
					provenance: {
						commitSha: "1111111111111111111111111111111111111111",
						buildId: "build-ext-object",
						sourceRepository: "https://github.com/refarm-dev/refarm",
					},
				},
				descriptorDistributionPolicy: "external-signed",
			}),
		).rejects.toThrow("requires descriptorIntegrity");
	});

	it("rejects descriptor integrity mismatch", async () => {
		const runtimeModuleSource = "export default { async ping(){return 'x';} }";
		const runtimeModuleIntegrity =
			await computeSRIFromText(runtimeModuleSource);

		(global.fetch as any).mockImplementation(async (url: string) => {
			if (url.endsWith(".mjs")) {
				return {
					ok: true,
					statusText: "OK",
					text: async () => runtimeModuleSource,
				};
			}

			return {
				ok: true,
				statusText: "OK",
				arrayBuffer: async () => mockBuffer,
			};
		});

		await expect(
			installPlugin(manifestWithIntegrity, "https://example.com/test.wasm", {
				browserRuntimeModuleDescriptor: {
					schemaVersion: 1,
					pluginId: "test-plugin",
					componentWasmUrl: "https://example.com/test.wasm",
					module: {
						url: "https://example.com/test.browser.mjs",
						integrity: runtimeModuleIntegrity,
					},
					toolchain: {
						name: "tractor-sidecar",
						version: "0.1.0",
					},
					provenance: {
						commitSha: "1111111111111111111111111111111111111111",
						buildId: "build-integrity-mismatch",
					},
					descriptorIntegrity: "sha256-not-the-real-digest",
				},
			}),
		).rejects.toThrow("descriptor integrity mismatch");
	});

	it("fails when browser runtime module integrity is invalid", async () => {
		const runtimeModuleSource = "export const x = 1";

		(global.fetch as any).mockImplementation(async (url: string) => {
			if (url.endsWith(".mjs")) {
				return {
					ok: true,
					statusText: "OK",
					text: async () => runtimeModuleSource,
				};
			}

			return {
				ok: true,
				statusText: "OK",
				arrayBuffer: async () => mockBuffer,
			};
		});

		await expect(
			installPlugin(manifestWithIntegrity, "https://example.com/test.wasm", {
				browserRuntimeModule: {
					url: "https://example.com/test.browser.mjs",
					integrity: "sha256-invalid",
				},
			}),
		).rejects.toThrow(
			"Integrity digest must be 64-char hex or base64 sha256 value",
		);
		expect(cachePluginRuntimeModule).not.toHaveBeenCalled();
	});

	it("throws when fetch fails", async () => {
		global.fetch = vi.fn().mockResolvedValue({
			ok: false,
			statusText: "Not Found",
		});

		await expect(
			installPlugin(manifestWithIntegrity, "https://example.com/missing.wasm"),
		).rejects.toThrow("[install-contract] Failed to fetch");
	});

	describe("integrity verification", () => {
		it("accepts a WASM that matches manifest.integrity", async () => {
			const result = await installPlugin(
				manifestWithIntegrity,
				"https://example.com/test.wasm",
			);
			expect(result.cached).toBe(false);
			expect(result.byteLength).toBe(1024);
		});

		it("rejects a WASM whose hash does not match manifest.integrity", async () => {
			const tamperedBuffer = new ArrayBuffer(512); // different content
			global.fetch = vi.fn().mockResolvedValue({
				ok: true,
				statusText: "OK",
				arrayBuffer: async () => tamperedBuffer,
			});

			await expect(
				installPlugin(manifestWithIntegrity, "https://example.com/test.wasm"),
			).rejects.toThrow("Integrity check failed");
		});

		it("rejects missing integrity for wasm installation", async () => {
			const manifestWithoutIntegrity = {
				...manifestWithIntegrity,
				integrity: undefined,
			};

			await expect(
				installPlugin(
					manifestWithoutIntegrity,
					"https://example.com/test.wasm",
				),
			).rejects.toThrow("Missing integrity");
		});

		it("rejects an unsupported integrity algorithm", async () => {
			const manifestWithBadAlgo = {
				...manifestWithIntegrity,
				integrity: "md5-abc123",
			};

			await expect(
				installPlugin(manifestWithBadAlgo, "https://example.com/test.wasm"),
			).rejects.toThrow("Integrity must use sha256-");
		});

		it("accepts hex sha256 digest", async () => {
			const hashBuffer = await globalThis.crypto.subtle.digest(
				"SHA-256",
				mockBuffer,
			);
			const hex = Array.from(new Uint8Array(hashBuffer))
				.map((byte) => byte.toString(16).padStart(2, "0"))
				.join("");

			const manifestWithHexIntegrity = {
				...manifestWithIntegrity,
				integrity: `sha256-${hex}`,
			};

			const result = await installPlugin(
				manifestWithHexIntegrity,
				"https://example.com/test.wasm",
			);
			expect(result.cached).toBe(false);
		});
	});
});
