import { describe, expect, it, vi } from "vitest";
import {
	createStudioSurfaceDiagnosticsPlugins,
	EXTERNAL_UNTRUSTED_SURFACE_PLUGIN_ID,
	EXTERNAL_VALIDATED_SURFACE_PLUGIN_ID,
	FAILING_SURFACE_DIAGNOSTICS_PLUGIN_ID,
	STUDIO_SURFACE_DIAGNOSTICS_PLUGIN_ID,
} from "./surface-diagnostics";

describe("createStudioSurfaceDiagnosticsPlugins", () => {
	it("creates trusted, failing, validated external, and untrusted fixtures", () => {
		const plugins = createStudioSurfaceDiagnosticsPlugins();

		expect(plugins.map((plugin) => plugin.id)).toEqual([
			STUDIO_SURFACE_DIAGNOSTICS_PLUGIN_ID,
			FAILING_SURFACE_DIAGNOSTICS_PLUGIN_ID,
			EXTERNAL_VALIDATED_SURFACE_PLUGIN_ID,
			EXTERNAL_UNTRUSTED_SURFACE_PLUGIN_ID,
		]);
		expect(plugins[0]?.manifest.entry).toBe(
			`internal:${STUDIO_SURFACE_DIAGNOSTICS_PLUGIN_ID}`,
		);
		expect(plugins[1]?.manifest.entry).toBe(
			`internal:${FAILING_SURFACE_DIAGNOSTICS_PLUGIN_ID}`,
		);
		expect(plugins[2]?.manifest.entry).toBe("./dist/validated-surface.mjs");
		expect(plugins[3]?.manifest.entry).toBe("./dist/untrusted-surface.mjs");
		for (const plugin of plugins) {
			expect(plugin.manifest.extensions?.surfaces?.[0]).toMatchObject({
				layer: "homestead",
				kind: "panel",
				slot: "main",
				capabilities: ["ui:panel:render"],
			});
		}
	});

	it("routes fixture telemetry with plugin identity", () => {
		const emitTelemetry = vi.fn();
		const [trusted, failing, validated, untrusted] =
			createStudioSurfaceDiagnosticsPlugins(emitTelemetry);

		trusted?.emitTelemetry("trusted:event", { ok: true });
		failing?.emitTelemetry("failing:event", { failed: true });
		validated?.emitTelemetry("validated:event", { ok: true });
		untrusted?.emitTelemetry("untrusted:event", { ok: false });

		expect(emitTelemetry).toHaveBeenCalledWith(
			STUDIO_SURFACE_DIAGNOSTICS_PLUGIN_ID,
			"trusted:event",
			{ ok: true },
		);
		expect(emitTelemetry).toHaveBeenCalledWith(
			FAILING_SURFACE_DIAGNOSTICS_PLUGIN_ID,
			"failing:event",
			{ failed: true },
		);
		expect(emitTelemetry).toHaveBeenCalledWith(
			EXTERNAL_VALIDATED_SURFACE_PLUGIN_ID,
			"validated:event",
			{ ok: true },
		);
		expect(emitTelemetry).toHaveBeenCalledWith(
			EXTERNAL_UNTRUSTED_SURFACE_PLUGIN_ID,
			"untrusted:event",
			{ ok: false },
		);
	});

	it("provides a fixture that fails only the render hook", async () => {
		const plugins = createStudioSurfaceDiagnosticsPlugins();
		const failing = plugins[1];

		await expect(failing?.call("renderHomesteadSurface", {})).rejects.toThrow(
			"diagnostic render failure",
		);
		await expect(failing?.call("other", {})).resolves.toBeNull();
	});

	it("provides a registry-validated external render fixture", async () => {
		const plugins = createStudioSurfaceDiagnosticsPlugins();
		const validated = plugins[2];

		await expect(validated?.call("renderHomesteadSurface", {})).resolves.toBe(
			"Registry validated external surface",
		);
		await expect(validated?.call("other", {})).resolves.toBeNull();
	});
});
