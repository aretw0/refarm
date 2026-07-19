import { validateCapabilityArgs } from "@refarm.dev/capabilities";
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
	CAPABILITY_ACTION_RESULT_KEY,
	type CapabilityActionResult,
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
 * an empty field is omitted, a checkbox contributes only when checked. Runs in the browser. Pass the
 * exact `card` element (e.g. the submitted `<form>`) to scope collection to it — the conversation form
 * path, where several forms for the same verb may coexist; omit it to find the card by verb. */
export function collectVerbInput(
	verb: string,
	card?: Element | null,
): {
	args: Record<string, string>;
	options: Record<string, string | boolean>;
} {
	const args: Record<string, string> = {};
	const options: Record<string, string | boolean> = {};
	if (card === undefined && typeof document === "undefined") return { args, options };
	if (card === undefined) {
		const escaped = typeof CSS !== "undefined" && CSS.escape ? CSS.escape(verb) : verb.replace(/"/g, '\\"');
		card = document.querySelector(`[data-refarm-verb="${escaped}"]`);
	}
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

/** Run a card-dispatched verb and reduce its envelope to the {@link CapabilityActionResult} the
 * panel paints. The HTML comes from the verb's declared `renderers.web.resultField` (a search verb
 * says its matches live in `resultsHtml`), else the envelope's own `html`, else the first
 * `*Html`-suffixed string field it carries — so a content verb (walletHtml, sovereigntyHtml,
 * governanceHtml) paints its render on a click WITHOUT declaring resultField. When there is no HTML
 * at all the click still yields an `ok`/`message` status so it is never silent. A verb that needs
 * missing input returns an error envelope — surfaced here as its message, not swallowed. */
export async function runVerbForResult(
	entry: { run: (input: CapabilityInput) => unknown; renderers?: { web?: { resultField?: string } } },
	verb: string,
	input: { args: Record<string, string>; options: Record<string, string | boolean> },
): Promise<CapabilityActionResult> {
	let envelope: Record<string, unknown>;
	try {
		envelope = (await entry.run({ ...input, json: true })) as Record<string, unknown>;
	} catch (error) {
		return { verb, ok: false, message: error instanceof Error ? error.message : String(error) };
	}
	// A contract-conforming verb always returns an object; tolerate a null/undefined return (the
	// pre-B2 loop discarded the result entirely) rather than throwing an uncaught TypeError below.
	if (envelope == null || typeof envelope !== "object") return { verb, ok: true, message: "OK" };
	const ok = envelope.ok !== false;
	const resultField = entry.renderers?.web?.resultField;
	const declared = resultField && typeof envelope[resultField] === "string" ? (envelope[resultField] as string) : undefined;
	const html =
		declared ??
		(typeof envelope.html === "string" ? envelope.html : undefined) ??
		firstHtmlField(envelope);
	if (html) return { verb, ok, html };
	const message = typeof envelope.message === "string" ? envelope.message : typeof envelope.error === "string" ? envelope.error : ok ? "OK" : "Falhou";
	return { verb, ok, message };
}

/** The first `*Html`-suffixed string field on an envelope (insertion order) — the generic content
 * seam so a verb that renders HTML need not also declare `renderers.web.resultField`. */
function firstHtmlField(envelope: Record<string, unknown>): string | undefined {
	for (const [key, value] of Object.entries(envelope)) {
		if (/Html$/.test(key) && typeof value === "string") return value;
	}
	return undefined;
}

/**
 * Wire a container so any capability form submitted inside it (a `renderCapabilityFormMessage` form)
 * collects its TYPED input from that exact form, runs the verb, and reports the result to `onResult` —
 * the seam that lets a conversation dispatch an inline form the agent offered: the host appends the
 * result as a message. Event-delegated on the container (a form added later is covered), scoped to the
 * submitted form (several forms of the same verb can coexist). Returns a detach fn. Runs in the browser.
 */
/** Paint each validation error next to its field: a `data-refarm-field-error` note after the matching
 * `data-refarm-arg`/`data-refarm-option` input (a whole-input error goes at the form's end), so the form
 * stays open with inline, field-scoped feedback. Surface-neutral field/message from the shared validator. */
function paintFieldErrors(form: HTMLFormElement, errors: readonly { field: string; message: string }[]): void {
	const doc = form.ownerDocument;
	const esc = (v: string) => (typeof CSS !== "undefined" && CSS.escape ? CSS.escape(v) : v.replace(/"/g, '\\"'));
	for (const error of errors) {
		const note = doc.createElement("p");
		note.className = "refarm-error";
		note.setAttribute("data-refarm-field-error", error.field);
		note.textContent = error.field ? `${error.field}: ${error.message}` : error.message;
		const target = error.field
			? form.querySelector(`[data-refarm-arg="${esc(error.field)}"], [data-refarm-option="${esc(error.field)}"]`)
			: null;
		if (target) target.insertAdjacentElement("afterend", note);
		else form.appendChild(note);
	}
}

export function wireCapabilityFormDispatch(
	container: HTMLElement,
	registry: CapabilityRegistry,
	onResult: (verb: string, result: CapabilityActionResult) => void | Promise<void>,
): () => void {
	const handler = (event: Event): void => {
		const form = (event.target as HTMLElement | null)?.closest?.("form.refarm-capability-form") as HTMLFormElement | null;
		if (!form) return;
		event.preventDefault();
		const verb = form.getAttribute("data-refarm-verb");
		if (!verb) return;
		const entry = registry.get(verb);
		if (!entry || !("run" in entry) || typeof entry.run !== "function") return;
		const input = collectVerbInput(verb, form);
		// Validate the collected input against the verb's DERIVED JSON Schema (the same schema the agent
		// tool exposes) BEFORE dispatch — so a form rejects bad input the way a CLI or a tool call would.
		// On failure, report the field-scoped errors through the existing result seam and block the run.
		// Clear any errors painted on a previous submit before re-validating.
		form.querySelectorAll("[data-refarm-field-error]").forEach((el) => el.remove());
		const validation = validateCapabilityArgs(
			entry as unknown as Parameters<typeof validateCapabilityArgs>[0],
			{ ...input.args, ...input.options },
		);
		if (!validation.valid) {
			// Paint each error next to its field so the form stays open with inline, fixable feedback.
			paintFieldErrors(form, validation.errors);
			const detail = validation.errors
				.map((e) => (e.field ? `${e.field} ${e.message}` : e.message))
				.join("; ");
			void Promise.resolve(onResult(verb, { verb, ok: false, message: `Invalid input: ${detail}` }));
			return;
		}
		void runVerbForResult(
			entry as { run: (i: CapabilityInput) => unknown; renderers?: { web?: { resultField?: string } } },
			verb,
			input,
		).then((result) => onResult(verb, result));
	};
	container.addEventListener("submit", handler);
	return () => container.removeEventListener("submit", handler);
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
	// card runs its verb, its result is painted into the action-result region, the content verb
	// re-runs, and the surface re-renders in place — inert launcher cards become a live query→result
	// loop. Args typed into the card's inputs reach the verb (collectVerbInput), so a search shows
	// its matches, not just a refreshed dashboard.
	const defaultSurfaceAction: HomesteadSurfaceRenderActionHandler = async (request) => {
		const verb = request.action?.id;
		if (!verb) return false;
		const entry = registry.get(verb);
		if (!entry || !("run" in entry) || typeof entry.run !== "function") return false;
		// Collect what the persona typed into this verb's card (empty for a no-arg verb).
		const { args, options } = collectVerbInput(verb);
		const actionResult = await runVerbForResult(entry, verb, { args, options });
		// Recompute the dashboard content (a mutating verb may have changed it) AND carry the just-run
		// verb's own result — both land on host.data for the panel to paint.
		liveData = { ...(await computeContent()), [CAPABILITY_ACTION_RESULT_KEY]: actionResult };
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

export interface MountCapabilityWebFaceOptions extends BootCapabilityWebFaceOptions {
	/** The loading-overlay element id to remove once the face boots (default "loading-overlay"). */
	overlayId?: string;
	/** Prefix for the console error + the overlay's failure message (e.g. "Falha ao abrir a busca").
	 * Given a page's own language, so the overlay reads naturally on failure. */
	errorLabel?: string;
}

/** Options every overlay-owning mount shares — the page's loading lifecycle knobs. */
interface LoadingOverlayOptions {
	/** Namespace, used to prefix the console error on a boot crash. */
	namespace: string;
	/** The loading-overlay element id to remove once the face boots (default "loading-overlay"). */
	overlayId?: string;
	/** Prefix for the console error + the overlay's failure message (e.g. "Falha ao abrir a busca").
	 * Given a page's own language, so the overlay reads naturally on failure. */
	errorLabel?: string;
}

/**
 * Own the page's loading overlay around a boot `body`: remove the `#loading-overlay` on success,
 * and on failure log + paint the error into that overlay (so a boot crash is never a blank spinner).
 * The single lifecycle both `mountCapabilityWebFace` (card panel) and `mountCapabilityWebView`
 * (custom substrate view) share — a face author gets overlay-removal + error-painting for free
 * whichever mount they pick, and the two mounts cannot drift on how a boot failure looks.
 */
async function withLoadingOverlay(options: LoadingOverlayOptions, body: () => Promise<void>): Promise<void> {
	const overlayId = options.overlayId ?? "loading-overlay";
	const errorLabel = options.errorLabel ?? "Falha ao abrir";
	const overlay = typeof document !== "undefined" ? document.getElementById(overlayId) : null;
	try {
		await body();
		overlay?.remove();
	} catch (error) {
		console.error(`[${options.namespace}] web face boot failed`, error);
		if (overlay) {
			overlay.textContent = `${errorLabel}: ${error instanceof Error ? error.message : String(error)}`;
		}
	}
}

/**
 * Boot a capability web face AND own the page's loading lifecycle — the whole example boot.ts, in
 * one call. It removes the `#loading-overlay` on success and, on failure, logs + paints the error
 * into that overlay (so a boot crash is never a blank spinner). This is the seam every example's
 * `<page>-boot.ts` reduces to: build a browser-safe registry, then `mountCapabilityWebFace(...)` —
 * no hand-rolled overlay try/catch per face (see each example's `src/web` boot modules). A new face is a
 * browser-safe registry + one call here + an Astro page, so faces proliferate WITHOUT copy-pasting
 * boot boilerplate that could drift. Runs in the BROWSER; call it from an Astro page's <script>.
 */
export async function mountCapabilityWebFace(options: MountCapabilityWebFaceOptions): Promise<void> {
	await withLoadingOverlay(options, async () => {
		await bootCapabilityWebFace(options);
	});
}

/** How a custom-view face renders its verb result into a mount element (the substrate view). */
export interface CapabilityWebView<TResult = Record<string, unknown>> {
	/** The element id to render the view into (e.g. "graph-mount", "lab-mount"). */
	mount: string;
	/** Render the (non-empty) content into the mount. `result` is the content verb's result, or
	 * `undefined` when no `content` verb is declared (a view that reads the registry itself, e.g. a
	 * live journey). Runs in the browser; may be async (mounting an interactive substrate). */
	render: (context: { result: TResult; mount: HTMLElement; registry: CapabilityRegistry }) => void | Promise<void>;
	/** True when the content result is "empty" → paint `emptyHtml` into the mount INSTEAD of render
	 * (e.g. no requirements pulled yet). Only consulted when a `content` verb ran. */
	isEmpty?: (result: TResult) => boolean;
	/** HTML painted into the mount when `isEmpty(result)` is true — the graceful empty state. */
	emptyHtml?: string;
}

export interface MountCapabilityWebViewOptions<TResult = Record<string, unknown>> extends LoadingOverlayOptions {
	/** The browser-safe capability registry whose verb produces the view's data. */
	registry: CapabilityRegistry;
	/** Run this verb for the view's content, then hand its result to `view.render`. Omit for a view
	 * that reads the registry itself (render gets `result: undefined` + the registry). */
	content?: CapabilityWebFaceContent;
	/** The custom substrate view — where the result lands and how it renders. */
	view: CapabilityWebView<TResult>;
}

/**
 * Mount a capability web face whose body is a CUSTOM substrate view rather than the capability card
 * panel — an interactive graph, a lab gallery, a live consent journey. It owns the SAME loading
 * lifecycle as `mountCapabilityWebFace` (overlay removal + error painting via {@link withLoadingOverlay}),
 * plus the "run one verb → guard empty → render into a mount element" shape those faces all hand-rolled:
 *
 *   await mountCapabilityWebView({
 *     namespace: "reqbench-t3",
 *     registry: createGraphWebRegistry(),
 *     content: { verb: "requirements-graph" },
 *     view: {
 *       mount: "graph-mount",
 *       isEmpty: (r) => !r.graph || r.graph.nodes.length === 0,
 *       emptyHtml: `<p class="refarm-muted">Nenhum requisito ainda…</p>`,
 *       render: ({ result, mount }) => mountGraph(mount, result.graph, { … }),
 *     },
 *   });
 *
 * The example writes no overlay try/catch, no registry-run boilerplate, no missing-mount guard — only
 * the substrate render. A verb result that `isEmpty` paints `emptyHtml` and still clears the overlay
 * (a graceful empty state, not an error). Runs in the BROWSER; call it from an Astro page's <script>.
 */
export async function mountCapabilityWebView<TResult = Record<string, unknown>>(
	options: MountCapabilityWebViewOptions<TResult>,
): Promise<void> {
	await withLoadingOverlay(options, async () => {
		const mount = typeof document !== "undefined" ? document.getElementById(options.view.mount) : null;
		if (!mount) throw new Error(`no #${options.view.mount} element to mount the view into`);

		let result = undefined as TResult;
		if (options.content) {
			const entry = options.registry.get(options.content.verb);
			if (!entry || !("run" in entry) || typeof entry.run !== "function") {
				throw new Error(`${options.content.verb} verb not found in the registry`);
			}
			const input: CapabilityInput = options.content.input ?? { args: {}, options: {}, json: true };
			result = (await entry.run(input)) as unknown as TResult;
			if (options.view.isEmpty?.(result)) {
				mount.innerHTML = options.view.emptyHtml ?? "";
				return;
			}
		}
		await options.view.render({ result, mount, registry: options.registry });
	});
}
