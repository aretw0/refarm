import { createMockManifest } from "@refarm.dev/plugin-manifest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PluginHost } from "../src/index.browser";
import {
	cachePlugin,
	cachePluginRuntimeModule,
	evictPlugin,
} from "../src/lib/opfs-plugin-cache";
import { clearRuntimeDescriptorRevocationListCache } from "../src/lib/runtime-descriptor-revocation";

async function computeIntegrity(bytes: ArrayBuffer): Promise<string> {
	const digest = await crypto.subtle.digest("SHA-256", bytes);
	return `sha256-${Buffer.from(new Uint8Array(digest)).toString("base64")}`;
}

function mockRevocationListFetch(revokedDescriptorHashes: string[] = []): void {
	vi.stubGlobal(
		"fetch",
		vi.fn().mockImplementation(async (url: string) => {
			if (url.includes("runtime-descriptor-revocations.json")) {
				return {
					ok: true,
					statusText: "OK",
					json: async () => ({
						schemaVersion: 1,
						revokedDescriptorHashes,
					}),
				};
			}

			return {
				ok: false,
				statusText: "Not Found",
			};
		}),
	);
}

function mockRevocationListUnavailableFetch(): void {
	vi.stubGlobal(
		"fetch",
		vi.fn().mockImplementation(async (url: string) => {
			if (url.includes("runtime-descriptor-revocations.json")) {
				return {
					ok: false,
					statusText: "Service Unavailable",
				};
			}

			return {
				ok: false,
				statusText: "Not Found",
			};
		}),
	);
}

afterEach(async () => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
	clearRuntimeDescriptorRevocationListCache();
	delete (globalThis as any)
		.__REFARM_RUNTIME_DESCRIPTOR_REVOCATION_UNAVAILABLE_POLICY__;
	delete (globalThis as any).__REFARM_RUNTIME_DESCRIPTOR_REVOCATION_PROFILE__;
	await evictPlugin("@acme/wasm-plugin");
	await evictPlugin("@acme/component-plugin");
});

