import type { PluginInstance } from "@refarm.dev/tractor";
import { createHomesteadSurfacePluginHandle } from "@refarm.dev/homestead/sdk/plugin-handle";
import {
	createScopedHomesteadSurfaceActionHandler,
	createScopedHomesteadSurfaceContextProvider,
	type HomesteadSurfaceRenderActionHandler,
	type HomesteadSurfaceRenderContextProvider,
	type HomesteadSurfaceRenderRequest,
	type HomesteadSurfaceRenderResult,
} from "@refarm.dev/homestead/sdk/surface-renderer";

export const STUDIO_SURFACE_DIAGNOSTICS_PLUGIN_ID =
	"studio-surface-diagnostics";
export const FAILING_SURFACE_DIAGNOSTICS_PLUGIN_ID =
	"failing-surface-diagnostics";
export const EXTERNAL_VALIDATED_SURFACE_PLUGIN_ID =
	"external-validated-surface";
export const EXTERNAL_UNTRUSTED_SURFACE_PLUGIN_ID =
	"external-untrusted-surface";
export const SURFACE_DIAGNOSTICS_ACTION_ID = "run-denied-diagnostic-action";

export type StudioSurfaceDiagnosticsTelemetry = (
	pluginId: string,
	event: string,
	payload?: unknown,
) => void;

/**
 * Fixtures used by the `/surfaces` Studio ledger to prove both sides of the
 * Homestead trust policy: explicit internal surfaces mount, registry-validated
 * external surfaces mount, executable render failures are reported, and
 * unregistered external surfaces are rejected.
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
					slot: "streams",
					capabilities: ["ui:panel:render"],
				},
			],
			call: async (fn, args) =>
				fn === "renderHomesteadSurface"
					? renderStudioSurfaceDiagnostics(
							args as HomesteadSurfaceRenderRequest,
						)
					: null,
			emitTelemetry: (event, payload) =>
				emitTelemetry(STUDIO_SURFACE_DIAGNOSTICS_PLUGIN_ID, event, payload),
		}),
		createHomesteadSurfacePluginHandle({
			id: FAILING_SURFACE_DIAGNOSTICS_PLUGIN_ID,
			name: "Failing Surface Diagnostics",
			surfaces: [
				{
					kind: "panel",
					id: "failing-ledger-panel",
					slot: "streams",
					capabilities: ["ui:panel:render"],
				},
			],
			call: async (fn) => {
				if (fn === "renderHomesteadSurface") {
					throw new Error("diagnostic render failure");
				}
				return null;
			},
			emitTelemetry: (event, payload) =>
				emitTelemetry(FAILING_SURFACE_DIAGNOSTICS_PLUGIN_ID, event, payload),
		}),
		createHomesteadSurfacePluginHandle({
			id: EXTERNAL_VALIDATED_SURFACE_PLUGIN_ID,
			name: "External Validated Surface",
			entry: "./dist/validated-surface.mjs",
			surfaces: [
				{
					kind: "panel",
					id: "external-validated-ledger-panel",
					slot: "streams",
					capabilities: ["ui:panel:render"],
				},
			],
			call: async (fn) => {
				if (fn === "renderHomesteadSurface") {
					return "Registry validated external surface";
				}
				return null;
			},
			emitTelemetry: (event, payload) =>
				emitTelemetry(EXTERNAL_VALIDATED_SURFACE_PLUGIN_ID, event, payload),
		}),
		createHomesteadSurfacePluginHandle({
			id: EXTERNAL_UNTRUSTED_SURFACE_PLUGIN_ID,
			name: "External Untrusted Surface",
			entry: "./dist/untrusted-surface.mjs",
			surfaces: [
				{
					kind: "panel",
					id: "external-ledger-panel",
					slot: "streams",
					capabilities: ["ui:panel:render"],
				},
			],
			emitTelemetry: (event, payload) =>
				emitTelemetry(EXTERNAL_UNTRUSTED_SURFACE_PLUGIN_ID, event, payload),
		}),
	];
}

export function renderStudioSurfaceDiagnostics(
	request: HomesteadSurfaceRenderRequest,
): HomesteadSurfaceRenderResult {
	const hostId = escapeStudioSurfaceDiagnosticsText(
		request.host?.hostId ?? "unknown host",
	);
	const action = request.host?.actions?.find(
		(candidate) => candidate.id === SURFACE_DIAGNOSTICS_ACTION_ID,
	);
	const actionButton = action
		? `<button type="button" class="refarm-btn refarm-btn-pill" data-refarm-surface-action-id="${escapeStudioSurfaceDiagnosticsText(action.id)}">${escapeStudioSurfaceDiagnosticsText(action.label)}</button>`
		: "";

	return {
		html: `<section class="refarm-surface-card refarm-stack" data-refarm-studio-surface-diagnostics="surface-ledger-panel">
			<p class="refarm-eyebrow">Executable diagnostics surface</p>
			<h3>Surface action telemetry</h3>
			<p>This fixture is rendered by <code class="refarm-code">${STUDIO_SURFACE_DIAGNOSTICS_PLUGIN_ID}</code> with host context from <code class="refarm-code">${hostId}</code>.</p>
			<p>Trigger the action to prove requested/failed host-action diagnostics in the ledger.</p>
			${actionButton ? `<div class="refarm-cluster">${actionButton}</div>` : ""}
		</section>`,
	};
}

export function createStudioSurfaceDiagnosticsContextProvider(): HomesteadSurfaceRenderContextProvider {
	return createScopedHomesteadSurfaceContextProvider(
		{
			pluginId: STUDIO_SURFACE_DIAGNOSTICS_PLUGIN_ID,
			surfaceId: "surface-ledger-panel",
		},
		() => ({
			hostId: "apps/dev",
			data: {
				surfacePurpose: "surface action diagnostics",
			},
			actions: [
				{
					id: SURFACE_DIAGNOSTICS_ACTION_ID,
					label: "Run denied diagnostic action",
					intent: "studio:diagnostic-denied",
					payload: { reason: "prove ui:surface_action_failed" },
				},
			],
		}),
	);
}

export function createStudioSurfaceDiagnosticsActionHandler(): HomesteadSurfaceRenderActionHandler {
	return createScopedHomesteadSurfaceActionHandler(
		{
			pluginId: STUDIO_SURFACE_DIAGNOSTICS_PLUGIN_ID,
			surfaceId: "surface-ledger-panel",
		},
		({ action }) => {
			if (action.id !== SURFACE_DIAGNOSTICS_ACTION_ID) return;
			throw new Error("diagnostic action denied by host");
		},
	);
}

function escapeStudioSurfaceDiagnosticsText(value: string): string {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#39;");
}
