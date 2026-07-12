import type { RuntimePluginHandle } from "@refarm.dev/runtime";

import { bootStudioRuntime, type StudioRuntime } from "./runtime.js";
import { setupStudioShell, type StudioShell } from "./Shell.js";
import type {
	HomesteadSurfaceRenderActionHandler,
	HomesteadSurfaceRenderContextProvider,
} from "./surface-renderer.js";

/**
 * The ONE call that boots a Homestead web shell and mounts capability surfaces — the boot
 * sequence every web app (apps/me, apps/dev) hand-rolled ~identically: boot the browser
 * runtime, register the surface plugin(s) as internal (trusted) plugins, then set up the
 * StudioShell so each surface renders into its DOM slot.
 *
 * The point: a capability app already produces the two things a shell needs — a surface
 * plugin handle (via `createCapabilityWebSurfacePlugin`) and the per-render host context
 * (via the capability host's `surfaceContext()`). Handing both here gives that app a live
 * web face in a dozen lines instead of a bespoke 200–500-line boot module. This is the web
 * half of "declare a verb once → reach every surface": the same declaration that lights the
 * CLI and the TUI lights a real Astro/Homestead page, with no hand-written renderer.
 *
 * Runs in the BROWSER only (it opens OPFS/SQLite + a browser Tractor). Call it from the
 * `<script>` of an Astro page whose Layout provides the DOM slots.
 */
export interface BootCapabilityWebShellOptions {
	/** A stable database name for the app's OPFS/SQLite store, e.g. "wallet-web". */
	databaseName: string;
	/** The runtime namespace (a logical partition), e.g. "wallet". */
	namespace: string;
	/** The identity this shell runs under. A stable per-app id; defaults to `namespace`. */
	identityId?: string;
	/**
	 * The surface plugin(s) to mount — typically ONE `createCapabilityWebSurfacePlugin(...)`
	 * handle. Accepts an array so an app can mount several panels. A factory form receives a
	 * telemetry emitter so surfaces can report `ui:*` events through the runtime.
	 */
	surfaces:
		| RuntimePluginHandle[]
		| ((emitTelemetry: (pluginId: string, event: string, payload?: unknown) => void) => RuntimePluginHandle[]);
	/**
	 * Per-render host context — where the app puts a verb's structured result (`host.data`)
	 * and its actions (`host.actions`) for the surface to render. A capability host exposes
	 * exactly this via `host.surfaceContext()`; pass it straight through.
	 */
	surfaceContext?: HomesteadSurfaceRenderContextProvider;
	/** Handles a clicked surface action (a card/button) — routes it back to a verb's run(). */
	surfaceAction?: HomesteadSurfaceRenderActionHandler;
	/** Connect the browser runtime to an external daemon over WebSocket for live CRDT sync. */
	connectBrowserSync?: boolean;
	/** Env metadata surfaced to the runtime (version/commit); optional. */
	envMetadata?: Record<string, string>;
}

export interface CapabilityWebShell {
	runtime: StudioRuntime;
	shell: StudioShell;
	/** The ids of the surface plugins that were mounted. */
	surfacePluginIds: string[];
}

/**
 * Boot the runtime, register the surface plugins, and set up the shell. Returns the live
 * runtime + shell so callers can observe sync events, mount more plugins, or tear down.
 */
export async function bootCapabilityWebShell(
	options: BootCapabilityWebShellOptions,
): Promise<CapabilityWebShell> {
	const runtime = await bootStudioRuntime({
		databaseName: options.databaseName,
		namespace: options.namespace,
		identityId: options.identityId ?? options.namespace,
		connectBrowserSync: options.connectBrowserSync ?? false,
		...(options.envMetadata ? { envMetadata: options.envMetadata } : {}),
	});

	const emitTelemetry = (pluginId: string, event: string, payload?: unknown): void => {
		runtime.tractor.emitTelemetry({ event, payload, pluginId });
	};
	const surfaces =
		typeof options.surfaces === "function" ? options.surfaces(emitTelemetry) : options.surfaces;

	for (const surface of surfaces) {
		runtime.tractor.plugins.registerInternal(surface);
	}

	const shell = await setupStudioShell(runtime.tractor, {
		...(options.surfaceContext ? { surfaceContext: options.surfaceContext } : {}),
		...(options.surfaceAction ? { surfaceAction: options.surfaceAction } : {}),
	});

	return {
		runtime,
		shell,
		surfacePluginIds: surfaces.map((surface) => surface.id),
	};
}
