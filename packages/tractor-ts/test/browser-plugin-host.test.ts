import { createMockManifest } from "@refarm.dev/plugin-manifest";
import { describe, expect, it, vi } from "vitest";
import { PluginHost } from "../src/index.browser";

describe("browser PluginHost (.js onboarding path)", () => {
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

	it("keeps .wasm path blocked in browser stub", async () => {
		const host = new PluginHost(vi.fn(), {});
		const manifest = createMockManifest({
			entry: "https://example.test/plugin.wasm",
		});

		await expect(host.load(manifest)).rejects.toThrow(
			"entry format .wasm is not yet supported in browser runtime",
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
