import { describe, expect, it, vi } from "vitest";
import {
	createStudioSurfaceDiagnosticsActionHandler,
	createStudioSurfaceDiagnosticsContextProvider,
	createStudioSurfaceDiagnosticsPlugins,
	EXTERNAL_UNTRUSTED_SURFACE_PLUGIN_ID,
	EXTERNAL_VALIDATED_SURFACE_PLUGIN_ID,
	FAILING_SURFACE_DIAGNOSTICS_PLUGIN_ID,
	renderStudioSurfaceDiagnostics,
	STUDIO_SURFACE_DIAGNOSTICS_PLUGIN_ID,
	SURFACE_DIAGNOSTICS_ACTION_ID,
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
				slot: "streams",
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

	it("provides an executable internal diagnostics surface", async () => {
		const plugins = createStudioSurfaceDiagnosticsPlugins();
		const trusted = plugins[0];

		const rendered = await trusted?.call("renderHomesteadSurface", {
			pluginId: STUDIO_SURFACE_DIAGNOSTICS_PLUGIN_ID,
			slotId: "streams",
			mountSource: "extension-surface",
			surface: trusted.manifest.extensions?.surfaces?.[0],
			locale: "en",
			host: createStudioSurfaceDiagnosticsContextProvider()({
				pluginId: STUDIO_SURFACE_DIAGNOSTICS_PLUGIN_ID,
				slotId: "streams",
				mountSource: "extension-surface",
				surface: trusted.manifest.extensions?.surfaces?.[0],
				locale: "en",
			}),
		});

		expect(rendered).toMatchObject({
			html: expect.stringContaining(
				`data-refarm-surface-action-id="${SURFACE_DIAGNOSTICS_ACTION_ID}"`,
			),
		});
		await expect(trusted?.call("other", {})).resolves.toBeNull();
	});

	it("renders escaped diagnostics surface host context", () => {
		const rendered = renderStudioSurfaceDiagnostics({
			pluginId: STUDIO_SURFACE_DIAGNOSTICS_PLUGIN_ID,
			slotId: "streams",
			mountSource: "extension-surface",
			surface: {
				layer: "homestead",
				kind: "panel",
				id: "surface-ledger-panel",
				slot: "streams",
			},
			locale: "en",
			host: {
				hostId: '<apps/dev & "studio">',
				actions: [
					{
						id: SURFACE_DIAGNOSTICS_ACTION_ID,
						label: "Run <denied> action",
					},
				],
			},
		});

		expect((rendered as { html: string }).html).toContain(
			"&lt;apps/dev &amp; &quot;studio&quot;&gt;",
		);
		expect((rendered as { html: string }).html).toContain(
			"Run &lt;denied&gt; action",
		);
	});

	it("keeps diagnostics surface context and action behavior in apps/dev", async () => {
		const surface = {
			layer: "homestead" as const,
			kind: "panel" as const,
			id: "surface-ledger-panel",
			slot: "streams",
		};
		const context = createStudioSurfaceDiagnosticsContextProvider();
		const action = createStudioSurfaceDiagnosticsActionHandler();
		const host = await context({
			pluginId: STUDIO_SURFACE_DIAGNOSTICS_PLUGIN_ID,
			slotId: "streams",
			mountSource: "extension-surface",
			surface,
			locale: "en",
		});

		expect(host).toMatchObject({
			hostId: "apps/dev",
			actions: [
				expect.objectContaining({
					id: SURFACE_DIAGNOSTICS_ACTION_ID,
					intent: "studio:diagnostic-denied",
				}),
			],
		});
		expect(() =>
			action({
				pluginId: STUDIO_SURFACE_DIAGNOSTICS_PLUGIN_ID,
				slotId: "streams",
				mountSource: "extension-surface",
				surface,
				locale: "en",
				host: host ?? undefined,
				action: host?.actions?.[0] ?? {
					id: SURFACE_DIAGNOSTICS_ACTION_ID,
					label: "Run denied diagnostic action",
				},
			}),
		).toThrow("diagnostic action denied by host");
		expect(
			context({
				pluginId: "other-plugin",
				slotId: "streams",
				mountSource: "extension-surface",
				surface,
				locale: "en",
			}),
		).toBeUndefined();
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
