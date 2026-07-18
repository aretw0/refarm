import { webSurfaceModel, type CapabilityRegistry } from "@refarm.dev/capabilities";
import { createHomesteadSurfacePluginHandle } from "@refarm.dev/homestead/sdk/plugin-handle";
import type {
	HomesteadSurfaceRenderRequest,
	HomesteadSurfaceRenderResult,
} from "@refarm.dev/homestead/sdk/surface-renderer";

/** The Homestead plugin handle shape — derived from the factory's return so we don't
 * pull @refarm.dev/runtime directly (the factory already produces a RuntimePluginHandle). */
type SurfacePluginHandle = ReturnType<typeof createHomesteadSurfacePluginHandle>;

/**
 * The capability → Homestead web bridge (ADR-085). A capability registry declares verbs
 * with `renderers.web`; this projects the WEB face of the neutral surfaceModel into a
 * real Homestead surface plugin — the panel a verb lights up in the Astro/Homestead shell
 * (apps/me, apps/dev) from its one declaration, with no hand-rolled HTML renderer.
 *
 * It is the projector that closes the web follow-on left when serveWebUi was removed: the
 * web is Astro + Homestead, and THIS is how a verb reaches it. The bridge lives in its own
 * package because it needs BOTH cli/capabilities (to read renderers.web) and homestead (to
 * mount) — a dependency homestead itself must not take (it stays a pure UI layer).
 */

export interface CapabilityWebSurfaceOptions {
	/** The plugin id the surface mounts under. */
	pluginId?: string;
	/** Human-readable plugin name. */
	name?: string;
	/** The Homestead slot to mount into (default "main"). */
	slot?: string;
	/** The surface id within the plugin (default "capability-web"). */
	surfaceId?: string;
	/** Panel heading shown above the verb cards. */
	title?: string;
	/**
	 * OPTIONAL content projector — render extra structured HTML ABOVE the verb cards from
	 * the host's per-render data (`request.host.data`). This is how a host shows a verb's
	 * actual CONTENT (a requirements Map of Content, a dashboard summary) and not just
	 * launcher cards, WITHOUT the bridge forking per app: the host runs its verb, puts the
	 * structured result on `host.data`, and this turns it into DS-styled HTML. Return "" to
	 * show cards only. Generic — every capability host reuses it (the higher-leverage seam
	 * than a per-example bespoke panel).
	 */
	content?: (data: Record<string, unknown>) => string;
}

const DEFAULTS = {
	pluginId: "@refarm.dev/capability-web-surface",
	name: "Capability Web Surface",
	slot: "main",
	surfaceId: "capability-web",
	title: "Capabilities",
} as const;

/**
 * The host.data key under which the boot dispatch loop stashes the LAST verb a persona ran
 * from a card, so the panel can paint its result ABOVE the launcher cards. A framework-owned
 * key (distinct from any app's content projector fields) — the seam that turns inert launcher
 * cards into a query→result loop (see boot.ts defaultSurfaceAction). */
export const CAPABILITY_ACTION_RESULT_KEY = "__refarmCapabilityActionResult";

/** The result of the last card-dispatched verb — what {@link renderCapabilityWebPanel} paints
 * into the action-result region. `html` is the verb's own projected render (from its
 * `renderers.web.resultField`, else the envelope's `html`); when neither exists the loop still
 * reports `ok` + `message` so a click is never silent. */
export interface CapabilityActionResult {
	/** The verb that ran. */
	verb: string;
	/** Whether its envelope reported success (`ok !== false`). */
	ok: boolean;
	/** The verb's projected HTML result, when it declares/carries one. Trusted as the verb's
	 * own render (already DS-shaped), not escaped. */
	html?: string;
	/** A one-line human status when there is no HTML to show (an error message, or a bare ok). */
	message?: string;
}

