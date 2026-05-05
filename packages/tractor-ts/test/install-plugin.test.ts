import { beforeEach, describe, expect, it, vi } from "vitest";
import { installPlugin } from "../src/lib/install-plugin";
import { clearRuntimeDescriptorRevocationListCache } from "../src/lib/runtime-descriptor-revocation";

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
		clearRuntimeDescriptorRevocationListCache();
		delete (globalThis as any)
			.__REFARM_RUNTIME_DESCRIPTOR_REVOCATION_UNAVAILABLE_POLICY__;
		delete (globalThis as any).__REFARM_RUNTIME_DESCRIPTOR_REVOCATION_PROFILE__;
		delete (globalThis as any).__REFARM_ENVIRONMENT__;
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
			if (url.includes("runtime-descriptor-revocations.json")) {
				return {
					ok: true,
					statusText: "OK",
					json: async () => ({
						schemaVersion: 1,
						revokedDescriptorHashes: [],
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
			if (url.includes("runtime-descriptor-revocations.json")) {
				return {
					ok: true,
					statusText: "OK",
					json: async () => ({
						schemaVersion: 1,
						revokedDescriptorHashes: [],
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
						sourceRepository: "https://github.com/aretw0/refarm",
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
							sourceRepository: "https://github.com/aretw0/refarm",
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

	it("auto-resolves descriptor URL from GitHub release assets when source repository is provided", async () => {
		const runtimeModuleSource =
			"export default { async setup(){}, async ping(){ return 'component-auto-resolve'; } }";
		const runtimeModuleIntegrity =
			await computeSRIFromText(runtimeModuleSource);

		(global.fetch as any).mockImplementation(async (url: string) => {
			if (
				url ===
				"https://github.com/aretw0/refarm/releases/download/test-plugin%400.1.0/runtime-descriptor-manifest.json"
			) {
				const descriptorWithoutIntegrity = {
					schemaVersion: 1,
					pluginId: "test-plugin",
					componentWasmUrl: "https://example.com/test.wasm",
					module: {
						url: "https://objects.githubusercontent.com/test.browser.mjs",
						integrity: runtimeModuleIntegrity,
						format: "esm",
					},
					toolchain: {
						name: "tractor-sidecar",
						version: "0.1.0",
					},
					provenance: {
						commitSha: "1111111111111111111111111111111111111111",
						buildId: "build-auto-resolve",
						sourceRepository: "https://github.com/aretw0/refarm",
					},
				};

				const descriptor = {
					...descriptorWithoutIntegrity,
					descriptorIntegrity: await computeDescriptorIntegrity(
						descriptorWithoutIntegrity,
					),
				};

				return {
					ok: true,
					statusText: "OK",
					json: async () => ({
						schemaVersion: 1,
						descriptors: [
							{
								pluginId: "test-plugin",
								componentWasmUrl: "https://example.com/test.wasm",
								descriptor,
							},
						],
					}),
				};
			}

			if (
				url ===
				"https://github.com/aretw0/refarm/releases/download/test-plugin%400.1.0/runtime-descriptor-revocations.json"
			) {
				return {
					ok: true,
					statusText: "OK",
					json: async () => ({
						schemaVersion: 1,
						revokedDescriptorHashes: [],
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
				descriptorDistributionPolicy: "external-signed",
				descriptorSourceRepository: "https://github.com/aretw0/refarm",
			},
		);

		expect(global.fetch).toHaveBeenCalledWith(
			"https://github.com/aretw0/refarm/releases/download/test-plugin%400.1.0/runtime-descriptor-manifest.json",
		);
		expect(cachePluginRuntimeModule).toHaveBeenCalledWith(
			"test-plugin",
			runtimeModuleSource,
		);
	});

	it("blocks auto-resolved descriptor when release revocation list contains descriptor hash", async () => {
		const runtimeModuleSource =
			"export default { async setup(){}, async ping(){ return 'component-revoked'; } }";
		const runtimeModuleIntegrity =
			await computeSRIFromText(runtimeModuleSource);
		let descriptorHash = "";

		(global.fetch as any).mockImplementation(async (url: string) => {
			if (url.includes("runtime-descriptor-manifest.json")) {
				const descriptorWithoutIntegrity = {
					schemaVersion: 1,
					pluginId: "test-plugin",
					componentWasmUrl: "https://example.com/test.wasm",
					module: {
						url: "https://objects.githubusercontent.com/test.browser.mjs",
						integrity: runtimeModuleIntegrity,
						format: "esm",
					},
					toolchain: {
						name: "tractor-sidecar",
						version: "0.1.0",
					},
					provenance: {
						commitSha: "1111111111111111111111111111111111111111",
						buildId: "build-revoked",
						sourceRepository: "https://github.com/aretw0/refarm",
					},
				};

				descriptorHash = await computeDescriptorIntegrity(
					descriptorWithoutIntegrity,
				);

				return {
					ok: true,
					statusText: "OK",
					json: async () => ({
						schemaVersion: 1,
						descriptors: [
							{
								pluginId: "test-plugin",
								componentWasmUrl: "https://example.com/test.wasm",
								descriptor: {
									...descriptorWithoutIntegrity,
									descriptorIntegrity: descriptorHash,
								},
							},
						],
					}),
				};
			}

			if (url.includes("runtime-descriptor-revocations.json")) {
				return {
					ok: true,
					statusText: "OK",
					json: async () => ({
						schemaVersion: 1,
						revokedDescriptorHashes: [descriptorHash],
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

		await expect(
			installPlugin(manifestWithIntegrity, "https://example.com/test.wasm", {
				descriptorDistributionPolicy: "external-signed",
				descriptorSourceRepository: "https://github.com/aretw0/refarm",
				descriptorReleaseTag: "test-plugin@0.1.0-revoked",
			}),
		).rejects.toThrow("is revoked by release revocation list");
	});

	it("fails when auto-resolved release asset has malformed bundle manifest", async () => {
		(global.fetch as any).mockImplementation(async (url: string) => {
			if (url.includes("runtime-descriptor-manifest.json")) {
				return {
					ok: true,
					statusText: "OK",
					json: async () => ({ invalid: true }),
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
				descriptorDistributionPolicy: "external-signed",
				descriptorSourceRepository: "https://github.com/aretw0/refarm",
			}),
		).rejects.toThrow("bundle manifest is invalid");
	});

	it("fails when auto-resolved bundle manifest has no descriptor for plugin/version", async () => {
		(global.fetch as any).mockImplementation(async (url: string) => {
			if (url.includes("runtime-descriptor-manifest.json")) {
				return {
					ok: true,
					statusText: "OK",
					json: async () => ({
						schemaVersion: 1,
						descriptors: [
							{
								pluginId: "other-plugin",
								componentWasmUrl: "https://example.com/other.wasm",
								descriptor: {
									schemaVersion: 1,
									pluginId: "other-plugin",
									componentWasmUrl: "https://example.com/other.wasm",
									module: {
										url: "https://example.com/other.mjs",
										integrity:
											"sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
										format: "esm",
									},
									toolchain: { name: "tractor-sidecar", version: "0.1.0" },
									provenance: {
										commitSha: "1111111111111111111111111111111111111111",
										buildId: "build-other",
										sourceRepository: "https://github.com/aretw0/refarm",
									},
									descriptorIntegrity:
										"sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
								},
							},
						],
					}),
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
				descriptorDistributionPolicy: "external-signed",
				descriptorSourceRepository: "https://github.com/aretw0/refarm",
			}),
		).rejects.toThrow("bundle manifest missing descriptor entry");
	});

	it("prefers explicit descriptor URL when both explicit and auto-resolve inputs are provided", async () => {
		const runtimeModuleSource =
			"export default { async setup(){}, async ping(){ return 'component-explicit-wins'; } }";
		const runtimeModuleIntegrity =
			await computeSRIFromText(runtimeModuleSource);

		(global.fetch as any).mockImplementation(async (url: string) => {
			if (url === "https://cdn.example/explicit.runtime-descriptor.json") {
				const descriptorWithoutIntegrity = {
					schemaVersion: 1,
					pluginId: "test-plugin",
					componentWasmUrl: "https://example.com/test.wasm",
					module: {
						url: "https://cdn.example/test.browser.mjs",
						integrity: runtimeModuleIntegrity,
						format: "esm",
					},
					toolchain: {
						name: "tractor-sidecar",
						version: "0.1.0",
					},
					provenance: {
						commitSha: "1111111111111111111111111111111111111111",
						buildId: "build-explicit",
						sourceRepository: "https://github.com/aretw0/refarm",
					},
				};

				return {
					ok: true,
					statusText: "OK",
					json: async () => ({
						...descriptorWithoutIntegrity,
						descriptorIntegrity: await computeDescriptorIntegrity(
							descriptorWithoutIntegrity,
						),
					}),
				};
			}

			if (
				url ===
				"https://github.com/aretw0/refarm/releases/download/test-plugin%400.1.0/runtime-descriptor-revocations.json"
			) {
				return {
					ok: true,
					statusText: "OK",
					json: async () => ({
						schemaVersion: 1,
						revokedDescriptorHashes: [],
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
				descriptorDistributionPolicy: "external-signed",
				descriptorSourceRepository: "https://github.com/aretw0/refarm",
				browserRuntimeModuleDescriptor: {
					url: "https://cdn.example/explicit.runtime-descriptor.json",
				},
				descriptorTrustedOrigins: ["https://cdn.example"],
			},
		);

		expect(global.fetch).toHaveBeenCalledWith(
			"https://cdn.example/explicit.runtime-descriptor.json",
		);
	});

	it("rejects auto-resolve when descriptor source repository is not a supported GitHub repository", async () => {
		await expect(
			installPlugin(manifestWithIntegrity, "https://example.com/test.wasm", {
				descriptorDistributionPolicy: "external-signed",
				descriptorSourceRepository: "https://gitlab.com/refarm/refarm",
			}),
		).rejects.toThrow("Unable to resolve GitHub repository coordinates");
	});

	it("rejects mixing direct runtime module with descriptor auto-resolve inputs", async () => {
		const runtimeModuleSource =
			"export default { async ping(){ return 'x'; } }";
		const runtimeModuleIntegrity =
			await computeSRIFromText(runtimeModuleSource);

		await expect(
			installPlugin(manifestWithIntegrity, "https://example.com/test.wasm", {
				browserRuntimeModule: {
					url: "https://example.com/test.browser.mjs",
					integrity: runtimeModuleIntegrity,
				},
				descriptorSourceRepository: "https://github.com/aretw0/refarm",
			}),
		).rejects.toThrow(
			"Provide either browserRuntimeModule or descriptor-based inputs",
		);
	});

	it("blocks external-signed descriptor when inline revocation list marks descriptor hash revoked", async () => {
		const runtimeModuleSource =
			"export default { async ping(){ return 'x'; } }";
		const runtimeModuleIntegrity =
			await computeSRIFromText(runtimeModuleSource);
		const descriptorWithoutIntegrity = {
			schemaVersion: 1 as const,
			pluginId: "test-plugin",
			componentWasmUrl: "https://example.com/test.wasm",
			module: {
				url: "https://cdn.example/test.browser.mjs",
				integrity: runtimeModuleIntegrity,
				format: "esm" as const,
			},
			toolchain: {
				name: "tractor-sidecar",
				version: "0.1.0",
			},
			provenance: {
				commitSha: "1111111111111111111111111111111111111111",
				buildId: "build-inline-revocation",
				sourceRepository: "https://github.com/aretw0/refarm",
			},
		};
		const descriptorIntegrity = await computeDescriptorIntegrity(
			descriptorWithoutIntegrity,
		);

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
				descriptorDistributionPolicy: "external-signed",
				browserRuntimeModuleDescriptor: {
					...descriptorWithoutIntegrity,
					descriptorIntegrity,
				},
				descriptorRevocationList: {
					schemaVersion: 1,
					revokedDescriptorHashes: [descriptorIntegrity],
				},
			}),
		).rejects.toThrow("is revoked by release revocation list");
	});

	it("continues when revocation source is unavailable under fail-open policy", async () => {
		const runtimeModuleSource =
			"export default { async ping(){ return 'x'; } }";
		const runtimeModuleIntegrity =
			await computeSRIFromText(runtimeModuleSource);
		const descriptorWithoutIntegrity = {
			schemaVersion: 1 as const,
			pluginId: "test-plugin",
			componentWasmUrl: "https://example.com/test.wasm",
			module: {
				url: "https://cdn.example/test.browser.mjs",
				integrity: runtimeModuleIntegrity,
				format: "esm" as const,
			},
			toolchain: {
				name: "tractor-sidecar",
				version: "0.1.0",
			},
			provenance: {
				commitSha: "1111111111111111111111111111111111111111",
				buildId: "build-fail-open",
				sourceRepository: "https://github.com/aretw0/refarm",
			},
		};
		const descriptorIntegrity = await computeDescriptorIntegrity(
			descriptorWithoutIntegrity,
		);

		(global.fetch as any).mockImplementation(async (url: string) => {
			if (url.endsWith(".mjs")) {
				return {
					ok: true,
					statusText: "OK",
					text: async () => runtimeModuleSource,
				};
			}

			if (url === "https://revocation.example/runtime-revocations.json") {
				return {
					ok: false,
					statusText: "Service Unavailable",
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
				descriptorDistributionPolicy: "external-signed",
				browserRuntimeModuleDescriptor: {
					...descriptorWithoutIntegrity,
					descriptorIntegrity,
				},
				descriptorRevocationList: {
					url: "https://revocation.example/runtime-revocations.json",
				},
				descriptorRevocationUnavailablePolicy: "fail-open",
			}),
		).resolves.toBeTruthy();

		expect(cachePluginRuntimeModule).toHaveBeenCalledWith(
			"test-plugin",
			runtimeModuleSource,
		);
	});

	it("fails when revocation source is unavailable under fail-closed policy", async () => {
		const runtimeModuleSource =
			"export default { async ping(){ return 'x'; } }";
		const runtimeModuleIntegrity =
			await computeSRIFromText(runtimeModuleSource);
		const descriptorWithoutIntegrity = {
			schemaVersion: 1 as const,
			pluginId: "test-plugin",
			componentWasmUrl: "https://example.com/test.wasm",
			module: {
				url: "https://cdn.example/test.browser.mjs",
				integrity: runtimeModuleIntegrity,
				format: "esm" as const,
			},
			toolchain: {
				name: "tractor-sidecar",
				version: "0.1.0",
			},
			provenance: {
				commitSha: "1111111111111111111111111111111111111111",
				buildId: "build-fail-closed",
				sourceRepository: "https://github.com/aretw0/refarm",
			},
		};
		const descriptorIntegrity = await computeDescriptorIntegrity(
			descriptorWithoutIntegrity,
		);

		(global.fetch as any).mockImplementation(async (url: string) => {
			if (url.endsWith(".mjs")) {
				return {
					ok: true,
					statusText: "OK",
					text: async () => runtimeModuleSource,
				};
			}

			if (url === "https://revocation.example/runtime-revocations.json") {
				return {
					ok: false,
					statusText: "Service Unavailable",
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
				descriptorDistributionPolicy: "external-signed",
				browserRuntimeModuleDescriptor: {
					...descriptorWithoutIntegrity,
					descriptorIntegrity,
				},
				descriptorRevocationList: {
					url: "https://revocation.example/runtime-revocations.json",
				},
				descriptorRevocationUnavailablePolicy: "fail-closed",
			}),
		).rejects.toThrow("Failed to resolve runtime descriptor revocation list");
	});

	it("derives fail-open from descriptorRevocationProfile=dev", async () => {
		const runtimeModuleSource =
			"export default { async ping(){ return 'x'; } }";
		const runtimeModuleIntegrity =
			await computeSRIFromText(runtimeModuleSource);
		const descriptorWithoutIntegrity = {
			schemaVersion: 1 as const,
			pluginId: "test-plugin",
			componentWasmUrl: "https://example.com/test.wasm",
			module: {
				url: "https://cdn.example/test.browser.mjs",
				integrity: runtimeModuleIntegrity,
				format: "esm" as const,
			},
			toolchain: {
				name: "tractor-sidecar",
				version: "0.1.0",
			},
			provenance: {
				commitSha: "1111111111111111111111111111111111111111",
				buildId: "build-profile-dev",
				sourceRepository: "https://github.com/aretw0/refarm",
			},
		};
		const descriptorIntegrity = await computeDescriptorIntegrity(
			descriptorWithoutIntegrity,
		);

		(global.fetch as any).mockImplementation(async (url: string) => {
			if (url.endsWith(".mjs")) {
				return {
					ok: true,
					statusText: "OK",
					text: async () => runtimeModuleSource,
				};
			}

			if (url === "https://revocation.example/runtime-revocations.json") {
				return {
					ok: false,
					statusText: "Service Unavailable",
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
				descriptorDistributionPolicy: "external-signed",
				browserRuntimeModuleDescriptor: {
					...descriptorWithoutIntegrity,
					descriptorIntegrity,
				},
				descriptorRevocationList: {
					url: "https://revocation.example/runtime-revocations.json",
				},
				descriptorRevocationProfile: "dev",
			}),
		).resolves.toBeTruthy();
	});

	it("uses environment revocation profile when install options omit explicit policy", async () => {
		(globalThis as any).__REFARM_RUNTIME_DESCRIPTOR_REVOCATION_PROFILE__ =
			"dev";

		const runtimeModuleSource =
			"export default { async ping(){ return 'x'; } }";
		const runtimeModuleIntegrity =
			await computeSRIFromText(runtimeModuleSource);
		const descriptorWithoutIntegrity = {
			schemaVersion: 1 as const,
			pluginId: "test-plugin",
			componentWasmUrl: "https://example.com/test.wasm",
			module: {
				url: "https://cdn.example/test.browser.mjs",
				integrity: runtimeModuleIntegrity,
				format: "esm" as const,
			},
			toolchain: {
				name: "tractor-sidecar",
				version: "0.1.0",
			},
			provenance: {
				commitSha: "1111111111111111111111111111111111111111",
				buildId: "build-env-profile-dev",
				sourceRepository: "https://github.com/aretw0/refarm",
			},
		};
		const descriptorIntegrity = await computeDescriptorIntegrity(
			descriptorWithoutIntegrity,
		);

		(global.fetch as any).mockImplementation(async (url: string) => {
			if (url.endsWith(".mjs")) {
				return {
					ok: true,
					statusText: "OK",
					text: async () => runtimeModuleSource,
				};
			}

			if (url === "https://revocation.example/runtime-revocations.json") {
				return {
					ok: false,
					statusText: "Service Unavailable",
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
				descriptorDistributionPolicy: "external-signed",
				browserRuntimeModuleDescriptor: {
					...descriptorWithoutIntegrity,
					descriptorIntegrity,
				},
				descriptorRevocationList: {
					url: "https://revocation.example/runtime-revocations.json",
				},
			}),
		).resolves.toBeTruthy();
	});

	it("derives fail-open from generic runtime environment when dedicated revocation profile is absent", async () => {
		(globalThis as any).__REFARM_ENVIRONMENT__ = "development";

		const runtimeModuleSource =
			"export default { async ping(){ return 'x'; } }";
		const runtimeModuleIntegrity =
			await computeSRIFromText(runtimeModuleSource);
		const descriptorWithoutIntegrity = {
			schemaVersion: 1 as const,
			pluginId: "test-plugin",
			componentWasmUrl: "https://example.com/test.wasm",
			module: {
				url: "https://cdn.example/test.browser.mjs",
				integrity: runtimeModuleIntegrity,
				format: "esm" as const,
			},
			toolchain: {
				name: "tractor-sidecar",
				version: "0.1.0",
			},
			provenance: {
				commitSha: "1111111111111111111111111111111111111111",
				buildId: "build-env-development",
				sourceRepository: "https://github.com/aretw0/refarm",
			},
		};
		const descriptorIntegrity = await computeDescriptorIntegrity(
			descriptorWithoutIntegrity,
		);

		(global.fetch as any).mockImplementation(async (url: string) => {
			if (url.endsWith(".mjs")) {
				return {
					ok: true,
					statusText: "OK",
					text: async () => runtimeModuleSource,
				};
			}

			if (url === "https://revocation.example/runtime-revocations.json") {
				return {
					ok: false,
					statusText: "Service Unavailable",
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
				descriptorDistributionPolicy: "external-signed",
				browserRuntimeModuleDescriptor: {
					...descriptorWithoutIntegrity,
					descriptorIntegrity,
				},
				descriptorRevocationList: {
					url: "https://revocation.example/runtime-revocations.json",
				},
			}),
		).resolves.toBeTruthy();
	});

	it("derives fail-closed from generic runtime environment=production when dedicated profile is absent", async () => {
		(globalThis as any).__REFARM_ENVIRONMENT__ = "production";

		const runtimeModuleSource =
			"export default { async ping(){ return 'x'; } }";
		const runtimeModuleIntegrity =
			await computeSRIFromText(runtimeModuleSource);
		const descriptorWithoutIntegrity = {
			schemaVersion: 1 as const,
			pluginId: "test-plugin",
			componentWasmUrl: "https://example.com/test.wasm",
			module: {
				url: "https://cdn.example/test.browser.mjs",
				integrity: runtimeModuleIntegrity,
				format: "esm" as const,
			},
			toolchain: {
				name: "tractor-sidecar",
				version: "0.1.0",
			},
			provenance: {
				commitSha: "1111111111111111111111111111111111111111",
				buildId: "build-env-production",
				sourceRepository: "https://github.com/aretw0/refarm",
			},
		};
		const descriptorIntegrity = await computeDescriptorIntegrity(
			descriptorWithoutIntegrity,
		);

		(global.fetch as any).mockImplementation(async (url: string) => {
			if (url.endsWith(".mjs")) {
				return {
					ok: true,
					statusText: "OK",
					text: async () => runtimeModuleSource,
				};
			}

			if (url === "https://revocation.example/runtime-revocations.json") {
				return {
					ok: false,
					statusText: "Service Unavailable",
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
				descriptorDistributionPolicy: "external-signed",
				browserRuntimeModuleDescriptor: {
					...descriptorWithoutIntegrity,
					descriptorIntegrity,
				},
				descriptorRevocationList: {
					url: "https://revocation.example/runtime-revocations.json",
				},
			}),
		).rejects.toThrow("Failed to resolve runtime descriptor revocation list");
	});

	it("keeps dedicated environment profile precedence over conflicting generic environment and warns", async () => {
		(globalThis as any).__REFARM_RUNTIME_DESCRIPTOR_REVOCATION_PROFILE__ =
			"dev";
		(globalThis as any).__REFARM_ENVIRONMENT__ = "production";

		const runtimeModuleSource =
			"export default { async ping(){ return 'x'; } }";
		const runtimeModuleIntegrity =
			await computeSRIFromText(runtimeModuleSource);
		const descriptorWithoutIntegrity = {
			schemaVersion: 1 as const,
			pluginId: "test-plugin",
			componentWasmUrl: "https://example.com/test.wasm",
			module: {
				url: "https://cdn.example/test.browser.mjs",
				integrity: runtimeModuleIntegrity,
				format: "esm" as const,
			},
			toolchain: {
				name: "tractor-sidecar",
				version: "0.1.0",
			},
			provenance: {
				commitSha: "1111111111111111111111111111111111111111",
				buildId: "build-conflict-env-profile",
				sourceRepository: "https://github.com/aretw0/refarm",
			},
		};
		const descriptorIntegrity = await computeDescriptorIntegrity(
			descriptorWithoutIntegrity,
		);

		(global.fetch as any).mockImplementation(async (url: string) => {
			if (url.endsWith(".mjs")) {
				return {
					ok: true,
					statusText: "OK",
					text: async () => runtimeModuleSource,
				};
			}

			if (url === "https://revocation.example/runtime-revocations.json") {
				return {
					ok: false,
					statusText: "Service Unavailable",
				};
			}

			return {
				ok: true,
				statusText: "OK",
				arrayBuffer: async () => mockBuffer,
			};
		});

		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

		await expect(
			installPlugin(manifestWithIntegrity, "https://example.com/test.wasm", {
				descriptorDistributionPolicy: "external-signed",
				browserRuntimeModuleDescriptor: {
					...descriptorWithoutIntegrity,
					descriptorIntegrity,
				},
				descriptorRevocationList: {
					url: "https://revocation.example/runtime-revocations.json",
				},
			}),
		).resolves.toBeTruthy();

		expect(warnSpy).toHaveBeenCalledWith(
			expect.stringContaining("Conflicting revocation environment-profile"),
		);
		warnSpy.mockRestore();
	});

	it("derives fail-closed from NODE_ENV when dedicated profile and generic runtime environment are absent", async () => {
		const previousNodeEnv = process.env.NODE_ENV;
		process.env.NODE_ENV = "production";

		try {
			const runtimeModuleSource =
				"export default { async ping(){ return 'x'; } }";
			const runtimeModuleIntegrity =
				await computeSRIFromText(runtimeModuleSource);
			const descriptorWithoutIntegrity = {
				schemaVersion: 1 as const,
				pluginId: "test-plugin",
				componentWasmUrl: "https://example.com/test.wasm",
				module: {
					url: "https://cdn.example/test.browser.mjs",
					integrity: runtimeModuleIntegrity,
					format: "esm" as const,
				},
				toolchain: {
					name: "tractor-sidecar",
					version: "0.1.0",
				},
				provenance: {
					commitSha: "1111111111111111111111111111111111111111",
					buildId: "build-node-env-production",
					sourceRepository: "https://github.com/aretw0/refarm",
				},
			};
			const descriptorIntegrity = await computeDescriptorIntegrity(
				descriptorWithoutIntegrity,
			);

			(global.fetch as any).mockImplementation(async (url: string) => {
				if (url.endsWith(".mjs")) {
					return {
						ok: true,
						statusText: "OK",
						text: async () => runtimeModuleSource,
					};
				}

				if (url === "https://revocation.example/runtime-revocations.json") {
					return {
						ok: false,
						statusText: "Service Unavailable",
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
					descriptorDistributionPolicy: "external-signed",
					browserRuntimeModuleDescriptor: {
						...descriptorWithoutIntegrity,
						descriptorIntegrity,
					},
					descriptorRevocationList: {
						url: "https://revocation.example/runtime-revocations.json",
					},
				}),
			).rejects.toThrow("Failed to resolve runtime descriptor revocation list");
		} finally {
			process.env.NODE_ENV = previousNodeEnv;
		}
	});

	it("keeps explicit descriptorRevocationUnavailablePolicy precedence over profile", async () => {
		const runtimeModuleSource =
			"export default { async ping(){ return 'x'; } }";
		const runtimeModuleIntegrity =
			await computeSRIFromText(runtimeModuleSource);
		const descriptorWithoutIntegrity = {
			schemaVersion: 1 as const,
			pluginId: "test-plugin",
			componentWasmUrl: "https://example.com/test.wasm",
			module: {
				url: "https://cdn.example/test.browser.mjs",
				integrity: runtimeModuleIntegrity,
				format: "esm" as const,
			},
			toolchain: {
				name: "tractor-sidecar",
				version: "0.1.0",
			},
			provenance: {
				commitSha: "1111111111111111111111111111111111111111",
				buildId: "build-precedence-explicit-policy",
				sourceRepository: "https://github.com/aretw0/refarm",
			},
		};
		const descriptorIntegrity = await computeDescriptorIntegrity(
			descriptorWithoutIntegrity,
		);

		(global.fetch as any).mockImplementation(async (url: string) => {
			if (url.endsWith(".mjs")) {
				return {
					ok: true,
					statusText: "OK",
					text: async () => runtimeModuleSource,
				};
			}

			if (url === "https://revocation.example/runtime-revocations.json") {
				return {
					ok: false,
					statusText: "Service Unavailable",
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
				descriptorDistributionPolicy: "external-signed",
				browserRuntimeModuleDescriptor: {
					...descriptorWithoutIntegrity,
					descriptorIntegrity,
				},
				descriptorRevocationList: {
					url: "https://revocation.example/runtime-revocations.json",
				},
				descriptorRevocationProfile: "dev",
				descriptorRevocationUnavailablePolicy: "fail-closed",
			}),
		).rejects.toThrow("Failed to resolve runtime descriptor revocation list");
	});

	it("ignores invalid explicit policy value and falls back to descriptorRevocationProfile", async () => {
		const runtimeModuleSource =
			"export default { async ping(){ return 'x'; } }";
		const runtimeModuleIntegrity =
			await computeSRIFromText(runtimeModuleSource);
		const descriptorWithoutIntegrity = {
			schemaVersion: 1 as const,
			pluginId: "test-plugin",
			componentWasmUrl: "https://example.com/test.wasm",
			module: {
				url: "https://cdn.example/test.browser.mjs",
				integrity: runtimeModuleIntegrity,
				format: "esm" as const,
			},
			toolchain: {
				name: "tractor-sidecar",
				version: "0.1.0",
			},
			provenance: {
				commitSha: "1111111111111111111111111111111111111111",
				buildId: "build-invalid-explicit-policy",
				sourceRepository: "https://github.com/aretw0/refarm",
			},
		};
		const descriptorIntegrity = await computeDescriptorIntegrity(
			descriptorWithoutIntegrity,
		);

		(global.fetch as any).mockImplementation(async (url: string) => {
			if (url.endsWith(".mjs")) {
				return {
					ok: true,
					statusText: "OK",
					text: async () => runtimeModuleSource,
				};
			}

			if (url === "https://revocation.example/runtime-revocations.json") {
				return {
					ok: false,
					statusText: "Service Unavailable",
				};
			}

			return {
				ok: true,
				statusText: "OK",
				arrayBuffer: async () => mockBuffer,
			};
		});

		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

		await expect(
			installPlugin(manifestWithIntegrity, "https://example.com/test.wasm", {
				descriptorDistributionPolicy: "external-signed",
				browserRuntimeModuleDescriptor: {
					...descriptorWithoutIntegrity,
					descriptorIntegrity,
				},
				descriptorRevocationList: {
					url: "https://revocation.example/runtime-revocations.json",
				},
				descriptorRevocationUnavailablePolicy: "invalid-policy" as any,
				descriptorRevocationProfile: "dev",
			}),
		).resolves.toBeTruthy();

		expect(warnSpy).toHaveBeenCalledWith(
			expect.stringContaining("invalid revocation explicit-policy value"),
		);
		warnSpy.mockRestore();
	});

	it("ignores invalid environment profile and falls back to fail-closed", async () => {
		(globalThis as any).__REFARM_RUNTIME_DESCRIPTOR_REVOCATION_PROFILE__ =
			"invalid-profile";
		(globalThis as any).__REFARM_ENVIRONMENT__ = "invalid-env";

		const runtimeModuleSource =
			"export default { async ping(){ return 'x'; } }";
		const runtimeModuleIntegrity =
			await computeSRIFromText(runtimeModuleSource);
		const descriptorWithoutIntegrity = {
			schemaVersion: 1 as const,
			pluginId: "test-plugin",
			componentWasmUrl: "https://example.com/test.wasm",
			module: {
				url: "https://cdn.example/test.browser.mjs",
				integrity: runtimeModuleIntegrity,
				format: "esm" as const,
			},
			toolchain: {
				name: "tractor-sidecar",
				version: "0.1.0",
			},
			provenance: {
				commitSha: "1111111111111111111111111111111111111111",
				buildId: "build-invalid-env-profile",
				sourceRepository: "https://github.com/aretw0/refarm",
			},
		};
		const descriptorIntegrity = await computeDescriptorIntegrity(
			descriptorWithoutIntegrity,
		);

		(global.fetch as any).mockImplementation(async (url: string) => {
			if (url.endsWith(".mjs")) {
				return {
					ok: true,
					statusText: "OK",
					text: async () => runtimeModuleSource,
				};
			}

			if (url === "https://revocation.example/runtime-revocations.json") {
				return {
					ok: false,
					statusText: "Service Unavailable",
				};
			}

			return {
				ok: true,
				statusText: "OK",
				arrayBuffer: async () => mockBuffer,
			};
		});

		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

		await expect(
			installPlugin(manifestWithIntegrity, "https://example.com/test.wasm", {
				descriptorDistributionPolicy: "external-signed",
				browserRuntimeModuleDescriptor: {
					...descriptorWithoutIntegrity,
					descriptorIntegrity,
				},
				descriptorRevocationList: {
					url: "https://revocation.example/runtime-revocations.json",
				},
			}),
		).rejects.toThrow("Failed to resolve runtime descriptor revocation list");

		expect(warnSpy).toHaveBeenCalledWith(
			expect.stringContaining("invalid revocation environment-profile value"),
		);
		warnSpy.mockRestore();
	});

	it("uses stale revocation cache in stale-allowed mode and still blocks revoked descriptor", async () => {
		const runtimeModuleSource =
			"export default { async ping(){ return 'x'; } }";
		const runtimeModuleIntegrity =
			await computeSRIFromText(runtimeModuleSource);
		const descriptorWithoutIntegrity = {
			schemaVersion: 1 as const,
			pluginId: "test-plugin",
			componentWasmUrl: "https://example.com/test.wasm",
			module: {
				url: "https://cdn.example/test.browser.mjs",
				integrity: runtimeModuleIntegrity,
				format: "esm" as const,
			},
			toolchain: {
				name: "tractor-sidecar",
				version: "0.1.0",
			},
			provenance: {
				commitSha: "1111111111111111111111111111111111111111",
				buildId: "build-stale-revoked",
				sourceRepository: "https://github.com/aretw0/refarm",
			},
		};
		const descriptorIntegrity = await computeDescriptorIntegrity(
			descriptorWithoutIntegrity,
		);

		let revocationRequestCount = 0;
		(global.fetch as any).mockImplementation(async (url: string) => {
			if (url.endsWith(".mjs")) {
				return {
					ok: true,
					statusText: "OK",
					text: async () => runtimeModuleSource,
				};
			}

			if (url === "https://revocation.example/runtime-revocations.json") {
				revocationRequestCount += 1;
				if (revocationRequestCount === 1) {
					return {
						ok: true,
						statusText: "OK",
						json: async () => ({
							schemaVersion: 1,
							revokedDescriptorHashes: [descriptorIntegrity],
						}),
					};
				}

				return {
					ok: false,
					statusText: "Service Unavailable",
				};
			}

			return {
				ok: true,
				statusText: "OK",
				arrayBuffer: async () => mockBuffer,
			};
		});

		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

		await expect(
			installPlugin(manifestWithIntegrity, "https://example.com/test.wasm", {
				descriptorDistributionPolicy: "external-signed",
				browserRuntimeModuleDescriptor: {
					...descriptorWithoutIntegrity,
					descriptorIntegrity,
				},
				descriptorRevocationList: {
					url: "https://revocation.example/runtime-revocations.json",
				},
				descriptorRevocationUnavailablePolicy: "stale-allowed",
				descriptorRevocationCacheTtlMs: 0,
			}),
		).rejects.toThrow("is revoked by release revocation list");

		await expect(
			installPlugin(manifestWithIntegrity, "https://example.com/test.wasm", {
				force: true,
				descriptorDistributionPolicy: "external-signed",
				browserRuntimeModuleDescriptor: {
					...descriptorWithoutIntegrity,
					descriptorIntegrity,
				},
				descriptorRevocationList: {
					url: "https://revocation.example/runtime-revocations.json",
				},
				descriptorRevocationUnavailablePolicy: "stale-allowed",
				descriptorRevocationCacheTtlMs: 0,
			}),
		).rejects.toThrow("is revoked by release revocation list");

		expect(warnSpy).toHaveBeenCalledWith(
			expect.stringContaining("using stale cache"),
		);
		warnSpy.mockRestore();
	});

	it("uses stale revocation cache in stale-allowed mode and continues for non-revoked descriptor", async () => {
		const runtimeModuleSource =
			"export default { async ping(){ return 'x'; } }";
		const runtimeModuleIntegrity =
			await computeSRIFromText(runtimeModuleSource);
		const descriptorWithoutIntegrity = {
			schemaVersion: 1 as const,
			pluginId: "test-plugin",
			componentWasmUrl: "https://example.com/test.wasm",
			module: {
				url: "https://cdn.example/test.browser.mjs",
				integrity: runtimeModuleIntegrity,
				format: "esm" as const,
			},
			toolchain: {
				name: "tractor-sidecar",
				version: "0.1.0",
			},
			provenance: {
				commitSha: "1111111111111111111111111111111111111111",
				buildId: "build-stale-non-revoked",
				sourceRepository: "https://github.com/aretw0/refarm",
			},
		};
		const descriptorIntegrity = await computeDescriptorIntegrity(
			descriptorWithoutIntegrity,
		);

		let revocationRequestCount = 0;
		(global.fetch as any).mockImplementation(async (url: string) => {
			if (url.endsWith(".mjs")) {
				return {
					ok: true,
					statusText: "OK",
					text: async () => runtimeModuleSource,
				};
			}

			if (url === "https://revocation.example/runtime-revocations.json") {
				revocationRequestCount += 1;
				if (revocationRequestCount === 1) {
					return {
						ok: true,
						statusText: "OK",
						json: async () => ({
							schemaVersion: 1,
							revokedDescriptorHashes: ["sha256-other-descriptor"],
						}),
					};
				}

				return {
					ok: false,
					statusText: "Service Unavailable",
				};
			}

			return {
				ok: true,
				statusText: "OK",
				arrayBuffer: async () => mockBuffer,
			};
		});

		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

		await expect(
			installPlugin(manifestWithIntegrity, "https://example.com/test.wasm", {
				descriptorDistributionPolicy: "external-signed",
				browserRuntimeModuleDescriptor: {
					...descriptorWithoutIntegrity,
					descriptorIntegrity,
				},
				descriptorRevocationList: {
					url: "https://revocation.example/runtime-revocations.json",
				},
				descriptorRevocationUnavailablePolicy: "stale-allowed",
				descriptorRevocationCacheTtlMs: 0,
			}),
		).resolves.toBeTruthy();

		await expect(
			installPlugin(manifestWithIntegrity, "https://example.com/test.wasm", {
				force: true,
				descriptorDistributionPolicy: "external-signed",
				browserRuntimeModuleDescriptor: {
					...descriptorWithoutIntegrity,
					descriptorIntegrity,
				},
				descriptorRevocationList: {
					url: "https://revocation.example/runtime-revocations.json",
				},
				descriptorRevocationUnavailablePolicy: "stale-allowed",
				descriptorRevocationCacheTtlMs: 0,
			}),
		).resolves.toBeTruthy();

		expect(warnSpy).toHaveBeenCalledWith(
			expect.stringContaining("using stale cache"),
		);
		warnSpy.mockRestore();
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

			if (url.includes("runtime-descriptor-revocations.json")) {
				return {
					ok: true,
					statusText: "OK",
					json: async () => ({
						schemaVersion: 1,
						revokedDescriptorHashes: [],
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
								sourceRepository: "https://github.com/aretw0/refarm",
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

			if (url.includes("runtime-descriptor-revocations.json")) {
				return {
					ok: true,
					statusText: "OK",
					json: async () => ({
						schemaVersion: 1,
						revokedDescriptorHashes: [],
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

	it("derives trusted origin from provenance.sourceRepository for external-signed descriptors", async () => {
		const runtimeModuleSource =
			"export default { async setup(){}, async ping(){ return 'component-derived-trust'; } }";
		const runtimeModuleIntegrity =
			await computeSRIFromText(runtimeModuleSource);

		(global.fetch as any).mockImplementation(async (url: string) => {
			if (url.endsWith(".runtime-descriptor.json")) {
				return {
					ok: true,
					statusText: "OK",
					json: async () => {
						const descriptorWithoutIntegrity = {
							schemaVersion: 1,
							pluginId: "test-plugin",
							componentWasmUrl: "https://example.com/test.wasm",
							module: {
								url: "https://objects.githubusercontent.com/test.browser.mjs",
								integrity: runtimeModuleIntegrity,
								format: "esm",
							},
							toolchain: {
								name: "tractor-sidecar",
								version: "0.1.0",
							},
							provenance: {
								commitSha: "1111111111111111111111111111111111111111",
								buildId: "build-derived-trust",
								sourceRepository: "https://github.com/aretw0/refarm",
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

			if (url.includes("runtime-descriptor-revocations.json")) {
				return {
					ok: true,
					statusText: "OK",
					json: async () => ({
						schemaVersion: 1,
						revokedDescriptorHashes: [],
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
					url: "https://objects.githubusercontent.com/external.runtime-descriptor.json",
				},
				descriptorDistributionPolicy: "external-signed",
			},
		);

		expect(cachePluginRuntimeModule).toHaveBeenCalledWith(
			"test-plugin",
			runtimeModuleSource,
		);
	});

	it("requires manual allowlist when external-signed trust mode is strict-manual", async () => {
		const runtimeModuleSource =
			"export default { async setup(){}, async ping(){ return 'component-strict-manual'; } }";
		const runtimeModuleIntegrity =
			await computeSRIFromText(runtimeModuleSource);

		(global.fetch as any).mockImplementation(async (url: string) => {
			if (url.endsWith(".runtime-descriptor.json")) {
				return {
					ok: true,
					statusText: "OK",
					json: async () => {
						const descriptorWithoutIntegrity = {
							schemaVersion: 1,
							pluginId: "test-plugin",
							componentWasmUrl: "https://example.com/test.wasm",
							module: {
								url: "https://objects.githubusercontent.com/test.browser.mjs",
								integrity: runtimeModuleIntegrity,
								format: "esm",
							},
							toolchain: {
								name: "tractor-sidecar",
								version: "0.1.0",
							},
							provenance: {
								commitSha: "1111111111111111111111111111111111111111",
								buildId: "build-strict-manual",
								sourceRepository: "https://github.com/aretw0/refarm",
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
					url: "https://objects.githubusercontent.com/external.runtime-descriptor.json",
				},
				descriptorDistributionPolicy: "external-signed",
				descriptorTrustMode: "strict-manual",
			}),
		).rejects.toThrow("requires descriptor origin allowlist");
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
						sourceRepository: "https://github.com/aretw0/refarm",
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