describe("browser PluginHost runtime paths", () => {
	it("loads a .js plugin module and exposes calls", async () => {
		const emit = vi.fn();
		const host = new PluginHost(emit, {});

		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({
				ok: true,
				statusText: "OK",
				text: async () =>
					"export async function setup(){return 'ok'}; export async function ping(){return 'pong'}",
			}),
		);

		const manifest = createMockManifest({
			id: "@acme/js-plugin",
			name: "JS Plugin",
			entry: "https://example.test/js-plugin.js",
			integrity: undefined,
		});

		const instance = await host.load(manifest);
		expect(await instance.call("ping")).toBe("pong");
		expect(host.getAllPlugins()).toHaveLength(1);
		expect(emit).toHaveBeenCalledWith(
			expect.objectContaining({
				event: "plugin:load",
				pluginId: "@acme/js-plugin",
			}),
		);
	});

	it("supports default-exported JS modules", async () => {
		const host = new PluginHost(vi.fn(), {});

		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({
				ok: true,
				statusText: "OK",
				text: async () =>
					"export default { async setup(){return 'ok'}, async ping(){return 'pong-default'} }",
			}),
		);

		const manifest = createMockManifest({
			id: "@acme/default-plugin",
			entry: "https://example.test/default-plugin.mjs",
			integrity: undefined,
		});

		const instance = await host.load(manifest);
		expect(await instance.call("ping")).toBe("pong-default");
	});

	it("requires installed cache for .wasm entries in browser runtime", async () => {
		const host = new PluginHost(vi.fn(), {});
		const manifest = createMockManifest({
			id: "@acme/wasm-plugin",
			entry: "https://example.test/plugin.wasm",
		});

		await expect(host.load(manifest)).rejects.toThrow(
			"Browser WASM plugin @acme/wasm-plugin is not installed in cache",
		);
	});

	it("loads cached .wasm plugins when WebAssembly instantiate succeeds", async () => {
		const emit = vi.fn();
		const host = new PluginHost(emit, {});
		const wasmBytes = new Uint8Array([
			0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
		]).buffer;
		const integrity = await computeIntegrity(wasmBytes);
		await cachePlugin("@acme/wasm-plugin", wasmBytes, {
			pluginId: "@acme/wasm-plugin",
			wasmUrl: "https://example.test/plugin.wasm",
			integrity,
			wasmHash: integrity,
			cachedAt: Date.now(),
			artifactKind: "module",
		});

		vi.spyOn(WebAssembly, "instantiate").mockResolvedValue({
			instance: {
				exports: {
					setup: vi.fn(),
					ping: vi.fn().mockResolvedValue("pong-wasm"),
				},
			},
		} as any);

		const manifest = createMockManifest({
			id: "@acme/wasm-plugin",
			name: "WASM Plugin",
			entry: "https://example.test/plugin.wasm",
			integrity,
		});

		const instance = await host.load(manifest);
		expect(await instance.call("ping")).toBe("pong-wasm");
		expect(emit).toHaveBeenCalledWith(
			expect.objectContaining({
				event: "plugin:load",
				pluginId: "@acme/wasm-plugin",
				payload: expect.objectContaining({
					entryType: "wasm",
					source: "browser-cache",
				}),
			}),
		);
	});

	it("rejects cached wasm component artifacts in browser runtime", async () => {
		const host = new PluginHost(vi.fn(), {});
		const componentBytes = new Uint8Array([
			0x00, 0x61, 0x73, 0x6d, 0x0a, 0x00, 0x01, 0x00,
		]).buffer;
		const integrity = await computeIntegrity(componentBytes);

		await cachePlugin("@acme/component-plugin", componentBytes, {
			pluginId: "@acme/component-plugin",
			wasmUrl: "https://example.test/component.wasm",
			integrity,
			wasmHash: integrity,
			cachedAt: Date.now(),
			artifactKind: "component",
		});

		const manifest = createMockManifest({
			id: "@acme/component-plugin",
			entry: "https://example.test/component.wasm",
			integrity,
		});

		await expect(host.load(manifest)).rejects.toThrow(
			"requires browserRuntimeModule metadata",
		);
	});

	it("rejects component artifacts without browser runtime descriptor metadata", async () => {
		const host = new PluginHost(vi.fn(), {});
		const componentBytes = new Uint8Array([
			0x00, 0x61, 0x73, 0x6d, 0x0a, 0x00, 0x01, 0x00,
		]).buffer;
		const componentIntegrity = await computeIntegrity(componentBytes);
		const runtimeModuleSource =
			"export default { async ping(){ return 'x'; } }";
		const runtimeModuleIntegrity = await computeIntegrity(
			new TextEncoder().encode(runtimeModuleSource).buffer,
		);

		await cachePlugin("@acme/component-plugin", componentBytes, {
			pluginId: "@acme/component-plugin",
			wasmUrl: "https://example.test/component.wasm",
			integrity: componentIntegrity,
			wasmHash: componentIntegrity,
			cachedAt: Date.now(),
			artifactKind: "component",
			browserRuntimeModule: {
				url: "https://example.test/component.browser.mjs",
				integrity: runtimeModuleIntegrity,
				format: "esm",
			},
		});
		await cachePluginRuntimeModule(
			"@acme/component-plugin",
			runtimeModuleSource,
		);

		const manifest = createMockManifest({
			id: "@acme/component-plugin",
			entry: "https://example.test/component.wasm",
			integrity: componentIntegrity,
		});

		await expect(host.load(manifest)).rejects.toThrow(
			"requires browserRuntimeDescriptor metadata",
		);
	});

	it("rejects component artifacts without browser runtime provenance metadata", async () => {
		const host = new PluginHost(vi.fn(), {});
		const componentBytes = new Uint8Array([
			0x00, 0x61, 0x73, 0x6d, 0x0a, 0x00, 0x01, 0x00,
		]).buffer;
		const componentIntegrity = await computeIntegrity(componentBytes);
		const runtimeModuleSource =
			"export default { async ping(){ return 'x'; } }";
		const runtimeModuleIntegrity = await computeIntegrity(
			new TextEncoder().encode(runtimeModuleSource).buffer,
		);

		await cachePlugin("@acme/component-plugin", componentBytes, {
			pluginId: "@acme/component-plugin",
			wasmUrl: "https://example.test/component.wasm",
			integrity: componentIntegrity,
			wasmHash: componentIntegrity,
			cachedAt: Date.now(),
			artifactKind: "component",
			browserRuntimeDescriptor: {
				schemaVersion: 1,
				descriptorHash: "sha256-descriptor",
				componentWasmUrl: "https://example.test/component.wasm",
				source: "descriptor",
			},
			browserRuntimeModule: {
				url: "https://example.test/component.browser.mjs",
				integrity: runtimeModuleIntegrity,
				format: "esm",
			},
		});
		await cachePluginRuntimeModule(
			"@acme/component-plugin",
			runtimeModuleSource,
		);

		const manifest = createMockManifest({
			id: "@acme/component-plugin",
			entry: "https://example.test/component.wasm",
			integrity: componentIntegrity,
		});

		await expect(host.load(manifest)).rejects.toThrow(
			"requires browserRuntimeProvenance metadata",
		);
	});

	it("loads cached component artifacts via browser runtime module cache", async () => {
		const emit = vi.fn();
		const host = new PluginHost(emit, {});
		mockRevocationListFetch();
		const componentBytes = new Uint8Array([
			0x00, 0x61, 0x73, 0x6d, 0x0a, 0x00, 0x01, 0x00,
		]).buffer;
		const componentIntegrity = await computeIntegrity(componentBytes);
		const runtimeModuleSource =
			"export default { async setup(){return 'ok'}, async ping(){return 'pong-component'} }";
		const runtimeModuleIntegrity = await computeIntegrity(
			new TextEncoder().encode(runtimeModuleSource).buffer,
		);

		await cachePlugin("@acme/component-plugin", componentBytes, {
			pluginId: "@acme/component-plugin",
			wasmUrl: "https://example.test/component.wasm",
			integrity: componentIntegrity,
			wasmHash: componentIntegrity,
			cachedAt: Date.now(),
			artifactKind: "component",
			browserRuntimeDescriptor: {
				schemaVersion: 1,
				descriptorHash: "sha256-descriptor",
				componentWasmUrl: "https://example.test/component.wasm",
				source: "descriptor",
			},
			browserRuntimeProvenance: {
				source: "descriptor",
				commitSha: "1111111111111111111111111111111111111111",
				buildId: "build-123",
				sourceRepository: "https://github.com/refarm-dev/refarm",
			},
			browserRuntimeModule: {
				url: "https://example.test/component.browser.mjs",
				integrity: runtimeModuleIntegrity,
				format: "esm",
			},
		});
		await cachePluginRuntimeModule(
			"@acme/component-plugin",
			runtimeModuleSource,
		);

		const manifest = createMockManifest({
			id: "@acme/component-plugin",
			entry: "https://example.test/component.wasm",
			integrity: componentIntegrity,
		});

		const instance = await host.load(manifest);
		expect(await instance.call("ping")).toBe("pong-component");
		expect(emit).toHaveBeenCalledWith(
			expect.objectContaining({
				event: "plugin:load",
				pluginId: "@acme/component-plugin",
				payload: expect.objectContaining({
					source: "browser-runtime-module",
					artifactKind: "component",
				}),
			}),
		);
	});

	it("blocks cached component load when descriptor hash is revoked", async () => {
		const host = new PluginHost(vi.fn(), {});
		const descriptorHash = "sha256-revoked-descriptor";
		mockRevocationListFetch([descriptorHash]);

		const componentBytes = new Uint8Array([
			0x00, 0x61, 0x73, 0x6d, 0x0a, 0x00, 0x01, 0x00,
		]).buffer;
		const componentIntegrity = await computeIntegrity(componentBytes);
		const runtimeModuleSource =
			"export default { async setup(){return 'ok'}, async ping(){return 'pong-component'} }";
		const runtimeModuleIntegrity = await computeIntegrity(
			new TextEncoder().encode(runtimeModuleSource).buffer,
		);

		await cachePlugin("@acme/component-plugin", componentBytes, {
			pluginId: "@acme/component-plugin",
			wasmUrl: "https://example.test/component.wasm",
			integrity: componentIntegrity,
			wasmHash: componentIntegrity,
			cachedAt: Date.now(),
			artifactKind: "component",
			browserRuntimeDescriptor: {
				schemaVersion: 1,
				descriptorHash,
				componentWasmUrl: "https://example.test/component.wasm",
				source: "descriptor",
			},
			browserRuntimeProvenance: {
				source: "descriptor",
				commitSha: "1111111111111111111111111111111111111111",
				buildId: "build-123",
				sourceRepository: "https://github.com/refarm-dev/refarm",
			},
			browserRuntimeModule: {
				url: "https://example.test/component.browser.mjs",
				integrity: runtimeModuleIntegrity,
				format: "esm",
			},
		});
		await cachePluginRuntimeModule(
			"@acme/component-plugin",
			runtimeModuleSource,
		);

		const manifest = createMockManifest({
			id: "@acme/component-plugin",
			entry: "https://example.test/component.wasm",
			integrity: componentIntegrity,
			version: "0.1.1",
		});

		await expect(host.load(manifest)).rejects.toThrow("is revoked");
	});

	it("allows cached component load when revocation list is unavailable under fail-open runtime policy", async () => {
		(
			globalThis as any
		).__REFARM_RUNTIME_DESCRIPTOR_REVOCATION_UNAVAILABLE_POLICY__ = "fail-open";

		const emit = vi.fn();
		const host = new PluginHost(emit, {});
		mockRevocationListUnavailableFetch();

		const componentBytes = new Uint8Array([
			0x00, 0x61, 0x73, 0x6d, 0x0a, 0x00, 0x01, 0x00,
		]).buffer;
		const componentIntegrity = await computeIntegrity(componentBytes);
		const runtimeModuleSource =
			"export default { async setup(){return 'ok'}, async ping(){return 'pong-component-fail-open'} }";
		const runtimeModuleIntegrity = await computeIntegrity(
			new TextEncoder().encode(runtimeModuleSource).buffer,
		);

		await cachePlugin("@acme/component-plugin", componentBytes, {
			pluginId: "@acme/component-plugin",
			wasmUrl: "https://example.test/component.wasm",
			integrity: componentIntegrity,
			wasmHash: componentIntegrity,
			cachedAt: Date.now(),
			artifactKind: "component",
			browserRuntimeDescriptor: {
				schemaVersion: 1,
				descriptorHash: "sha256-non-revoked-descriptor",
				componentWasmUrl: "https://example.test/component.wasm",
				source: "descriptor",
			},
			browserRuntimeProvenance: {
				source: "descriptor",
				commitSha: "1111111111111111111111111111111111111111",
				buildId: "build-123",
				sourceRepository: "https://github.com/refarm-dev/refarm",
			},
			browserRuntimeModule: {
				url: "https://example.test/component.browser.mjs",
				integrity: runtimeModuleIntegrity,
				format: "esm",
			},
		});
		await cachePluginRuntimeModule(
			"@acme/component-plugin",
			runtimeModuleSource,
		);

		const manifest = createMockManifest({
			id: "@acme/component-plugin",
			entry: "https://example.test/component.wasm",
			integrity: componentIntegrity,
			version: "0.1.2",
		});

		const instance = await host.load(manifest);
		expect(await instance.call("ping")).toBe("pong-component-fail-open");
		expect(emit).toHaveBeenCalledWith(
			expect.objectContaining({
				event: "system:descriptor_revocation_unavailable",
				pluginId: "@acme/component-plugin",
				payload: expect.objectContaining({
					policySource: "explicit-policy",
				}),
			}),
		);
	});

	it("derives fail-open from runtime revocation profile=dev", async () => {
		(globalThis as any).__REFARM_RUNTIME_DESCRIPTOR_REVOCATION_PROFILE__ =
			"dev";

		const emit = vi.fn();
		const host = new PluginHost(emit, {});
		mockRevocationListUnavailableFetch();

		const componentBytes = new Uint8Array([
			0x00, 0x61, 0x73, 0x6d, 0x0a, 0x00, 0x01, 0x00,
		]).buffer;
		const componentIntegrity = await computeIntegrity(componentBytes);
		const runtimeModuleSource =
			"export default { async setup(){return 'ok'}, async ping(){return 'pong-component-profile-dev'} }";
		const runtimeModuleIntegrity = await computeIntegrity(
			new TextEncoder().encode(runtimeModuleSource).buffer,
		);

		await cachePlugin("@acme/component-plugin", componentBytes, {
			pluginId: "@acme/component-plugin",
			wasmUrl: "https://example.test/component.wasm",
			integrity: componentIntegrity,
			wasmHash: componentIntegrity,
			cachedAt: Date.now(),
			artifactKind: "component",
			browserRuntimeDescriptor: {
				schemaVersion: 1,
				descriptorHash: "sha256-non-revoked-descriptor-profile-dev",
				componentWasmUrl: "https://example.test/component.wasm",
				source: "descriptor",
			},
			browserRuntimeProvenance: {
				source: "descriptor",
				commitSha: "1111111111111111111111111111111111111111",
				buildId: "build-profile-dev",
				sourceRepository: "https://github.com/refarm-dev/refarm",
			},
			browserRuntimeModule: {
				url: "https://example.test/component.browser.mjs",
				integrity: runtimeModuleIntegrity,
				format: "esm",
			},
		});
		await cachePluginRuntimeModule(
			"@acme/component-plugin",
			runtimeModuleSource,
		);

		const manifest = createMockManifest({
			id: "@acme/component-plugin",
			entry: "https://example.test/component.wasm",
			integrity: componentIntegrity,
			version: "0.1.3",
		});

		const instance = await host.load(manifest);
		expect(await instance.call("ping")).toBe("pong-component-profile-dev");
		expect(emit).toHaveBeenCalledWith(
			expect.objectContaining({
				event: "system:descriptor_revocation_unavailable",
				pluginId: "@acme/component-plugin",
				payload: expect.objectContaining({
					policy: "fail-open",
					policySource: "explicit-profile",
					profile: "dev",
				}),
			}),
		);
	});

	it("derives fail-closed from runtime revocation profile=production-sensitive", async () => {
		(globalThis as any).__REFARM_RUNTIME_DESCRIPTOR_REVOCATION_PROFILE__ =
			"production-sensitive";

		const host = new PluginHost(vi.fn(), {});
		mockRevocationListUnavailableFetch();

		const componentBytes = new Uint8Array([
			0x00, 0x61, 0x73, 0x6d, 0x0a, 0x00, 0x01, 0x00,
		]).buffer;
		const componentIntegrity = await computeIntegrity(componentBytes);
		const runtimeModuleSource =
			"export default { async setup(){return 'ok'}, async ping(){return 'pong-component-profile-prod'} }";
		const runtimeModuleIntegrity = await computeIntegrity(
			new TextEncoder().encode(runtimeModuleSource).buffer,
		);

		await cachePlugin("@acme/component-plugin", componentBytes, {
			pluginId: "@acme/component-plugin",
			wasmUrl: "https://example.test/component.wasm",
			integrity: componentIntegrity,
			wasmHash: componentIntegrity,
			cachedAt: Date.now(),
			artifactKind: "component",
			browserRuntimeDescriptor: {
				schemaVersion: 1,
				descriptorHash: "sha256-non-revoked-descriptor-profile-prod",
				componentWasmUrl: "https://example.test/component.wasm",
				source: "descriptor",
			},
			browserRuntimeProvenance: {
				source: "descriptor",
				commitSha: "1111111111111111111111111111111111111111",
				buildId: "build-profile-prod",
				sourceRepository: "https://github.com/refarm-dev/refarm",
			},
			browserRuntimeModule: {
				url: "https://example.test/component.browser.mjs",
				integrity: runtimeModuleIntegrity,
				format: "esm",
			},
		});
		await cachePluginRuntimeModule(
			"@acme/component-plugin",
			runtimeModuleSource,
		);

		const manifest = createMockManifest({
			id: "@acme/component-plugin",
			entry: "https://example.test/component.wasm",
			integrity: componentIntegrity,
			version: "0.1.4",
		});

		await expect(host.load(manifest)).rejects.toThrow(
			"Unable to verify runtime descriptor revocation status",
		);
	});

	it("emits config-invalid telemetry when runtime policy/profile overrides are invalid", async () => {
		(globalThis as any)
			.__REFARM_RUNTIME_DESCRIPTOR_REVOCATION_UNAVAILABLE_POLICY__ =
			"invalid-policy";
		(globalThis as any).__REFARM_RUNTIME_DESCRIPTOR_REVOCATION_PROFILE__ =
			"dev";

		const emit = vi.fn();
		const host = new PluginHost(emit, {});
		mockRevocationListUnavailableFetch();

		const componentBytes = new Uint8Array([
			0x00, 0x61, 0x73, 0x6d, 0x0a, 0x00, 0x01, 0x00,
		]).buffer;
		const componentIntegrity = await computeIntegrity(componentBytes);
		const runtimeModuleSource =
			"export default { async setup(){return 'ok'}, async ping(){return 'pong-invalid-config'} }";
		const runtimeModuleIntegrity = await computeIntegrity(
			new TextEncoder().encode(runtimeModuleSource).buffer,
		);

		await cachePlugin("@acme/component-plugin", componentBytes, {
			pluginId: "@acme/component-plugin",
			wasmUrl: "https://example.test/component.wasm",
			integrity: componentIntegrity,
			wasmHash: componentIntegrity,
			cachedAt: Date.now(),
			artifactKind: "component",
			browserRuntimeDescriptor: {
				schemaVersion: 1,
				descriptorHash: "sha256-non-revoked-invalid-config",
				componentWasmUrl: "https://example.test/component.wasm",
				source: "descriptor",
			},
			browserRuntimeProvenance: {
				source: "descriptor",
				commitSha: "1111111111111111111111111111111111111111",
				buildId: "build-invalid-config",
				sourceRepository: "https://github.com/refarm-dev/refarm",
			},
			browserRuntimeModule: {
				url: "https://example.test/component.browser.mjs",
				integrity: runtimeModuleIntegrity,
				format: "esm",
			},
		});
		await cachePluginRuntimeModule("@acme/component-plugin", runtimeModuleSource);

		const manifest = createMockManifest({
			id: "@acme/component-plugin",
			entry: "https://example.test/component.wasm",
			integrity: componentIntegrity,
			version: "0.1.7",
		});

		const instance = await host.load(manifest);
		expect(await instance.call("ping")).toBe("pong-invalid-config");

		expect(emit).toHaveBeenCalledWith(
			expect.objectContaining({
				event: "system:descriptor_revocation_config_invalid",
				pluginId: "@acme/component-plugin",
				payload: expect.objectContaining({
					resolvedPolicy: "fail-open",
					policySource: "explicit-profile",
					profile: "dev",
					invalidInputs: [
						{
							slot: "explicit-policy",
							value: "invalid-policy",
						},
					],
				}),
			}),
		);
	});

	it("emits config-invalid telemetry and fails closed when only invalid profile is provided", async () => {
		(globalThis as any).__REFARM_RUNTIME_DESCRIPTOR_REVOCATION_PROFILE__ =
			"unknown-profile";

		const emit = vi.fn();
		const host = new PluginHost(emit, {});
		mockRevocationListUnavailableFetch();

		const componentBytes = new Uint8Array([
			0x00, 0x61, 0x73, 0x6d, 0x0a, 0x00, 0x01, 0x00,
		]).buffer;
		const componentIntegrity = await computeIntegrity(componentBytes);
		const runtimeModuleSource =
			"export default { async setup(){return 'ok'}, async ping(){return 'pong-invalid-profile'} }";
		const runtimeModuleIntegrity = await computeIntegrity(
			new TextEncoder().encode(runtimeModuleSource).buffer,
		);

		await cachePlugin("@acme/component-plugin", componentBytes, {
			pluginId: "@acme/component-plugin",
			wasmUrl: "https://example.test/component.wasm",
			integrity: componentIntegrity,
			wasmHash: componentIntegrity,
			cachedAt: Date.now(),
			artifactKind: "component",
			browserRuntimeDescriptor: {
				schemaVersion: 1,
				descriptorHash: "sha256-non-revoked-invalid-profile",
				componentWasmUrl: "https://example.test/component.wasm",
				source: "descriptor",
			},
			browserRuntimeProvenance: {
				source: "descriptor",
				commitSha: "1111111111111111111111111111111111111111",
				buildId: "build-invalid-profile",
				sourceRepository: "https://github.com/refarm-dev/refarm",
			},
			browserRuntimeModule: {
				url: "https://example.test/component.browser.mjs",
				integrity: runtimeModuleIntegrity,
				format: "esm",
			},
		});
		await cachePluginRuntimeModule("@acme/component-plugin", runtimeModuleSource);

		const manifest = createMockManifest({
			id: "@acme/component-plugin",
			entry: "https://example.test/component.wasm",
			integrity: componentIntegrity,
			version: "0.1.8",
		});

		await expect(host.load(manifest)).rejects.toThrow(
			"Unable to verify runtime descriptor revocation status",
		);

		expect(emit).toHaveBeenCalledWith(
			expect.objectContaining({
				event: "system:descriptor_revocation_config_invalid",
				pluginId: "@acme/component-plugin",
				payload: expect.objectContaining({
					resolvedPolicy: "stale-allowed",
					policySource: "fallback",
					invalidInputs: [
						{
							slot: "explicit-profile",
							value: "unknown-profile",
						},
					],
				}),
			}),
		);
	});

	it("emits stale-cache telemetry and continues when stale-allowed fallback is used", async () => {
		let now = 1_000_000;
		vi.spyOn(Date, "now").mockImplementation(() => now);

		let revocationFetchCount = 0;
		vi.stubGlobal(
			"fetch",
			vi.fn().mockImplementation(async (url: string) => {
				if (url.includes("runtime-descriptor-revocations.json")) {
					revocationFetchCount += 1;
					if (revocationFetchCount === 1) {
						return {
							ok: true,
							statusText: "OK",
							json: async () => ({
								schemaVersion: 1,
								revokedDescriptorHashes: [],
							}),
						};
					}

					return {
						ok: false,
						statusText: "Service Unavailable",
					};
				}

				return {
					ok: false,
					statusText: "Not Found",
				};
			}),
		);

		const componentBytes = new Uint8Array([
			0x00, 0x61, 0x73, 0x6d, 0x0a, 0x00, 0x01, 0x00,
		]).buffer;
		const componentIntegrity = await computeIntegrity(componentBytes);
		const runtimeModuleSource =
			"export default { async setup(){return 'ok'}, async ping(){return 'pong-stale-allowed'} }";
		const runtimeModuleIntegrity = await computeIntegrity(
			new TextEncoder().encode(runtimeModuleSource).buffer,
		);

		await cachePlugin("@acme/component-plugin", componentBytes, {
			pluginId: "@acme/component-plugin",
			wasmUrl: "https://example.test/component.wasm",
			integrity: componentIntegrity,
			wasmHash: componentIntegrity,
			cachedAt: Date.now(),
			artifactKind: "component",
			browserRuntimeDescriptor: {
				schemaVersion: 1,
				descriptorHash: "sha256-stale-allowed-descriptor",
				componentWasmUrl: "https://example.test/component.wasm",
				source: "descriptor",
			},
			browserRuntimeProvenance: {
				source: "descriptor",
				commitSha: "1111111111111111111111111111111111111111",
				buildId: "build-stale-allowed",
				sourceRepository: "https://github.com/refarm-dev/refarm",
			},
			browserRuntimeModule: {
				url: "https://example.test/component.browser.mjs",
				integrity: runtimeModuleIntegrity,
				format: "esm",
			},
		});
		await cachePluginRuntimeModule("@acme/component-plugin", runtimeModuleSource);

		const manifest = createMockManifest({
			id: "@acme/component-plugin",
			entry: "https://example.test/component.wasm",
			integrity: componentIntegrity,
			version: "0.1.5",
		});

		const host1 = new PluginHost(vi.fn(), {});
		const first = await host1.load(manifest);
		expect(await first.call("ping")).toBe("pong-stale-allowed");

		now += 10 * 60 * 1000;
		const emit = vi.fn();
		const host2 = new PluginHost(emit, {});
		const second = await host2.load(manifest);
		expect(await second.call("ping")).toBe("pong-stale-allowed");
		expect(emit).toHaveBeenCalledWith(
			expect.objectContaining({
				event: "system:descriptor_revocation_stale_cache_used",
				pluginId: "@acme/component-plugin",
				payload: expect.objectContaining({
					policy: "stale-allowed",
					policySource: "fallback",
					cacheAgeMs: expect.any(Number),
				}),
			}),
		);
	});

	it("keeps revocation enforcement when stale fallback list contains descriptor hash", async () => {
		let now = 2_000_000;
		vi.spyOn(Date, "now").mockImplementation(() => now);

		let revocationFetchCount = 0;
		const descriptorHash = "sha256-stale-revoked-descriptor";
		vi.stubGlobal(
			"fetch",
			vi.fn().mockImplementation(async (url: string) => {
				if (url.includes("runtime-descriptor-revocations.json")) {
					revocationFetchCount += 1;
					if (revocationFetchCount === 1) {
						return {
							ok: true,
							statusText: "OK",
							json: async () => ({
								schemaVersion: 1,
								revokedDescriptorHashes: [descriptorHash],
							}),
						};
					}

					return {
						ok: false,
						statusText: "Service Unavailable",
					};
				}

				return {
					ok: false,
					statusText: "Not Found",
				};
			}),
		);

		const componentBytes = new Uint8Array([
			0x00, 0x61, 0x73, 0x6d, 0x0a, 0x00, 0x01, 0x00,
		]).buffer;
		const componentIntegrity = await computeIntegrity(componentBytes);
		const runtimeModuleSource =
			"export default { async setup(){return 'ok'}, async ping(){return 'pong-stale-revoked'} }";
		const runtimeModuleIntegrity = await computeIntegrity(
			new TextEncoder().encode(runtimeModuleSource).buffer,
		);

		await cachePlugin("@acme/component-plugin", componentBytes, {
			pluginId: "@acme/component-plugin",
			wasmUrl: "https://example.test/component.wasm",
			integrity: componentIntegrity,
			wasmHash: componentIntegrity,
			cachedAt: Date.now(),
			artifactKind: "component",
			browserRuntimeDescriptor: {
				schemaVersion: 1,
				descriptorHash,
				componentWasmUrl: "https://example.test/component.wasm",
				source: "descriptor",
			},
			browserRuntimeProvenance: {
				source: "descriptor",
				commitSha: "1111111111111111111111111111111111111111",
				buildId: "build-stale-revoked",
				sourceRepository: "https://github.com/refarm-dev/refarm",
			},
			browserRuntimeModule: {
				url: "https://example.test/component.browser.mjs",
				integrity: runtimeModuleIntegrity,
				format: "esm",
			},
		});
		await cachePluginRuntimeModule("@acme/component-plugin", runtimeModuleSource);

		const manifest = createMockManifest({
			id: "@acme/component-plugin",
			entry: "https://example.test/component.wasm",
			integrity: componentIntegrity,
			version: "0.1.6",
		});

		const host1 = new PluginHost(vi.fn(), {});
		await expect(host1.load(manifest)).rejects.toThrow("is revoked");

		now += 10 * 60 * 1000;
		const emit = vi.fn();
		const host2 = new PluginHost(emit, {});
		await expect(host2.load(manifest)).rejects.toThrow("is revoked");
		expect(emit).toHaveBeenCalledWith(
			expect.objectContaining({
				event: "system:descriptor_revocation_stale_cache_used",
				pluginId: "@acme/component-plugin",
			}),
		);
	});

	it("rejects .cjs entries in browser runtime", async () => {
		const host = new PluginHost(vi.fn(), {});
		const manifest = createMockManifest({
			entry: "https://example.test/plugin.cjs",
			integrity: undefined,
		});

		await expect(host.load(manifest)).rejects.toThrow(
			"entry format .cjs is not supported in browser runtime",
		);
	});
});
