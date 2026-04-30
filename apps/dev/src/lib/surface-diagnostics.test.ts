import { describe, expect, it, vi } from "vitest";
import {
	createStudioSurfaceDiagnosticsPlugins,
	EXTERNAL_UNTRUSTED_SURFACE_PLUGIN_ID,
	STUDIO_SURFACE_DIAGNOSTICS_PLUGIN_ID,
} from "./surface-diagnostics";

describe("createStudioSurfaceDiagnosticsPlugins", () => {
	it("creates one trusted internal and one untrusted external surface fixture", () => {
		const plugins = createStudioSurfaceDiagnosticsPlugins();

		expect(plugins.map((plugin) => plugin.id)).toEqual([
			STUDIO_SURFACE_DIAGNOSTICS_PLUGIN_ID,
			EXTERNAL_UNTRUSTED_SURFACE_PLUGIN_ID,
		]);
		expect(plugins[0]?.manifest.entry).toBe(
			`internal:${STUDIO_SURFACE_DIAGNOSTICS_PLUGIN_ID}`,
		);
		expect(plugins[1]?.manifest.entry).toBe("./dist/untrusted-surface.mjs");
		expect(plugins[0]?.manifest.extensions?.surfaces?.[0]).toMatchObject({
			layer: "homestead",
			kind: "panel",
			slot: "main",
			capabilities: ["ui:panel:render"],
		});
		expect(plugins[1]?.manifest.extensions?.surfaces?.[0]).toMatchObject({
			layer: "homestead",
			kind: "panel",
			slot: "main",
			capabilities: ["ui:panel:render"],
		});
	});

	it("routes fixture telemetry with plugin identity", () => {
		const emitTelemetry = vi.fn();
		const [trusted, untrusted] =
			createStudioSurfaceDiagnosticsPlugins(emitTelemetry);

		trusted?.emitTelemetry("trusted:event", { ok: true });
		untrusted?.emitTelemetry("untrusted:event", { ok: false });

		expect(emitTelemetry).toHaveBeenCalledWith(
			STUDIO_SURFACE_DIAGNOSTICS_PLUGIN_ID,
			"trusted:event",
			{ ok: true },
		);
		expect(emitTelemetry).toHaveBeenCalledWith(
			EXTERNAL_UNTRUSTED_SURFACE_PLUGIN_ID,
			"untrusted:event",
			{ ok: false },
		);
	});
});
