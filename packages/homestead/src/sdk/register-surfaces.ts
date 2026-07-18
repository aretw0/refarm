import type { RuntimePluginHandle } from "@refarm.dev/runtime";

/**
 * The surface-registration phase, in its OWN leaf module (imports only the RuntimePluginHandle type).
 * Both `bootCapabilityWebShell` and an app that interleaves its own boot work register surfaces the
 * same way; keeping the phase here — free of the Shell + runtime imports boot-web-shell.ts carries —
 * lets an app (apps/me) import it WITHOUT dragging the heavy Shell into its initial bundle (me
 * code-splits setupStudioShell, so it must not be pulled eagerly).
 */

/**
 * A surface-plugin source — the two forms the shell and an app both accept: a ready array of surface
 * plugin handles, or a factory given a ui-telemetry emitter (so a surface can report `ui:*` events
 * through the runtime).
 */
export type SurfacePluginSource =
	| RuntimePluginHandle[]
	| ((emitTelemetry: (pluginId: string, event: string, payload?: unknown) => void) => RuntimePluginHandle[]);

/** The minimal tractor slice {@link registerSurfacePlugins} needs — a structural type so any runtime's
 * tractor (the StudioRuntime's, apps/me's) fits without importing a concrete Tractor type. */
export interface SurfacePluginRegistrar {
	emitTelemetry(event: { event: string; payload?: unknown; pluginId: string }): void;
	plugins: { registerInternal(handle: RuntimePluginHandle): void };
}

/**
 * Register surface plugins as internal (trusted) plugins on a tractor, returning their ids — the ONE
 * register phase `bootCapabilityWebShell` and an app that interleaves its own boot work both use.
 * apps/me installs WASM content plugins BETWEEN the runtime boot and surface registration, so it can't
 * call the atomic `bootCapabilityWebShell`; sharing this phase keeps the loop + the `ui:*` telemetry
 * emitter in ONE place instead of copied per app. A factory `surfaces` receives the emitter so a
 * surface can report `ui:*` events through the runtime.
 */
export function registerSurfacePlugins(tractor: SurfacePluginRegistrar, surfaces: SurfacePluginSource): string[] {
	const emitTelemetry = (pluginId: string, event: string, payload?: unknown): void => {
		tractor.emitTelemetry({ event, payload, pluginId });
	};
	const resolved = typeof surfaces === "function" ? surfaces(emitTelemetry) : surfaces;
	for (const surface of resolved) {
		tractor.plugins.registerInternal(surface);
	}
	return resolved.map((surface) => surface.id);
}