function escape(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

/** The RIGHT widget for a typed field: a `<select>` for an `enum`, a number field for `integer`/`number`,
 * else a text input. Shared by args AND options (a boolean option is a checkbox, handled by the caller).
 * The value reads back as a string — a select's chosen option, a number field's numeric string — so
 * `collectVerbInput` is unchanged; this only picks the widget from the declared type/enum. */
function typedInput(field: { dataAttr: string; placeholder: string; kind?: string; enumValues?: string[] }): string {
	if (field.enumValues && field.enumValues.length > 0) {
		const options = [
			`<option value="">${field.placeholder}</option>`,
			...field.enumValues.map((v) => `<option value="${escape(v)}">${escape(v)}</option>`),
		].join("");
		return `<select class="refarm-input" ${field.dataAttr}>${options}</select>`;
	}
	const numeric = field.kind === "number" || field.kind === "integer";
	const step = field.kind === "integer" ? ` step="1"` : "";
	return `<input class="refarm-input" type="${numeric ? "number" : "text"}"${step} ${field.dataAttr} placeholder="${field.placeholder}" />`;
}

/** Render the input fields for a verb's args + options (or "" when it takes none), so a card can
 * collect them before dispatching. Args AND non-boolean options become TYPED inputs by their declared
 * type (select for enum, number for integer/number, else text); a boolean option is a checkbox. The
 * boot dispatch handler reads these back by `data-refarm-arg` / `data-refarm-option` and passes them to
 * the verb's run(). */
function renderVerbInputs(registry: CapabilityRegistry, verbName: string): string {
	const entry = registry.get(verbName) as
		| {
				args?: Array<{ name: string; required?: boolean; type?: string; enum?: string[] }>;
				options?: Array<{ name: string; kind?: string; summary?: string; enum?: string[] }>;
		  }
		| undefined;
	const args = entry?.args ?? [];
	const options = entry?.options ?? [];
	if (args.length === 0 && options.length === 0) return "";
	const argInputs = args
		.map((a) =>
			typedInput({
				dataAttr: `data-refarm-arg="${escape(a.name)}"`,
				placeholder: `${escape(a.name)}${a.required ? " *" : ""}`,
				kind: a.type,
				enumValues: a.enum,
			}),
		)
		.join("");
	const optInputs = options
		.map((o) =>
			o.kind === "boolean"
				? `<label class="refarm-check"><input type="checkbox" data-refarm-option="${escape(o.name)}" /> --${escape(o.name)}</label>`
				: typedInput({
						dataAttr: `data-refarm-option="${escape(o.name)}"`,
						placeholder: `--${escape(o.name)}`,
						kind: o.kind,
						enumValues: o.enum,
					}),
		)
		.join("");
	return `${argInputs}${optInputs}`;
}

/** Render the registry's web verbs as DS-styled cards — one per verb, grouped by section.
 * Uses the shared DS classes (refarm-surface-card / refarm-stack / refarm-btn) so the
 * panel matches every other Homestead surface, no bespoke palette. */
/** Render the action-result region — the output of the last card-dispatched verb, shown ABOVE
 * the launcher cards so a query verb (search, materialize) SHOWS its result in place. Returns ""
 * when nothing has run yet. The verb's `html` is trusted as its own DS-shaped render; a bare
 * status (no html) is escaped. */
function renderActionResult(result: CapabilityActionResult | undefined): string {
	if (!result) return "";
	const body = result.html
		? result.html
		: `<p class="${result.ok ? "refarm-note" : "refarm-error"}">${escape(result.message ?? (result.ok ? "OK" : "Falhou"))}</p>`;
	return `<div class="refarm-surface-card refarm-stack" data-refarm-action-result data-refarm-action-verb="${escape(result.verb)}" data-refarm-action-ok="${result.ok}">
			<p class="refarm-eyebrow">${escape(result.verb)}</p>
			${body}
		</div>`;
}

function renderCapabilityWebPanel(
	registry: CapabilityRegistry,
	title: string,
	content = "",
	actionResult?: CapabilityActionResult,
): string {
	const model = webSurfaceModel(registry);
	const actionHtml = renderActionResult(actionResult);
	if (model.sections.length === 0 && !content && !actionHtml) {
		return `<section class="refarm-surface-card refarm-stack" data-capability-web-surface>
			<p class="refarm-eyebrow">${escape(title)}</p>
			<p>No verb declares a web surface yet. Add <code class="refarm-code">renderers.web</code> to a verb.</p>
		</section>`;
	}
	const sections = model.sections
		.map((section) => {
			const cards = section.items
				.map((item) => {
					const web = item.surfaces.web ?? {};
					const route = typeof web.route === "string" ? web.route : "";
					const http = item.surfaces.http as { method?: string; path?: string } | undefined;
					const endpoint = http?.path ? `${http.method ?? "POST"} ${http.path}` : "";
					const dataAttrs = `${route ? ` data-route="${escape(route)}"` : ""}${endpoint ? ` data-endpoint="${escape(endpoint)}"` : ""}`;
					const inputs = renderVerbInputs(registry, item.name);
					// A verb with no args/options stays a single clickable pill; one that takes input
					// becomes a small form (its fields collected on Run) — inert launchers no longer.
					if (!inputs) {
						return `<button type="button" class="refarm-btn refarm-btn-pill" data-refarm-surface-action-id="${escape(item.name)}"${dataAttrs}>
						<span class="refarm-card-name">${escape(item.name)}</span>
						<span class="refarm-card-summary">${escape(item.summary)}</span>
					</button>`;
					}
					return `<div class="refarm-stack" data-refarm-verb="${escape(item.name)}"${dataAttrs}>
						<span class="refarm-card-name">${escape(item.name)}</span>
						<span class="refarm-card-summary">${escape(item.summary)}</span>
						${inputs}
						<button type="button" class="refarm-btn refarm-btn-pill" data-refarm-surface-action-id="${escape(item.name)}">Run ${escape(item.name)}</button>
					</div>`;
				})
				.join("");
			return `<div class="refarm-stack" data-section="${escape(section.section)}">
				<p class="refarm-eyebrow">${escape(section.section)}</p>
				${cards}
			</div>`;
		})
		.join("");
	// Content (a verb's structured result — e.g. a MOC) renders ABOVE the launcher cards:
	// what the surface IS, then how to act on it. The content HTML is host-supplied and
	// already DS-shaped; it is trusted as the host's own render, not escaped here. The
	// action-result region sits between content and cards — a just-run verb's output shows
	// right where the persona is looking, then the cards to act again.
	return `<section class="refarm-surface-card refarm-stack" data-capability-web-surface>
		<p class="refarm-eyebrow">${escape(title)}</p>
		${content}
		${actionHtml}
		${sections}
	</section>`;
}

/** One action per web verb — the switcher/panel dispatches these back to the host. Mirrors
 * how apps/me surfaces actions, but derived from the registry, not hand-listed. */
function capabilityWebActions(registry: CapabilityRegistry) {
	return webSurfaceModel(registry).sections.flatMap((section) =>
		section.items.map((item) => ({
			id: item.name,
			label: item.name,
			intent: `capability:${item.name}`,
		})),
	);
}

/**
 * Build a Homestead surface plugin handle that renders a registry's web verbs. Register
 * the returned handle with a Homestead host (like apps/me does with its personal surface)
 * and the verbs appear as a panel — the web face of the open axis, mounted for real.
 */
export function createCapabilityWebSurfacePlugin(
	registry: CapabilityRegistry,
	options: CapabilityWebSurfaceOptions = {},
): SurfacePluginHandle {
	const pluginId = options.pluginId ?? DEFAULTS.pluginId;
	const name = options.name ?? DEFAULTS.name;
	const slot = options.slot ?? DEFAULTS.slot;
	const surfaceId = options.surfaceId ?? DEFAULTS.surfaceId;
	const title = options.title ?? DEFAULTS.title;

	return createHomesteadSurfacePluginHandle({
		id: pluginId,
		name,
		surfaces: [{ kind: "panel", id: surfaceId, slot, capabilities: ["ui:panel:render"] }],
		call: async (fn: string, args?: unknown): Promise<HomesteadSurfaceRenderResult> => {
			if (fn !== "renderHomesteadSurface") return null;
			// The host's per-render data (request.host.data) — where a host puts a verb's
			// structured result for the content projector to turn into HTML.
			const data = (args as HomesteadSurfaceRenderRequest | undefined)?.host?.data ?? {};
			const content = options.content ? options.content(data) : "";
			// The last card-dispatched verb's result (stashed by the boot dispatch loop under the
			// framework-owned key) — painted into the action-result region above the cards.
			const actionResult = data[CAPABILITY_ACTION_RESULT_KEY] as CapabilityActionResult | undefined;
			return { html: renderCapabilityWebPanel(registry, title, content, actionResult) };
		},
	});
}

/** The verb list a host wires to dispatch panel actions — exported so a host can route
 * a clicked card back to the capability's run(). */
export function capabilityWebSurfaceActions(registry: CapabilityRegistry) {
	return capabilityWebActions(registry);
}

export type { HomesteadSurfaceRenderRequest };
