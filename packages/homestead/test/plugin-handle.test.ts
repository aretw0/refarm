import { describe, expect, it, vi } from "vitest";
import {
	createHomesteadSurfacePluginHandle,
	createStudioPluginHandle,
	registerStudioPluginManifest,
} from "../src/sdk/plugin-handle";

describe("createStudioPluginHandle", () => {
	it("creates an internal Studio plugin handle by default", async () => {
		const plugin = createStudioPluginHandle({
			id: "studio-fixture",
			name: "Studio Fixture",
			manifest: {
				extensions: {
					surfaces: [
						{
							layer: "homestead",
							kind: "panel",
							id: "fixture-panel",
							slot: "main",
							capabilities: ["ui:panel:render"],
						},
					],
				},
			},
		});

		expect(plugin.id).toBe("studio-fixture");
		expect(plugin.state).toBe("running");
		expect(plugin.manifest.entry).toBe("internal:studio-fixture");
		expect(plugin.manifest.extensions?.surfaces?.[0]?.id).toBe("fixture-panel");
		expect(await plugin.call("noop")).toBeNull();
	});

	it("allows explicit external entries for trust-gate diagnostics", () => {
		const plugin = createStudioPluginHandle({
			id: "external-fixture",
			name: "External Fixture",
			entry: "./dist/external.mjs",
		});

		expect(plugin.manifest.entry).toBe("./dist/external.mjs");
	});

	it("creates Homestead surface handles without repeating layer boilerplate", () => {
		const plugin = createHomesteadSurfacePluginHandle({
			id: "surface-fixture",
			name: "Surface Fixture",
			manifest: {
				extensions: {
					surfaces: [
						{
							layer: "asset",
							kind: "theme-pack",
							id: "surface-theme",
						},
					],
				},
			},
			surfaces: [
				{
					kind: "panel",
					id: "surface-panel",
					slot: "main",
					capabilities: ["ui:panel:render"],
				},
			],
		});

		expect(plugin.manifest.extensions?.surfaces).toEqual([
			{
				layer: "asset",
				kind: "theme-pack",
				id: "surface-theme",
			},
			{
				layer: "homestead",
				kind: "panel",
				id: "surface-panel",
				slot: "main",
				capabilities: ["ui:panel:render"],
			},
		]);
	});

	it("registers plugin manifests in a host-owned registry", async () => {
		const plugin = createStudioPluginHandle({
			id: "registry-fixture",
			name: "Registry Fixture",
			entry: "./dist/registry-fixture.mjs",
		});
		const entry = { status: "registered" as const };
		const registry = {
			register: vi.fn().mockResolvedValue(plugin.id),
			getPlugin: vi.fn().mockReturnValue(entry),
		};

		await registerStudioPluginManifest(registry, plugin, {
			status: "validated",
		});

		expect(registry.register).toHaveBeenCalledWith(plugin.manifest);
		expect(registry.getPlugin).toHaveBeenCalledWith("registry-fixture");
		expect(entry.status).toBe("validated");
	});

	it("uses provided telemetry and call handlers", async () => {
		const emitTelemetry = vi.fn();
		const plugin = createStudioPluginHandle({
			id: "callable-fixture",
			name: "Callable Fixture",
			call: async (fn, args) => ({ fn, args }),
			emitTelemetry,
		});

		expect(await plugin.call("do-work", { ok: true })).toEqual({
			fn: "do-work",
			args: { ok: true },
		});
		plugin.emitTelemetry("studio:event", { ok: true });
		expect(emitTelemetry).toHaveBeenCalledWith("studio:event", { ok: true });
	});
});
