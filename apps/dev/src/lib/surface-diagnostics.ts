import type { PluginInstance } from "@refarm.dev/tractor";
import { createHomesteadSurfacePluginHandle } from "@refarm.dev/homestead/sdk/plugin-handle";

export const STUDIO_SURFACE_DIAGNOSTICS_PLUGIN_ID =
	"studio-surface-diagnostics";
export const EXTERNAL_UNTRUSTED_SURFACE_PLUGIN_ID =
	"external-untrusted-surface";

export type StudioSurfaceDiagnosticsTelemetry = (
	pluginId: string,
	event: string,
	payload?: unknown,
) => void;

/**
 * Fixtures used by the `/surfaces` Studio ledger to prove both sides of the
 * Homestead trust policy: explicit internal surfaces mount, unregistered
 * external surfaces are rejected.
 */
export function createStudioSurfaceDiagnosticsPlugins(
	emitTelemetry: StudioSurfaceDiagnosticsTelemetry = () => {},
): PluginInstance[] {
	return [
		createHomesteadSurfacePluginHandle({
			id: STUDIO_SURFACE_DIAGNOSTICS_PLUGIN_ID,
			name: "Studio Surface Diagnostics",
			surfaces: [
				{
					kind: "panel",
					id: "surface-ledger-panel",
					slot: "main",
					capabilities: ["ui:panel:render"],
				},
			],
			emitTelemetry: (event, payload) =>
				emitTelemetry(STUDIO_SURFACE_DIAGNOSTICS_PLUGIN_ID, event, payload),
		}),
		createHomesteadSurfacePluginHandle({
			id: EXTERNAL_UNTRUSTED_SURFACE_PLUGIN_ID,
			name: "External Untrusted Surface",
			entry: "./dist/untrusted-surface.mjs",
			surfaces: [
				{
					kind: "panel",
					id: "external-ledger-panel",
					slot: "main",
					capabilities: ["ui:panel:render"],
				},
			],
			emitTelemetry: (event, payload) =>
				emitTelemetry(EXTERNAL_UNTRUSTED_SURFACE_PLUGIN_ID, event, payload),
		}),
	];
}
