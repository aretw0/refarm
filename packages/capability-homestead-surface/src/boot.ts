import type { CapabilityInput, CapabilityRegistry } from "@refarm.dev/capabilities";
import {
	bootCapabilityWebShell,
	type BootCapabilityWebShellOptions,
	type CapabilityWebShell,
} from "@refarm.dev/homestead/sdk/boot-web-shell";
import type {
	HomesteadSurfaceRenderActionHandler,
	HomesteadSurfaceRenderContextProvider,
	HomesteadSurfaceRenderHostContext,
} from "@refarm.dev/homestead/sdk/surface-renderer";

import {
	capabilityWebSurfaceActions,
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

/** Collect a verb's form input from its rendered card (`[data-refarm-verb]`) — the args + options
 * a persona typed before clicking Run. Reads `[data-refarm-arg]` / `[data-refarm-option]` inputs;
 * an empty field is omitted, a checkbox contributes only when checked. Runs in the browser. */
function collectVerbInput(verb: string): {
	args: Record<string, string>;
	options: Record<string, string | boolean>;
} {
	const args: Record<string, string> = {};
	const options: Record<string, string | boolean> = {};
	if (typeof document === "undefined") return { args, options };
	const escaped = typeof CSS !== "undefined" && CSS.escape ? CSS.escape(verb) : verb.replace(/"/g, '\\"');
	const card = document.querySelector(`[data-refarm-verb="${escaped}"]`);
	if (!card) return { args, options };
	card.querySelectorAll<HTMLInputElement>("[data-refarm-arg]").forEach((el) => {
		const name = el.getAttribute("data-refarm-arg");
		if (name && el.value !== "") args[name] = el.value;
	});
	card.querySelectorAll<HTMLInputElement>("[data-refarm-option]").forEach((el) => {
		const name = el.getAttribute("data-refarm-option");
		if (!name) return;
		if (el.type === "checkbox") {
			if (el.checked) options[name] = true;
		} else if (el.value !== "") {
			options[name] = el.value;
		}
	});
	return { args, options };
}

export async function bootCapabilityWebFace(
	options: BootCapabilityWebFaceOptions,
): Promise<CapabilityWebShell> {
	const registry = options.registry;

	// Run the content verb → the (field of its) result. Re-runnable, so a dispatched action can
	// refresh the surface's content after mutating state.
	const computeContent = async (): Promise<Record<string, unknown>> => {
		if (!options.content) return {};
		const entry = registry.get(options.content.verb);
		if (!entry || !("run" in entry) || typeof entry.run !== "function") return {};
		const input: CapabilityInput = options.content.input ?? { args: {}, options: {}, json: true };
		const result = (await entry.run(input)) as unknown as Record<string, unknown>;
		return options.content.field ? { [options.content.field]: result[options.content.field] ?? "" } : result;
	};

	let liveData: Record<string, unknown> = await computeContent();
	// The verb actions the shell wires clicks to (id === verb name). Without these on the host
	// context the shell never attaches a click handler, so the cards stay inert.
	const actions = capabilityWebSurfaceActions(registry);

	// A pre-built handle has an `id`; plain options don't. Reuse the handle, or build one.
	const surface =
		options.surface && "id" in options.surface
			? (options.surface as SurfacePluginHandle)
			: createCapabilityWebSurfacePlugin(
					options.registry,
					(options.surface as CapabilityWebSurfaceOptions | undefined) ?? {},
				);

	// A PROVIDER context: each render (including a rerender()) reads the CURRENT liveData + actions,
	// so a dispatched action's refreshed content shows up. Wraps whatever surfaceContext the caller
	// passed (object or provider).
	const baseCtx = options.surfaceContext;
	const surfaceContext: HomesteadSurfaceRenderContextProvider = async (request) => {
		const base = (
			typeof baseCtx === "function" ? ((await baseCtx(request)) ?? {}) : (baseCtx ?? {})
		) as HomesteadSurfaceRenderHostContext;
		return {
			...base,
			data: { ...(base.data as Record<string, unknown> | undefined), ...liveData },
			actions,
		};
	};

	// Late-bound so the default dispatch handler can rerender the shell it is part of (the handler is
	// passed INTO the boot below, before the shell exists — a ref holder breaks the chicken-and-egg).
	const shellRef: { current?: CapabilityWebShell } = {};

	// THE DISPATCH LOOP (the default; a caller can override with its own surfaceAction). A clicked
	// card runs its verb, the content verb re-runs, and the surface re-renders in place — inert
	// launcher cards become a live action loop. Verbs that need arguments run with empty args here
	// (a minimal input form is a follow-on); their envelope simply reports what they need.
	const defaultSurfaceAction: HomesteadSurfaceRenderActionHandler = async (request) => {
		const verb = request.action?.id;
		if (!verb) return false;
		const entry = registry.get(verb);
		if (!entry || !("run" in entry) || typeof entry.run !== "function") return false;
		// Collect what the persona typed into this verb's card (empty for a no-arg verb).
		const { args, options } = collectVerbInput(verb);
		try {
			await entry.run({ args, options, json: true });
		} catch {
			// A verb that needs input throws/returns an error envelope; the refresh below still runs.
		}
		liveData = await computeContent();
		await shellRef.current?.shell.rerender();
		return true;
	};

	shellRef.current = await bootCapabilityWebShell({
		databaseName: options.databaseName,
		namespace: options.namespace,
		...(options.identityId ? { identityId: options.identityId } : {}),
		surfaces: [surface as never],
		surfaceContext,
		surfaceAction: options.surfaceAction ?? defaultSurfaceAction,
		...(options.connectBrowserSync ? { connectBrowserSync: options.connectBrowserSync } : {}),
		...(options.envMetadata ? { envMetadata: options.envMetadata } : {}),
		...(options.bootRuntime ? { bootRuntime: options.bootRuntime } : {}),
	});
	return shellRef.current;
}
