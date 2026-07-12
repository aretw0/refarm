import type { RuntimePluginHandle } from "@refarm.dev/runtime";

import { bootStudioRuntime, type BootStudioRuntimeOptions, type StudioRuntime } from "./runtime.js";
import { setupStudioShell, type StudioShell } from "./Shell.js";
import type {
	HomesteadSurfaceRenderActionHandler,
	HomesteadSurfaceRenderContextProvider,
	HomesteadSurfaceRenderHostContext,
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
	 * and its actions (`host.actions`) for the surface to render. Accepts EITHER a provider
	 * function (called per render) OR a static context object, so a capability host can pass
	 * `host.surfaceContext()` (an object) directly without wrapping it in an arrow. A static
	 * object is served for every render.
	 */
	surfaceContext?: HomesteadSurfaceRenderContextProvider | HomesteadSurfaceRenderHostContext;
	/**
	 * Extra fields merged into `host.data` on top of `surfaceContext` — the ergonomic way to
	 * feed a verb's rendered content to a surface's content seam. An app runs its verb and
	 * passes `{ walletHtml: result.walletHtml }` here instead of hand-wrapping surfaceContext
	 * in an arrow that spreads `...base.data`. Only meaningful with a STATIC `surfaceContext`
	 * object (or none); ignored if `surfaceContext` is a provider function, which already owns
	 * per-render data.
	 */
	hostData?: Record<string, unknown>;
	/** Handles a clicked surface action (a card/button) — routes it back to a verb's run(). */
	surfaceAction?: HomesteadSurfaceRenderActionHandler;
	/** Connect the browser runtime to an external daemon over WebSocket for live CRDT sync. */
	connectBrowserSync?: boolean;
	/** Env metadata surfaced to the runtime (version/commit); optional. */
	envMetadata?: Record<string, string>;
	/**
	 * Override how the runtime is booted — the seam a jsdom render test uses to inject a
	 * mock tractor instead of opening real OPFS/SQLite + a browser Tractor. Production omits
	 * it and gets `bootStudioRuntime`. This is what makes "the surface actually mounts into
	 * the slot" testable without a real browser.
	 */
	bootRuntime?: (options: BootStudioRuntimeOptions) => Promise<StudioRuntime>;
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
	const bootRuntime = options.bootRuntime ?? bootStudioRuntime;
	const runtime = await bootRuntime({
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

	// Accept a static context object as well as a provider: wrap the object so the shell
	// always gets a function. For a static object, merge `hostData` into its `data` so the
	// caller feeds content without hand-spreading `...base.data` in an arrow.
	let surfaceContext: HomesteadSurfaceRenderContextProvider | undefined;
	if (typeof options.surfaceContext === "function") {
		surfaceContext = options.surfaceContext;
	} else if (options.surfaceContext || options.hostData) {
		const base = (options.surfaceContext ?? {}) as HomesteadSurfaceRenderHostContext;
		const merged: HomesteadSurfaceRenderHostContext = options.hostData
			? {
					...base,
					data: {
						...(base.data as Record<string, unknown> | undefined),
						...options.hostData,
					},
				}
			: base;
		surfaceContext = () => merged;
	}

	const shell = await setupStudioShell(runtime.tractor, {
		...(surfaceContext ? { surfaceContext } : {}),
		...(options.surfaceAction ? { surfaceAction: options.surfaceAction } : {}),
	});

	return {
		runtime,
		shell,
		surfacePluginIds: surfaces.map((surface) => surface.id),
	};
}
