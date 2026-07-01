import { describe, expect, it, vi } from "vitest";
import {
	installRefarmMeContentPlugin,
	type RefarmMeContentPluginInstallInput,
} from "./me-content-plugins";

vi.mock("@refarm.dev/tractor/browser", () => ({
	installPlugin: vi.fn(async () => ({
		pluginId: "@refarm.me/content-proof",
		wasmUrl: "https://example.test/content.wasm",
		cached: false,
		byteLength: 6,
		wasmHash: "sha256-content",
		artifactKind: "component",
		cachePath: "/refarm/barn/implements/_refarm_me_content-proof.wasm",
		runtimeModuleCachePath:
			"/refarm/barn/implements/_refarm_me_content-proof.mjs",
	})),
}));

describe("refarm.me content plugin bootstrap", () => {
	it("installs, trusts, activates, and loads an explicit content plugin", async () => {
		const input: RefarmMeContentPluginInstallInput = {
			manifest: {
				id: "@refarm.me/content-proof",
				name: "Content Proof",
				version: "0.1.0",
				entry: "https://example.test/content.wasm",
				integrity: "sha256-content",
				capabilities: { provides: [], requires: [] },
				permissions: [],
				observability: {
					hooks: ["onLoad", "onInit", "onRequest", "onError", "onTeardown"],
				},
				targets: ["browser"],
				certification: { license: "MIT", a11yLevel: 0, languages: ["en"] },
			},
			browserRuntimeModule: {
				url: "https://example.test/content.browser.mjs",
				integrity: "sha256-module",
			},
		};
		const instance = {
			id: "@refarm.me/content-proof",
			name: "Content Proof",
			state: "running" as const,
			manifest: input.manifest,
			call: vi.fn(),
			terminate: vi.fn(),
			emitTelemetry: vi.fn(),
		};
		const registryEntry = { status: "registered" };
		const tractor = {
			registry: {
				register: vi.fn(async () => "@refarm.me/content-proof"),
				trust: vi.fn(async () => {
					registryEntry.status = "validated";
				}),
				activatePlugin: vi.fn(async () => {
					registryEntry.status = "active";
				}),
				getPlugin: vi.fn(() => registryEntry),
			},
			plugins: {
				load: vi.fn(async () => instance),
			},
			emitTelemetry: vi.fn(),
		};

		await expect(
			installRefarmMeContentPlugin(tractor, input),
		).resolves.toMatchObject({
			pluginId: "@refarm.me/content-proof",
			cached: false,
			wasmHash: "sha256-content",
			byteLength: 6,
			registryStatus: "active",
			instance,
		});
		expect(tractor.registry.register).toHaveBeenCalledWith(
			input.manifest,
			input.manifest.entry,
		);
		expect(tractor.registry.trust).toHaveBeenCalledWith(input.manifest.id);
		expect(tractor.registry.activatePlugin).toHaveBeenCalledWith(
			input.manifest.id,
		);
		expect(tractor.plugins.load).toHaveBeenCalledWith(
			input.manifest,
			"sha256-content",
		);
		expect(tractor.emitTelemetry).toHaveBeenCalledWith({
			event: "me:content_plugin_installed",
			pluginId: input.manifest.id,
			payload: expect.objectContaining({
				artifactKind: "component",
				registryStatus: "active",
			}),
		});
	});
});
