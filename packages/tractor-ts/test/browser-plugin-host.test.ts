import { createMockManifest } from "@refarm.dev/plugin-manifest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PluginHost } from "../src/index.browser";
import { cachePlugin, evictPlugin } from "../src/lib/opfs-plugin-cache";

afterEach(async () => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
	await evictPlugin("@acme/wasm-plugin");
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
		await cachePlugin(
			"@acme/wasm-plugin",
			new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]).buffer,
		);

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
