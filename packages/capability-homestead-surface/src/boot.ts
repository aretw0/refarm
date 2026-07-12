import {
	webSurfaceModel,
	type CapabilityInput,
	type CapabilityRegistry,
} from "@refarm.dev/capabilities";
import {
	bootCapabilityWebShell,
	type BootCapabilityWebShellOptions,
	type CapabilityWebShell,
} from "@refarm.dev/homestead/sdk/boot-web-shell";

import {
	createCapabilityWebSurfacePlugin,
	type CapabilityWebSurfaceOptions,
} from "./index.js";

/**
 * The BOOT entry — a separate module from index.ts on purpose. bootCapabilityWebFace pulls
 * the full Homestead shell (bootStudioRuntime + StudioShell + l8n), so importing the
 * lightweight `createCapabilityWebSurfacePlugin` projector (index.ts) must NOT drag all that
 * in. Keeping the boot here means a persona that only projects a surface stays cheap; only an
 * app's browser boot.ts pays for the shell.
 *
 * Boot a capability app's WEB FACE in one call — the whole example boot, absorbed. Given a
 * registry (+ optionally a verb to run for content), it runs the verb, builds/reuses the web
 * surface, and boots the Homestead shell with the verb's content merged into host.data. With
 * it, an app's boot.ts is a handful of lines — no hand-run verb, no surfaceContext arrow, no
 * bootCapabilityWebShell wiring:
 *
 *   await bootCapabilityWebFace({
 *     databaseName: "wallet-web", namespace: "wallet",
 *     registry: walletApp.registry(),
 *     surfaceContext: walletApp.surfaceContext(),
 *     content: { verb: "wallet", field: "walletHtml" },   // run `wallet`, feed walletHtml
 *     surface: walletWebSurface(registry),                 // reuse the declared surface
 *   });
 *
 * Runs in the BROWSER (it boots a browser runtime); call it from an Astro page's <script>.
 */
type SurfacePluginHandle = BootCapabilityWebShellOptions["surfaces"] extends (infer T)[]
	? T
	: never;

export interface CapabilityWebFaceContent {
	/** The verb to run for the surface's content (e.g. "wallet", "requirements"). */
	verb: string;
	/** The projected field of that verb's result to inject into host.data (e.g. "walletHtml").
	 * Defaults to the whole result if omitted. */
	field?: string;
	/** The input passed to the verb run. Defaults to `{ args:{}, options:{}, json:true }`. */
	input?: CapabilityInput;
}

export interface BootCapabilityWebFaceOptions {
	databaseName: string;
	namespace: string;
	identityId?: string;
	/** The capability registry whose web verbs become the surface. */
	registry: CapabilityRegistry;
	/** Static host context (typically `host.surfaceContext()`). */
	surfaceContext?: BootCapabilityWebShellOptions["surfaceContext"];
	/** Run this verb and merge its (field of) result into host.data — the content seam. */
	content?: CapabilityWebFaceContent;
	/**
	 * How to build the web surface. Either options forwarded to
	 * `createCapabilityWebSurfacePlugin`, OR a pre-built handle (e.g. the `xWebSurface(reg)` an
	 * app already declares with its own content seam) so it isn't re-specified here.
	 */
	surface?: CapabilityWebSurfaceOptions | SurfacePluginHandle;
	/** Forwarded to the shell. */
	surfaceAction?: BootCapabilityWebShellOptions["surfaceAction"];
	connectBrowserSync?: boolean;
	envMetadata?: Record<string, string>;
	/** Test seam: inject a runtime boot (a mock tractor) instead of the real browser one. */
	bootRuntime?: BootCapabilityWebShellOptions["bootRuntime"];
}

export async function bootCapabilityWebFace(
	options: BootCapabilityWebFaceOptions,
): Promise<CapabilityWebShell> {
	let hostData: Record<string, unknown> | undefined;
	if (options.content) {
		const entry = options.registry.get(options.content.verb);
		if (entry && "run" in entry && typeof entry.run === "function") {
			const input: CapabilityInput = options.content.input ?? {
				args: {},
				options: {},
				json: true,
			};
			const result = (await entry.run(input)) as unknown as Record<string, unknown>;
			hostData = options.content.field
				? { [options.content.field]: result[options.content.field] ?? "" }
				: result;
		}
	}

	// A pre-built handle has an `id`; plain options don't. Reuse the handle, or build one.
	const surface =
		options.surface && "id" in options.surface
			? (options.surface as SurfacePluginHandle)
			: createCapabilityWebSurfacePlugin(
					options.registry,
					(options.surface as CapabilityWebSurfaceOptions | undefined) ?? {},
				);

	return bootCapabilityWebShell({
		databaseName: options.databaseName,
		namespace: options.namespace,
		...(options.identityId ? { identityId: options.identityId } : {}),
		surfaces: [surface as never],
		...(options.surfaceContext ? { surfaceContext: options.surfaceContext } : {}),
		...(hostData ? { hostData } : {}),
		...(options.surfaceAction ? { surfaceAction: options.surfaceAction } : {}),
		...(options.connectBrowserSync ? { connectBrowserSync: options.connectBrowserSync } : {}),
		...(options.envMetadata ? { envMetadata: options.envMetadata } : {}),
		...(options.bootRuntime ? { bootRuntime: options.bootRuntime } : {}),
	});
}
