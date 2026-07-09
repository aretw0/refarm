import {
	isCapabilityGroup,
	type CapabilityEntry,
	type CapabilityRegistry,
} from "@refarm.dev/cli/capabilities";

/**
 * The NEUTRAL surface model — the visual twin of the CLI/HTTP projectors. Where
 * `mountedCliCommands` reads the registry into Commander commands and `mountedHttpHandler`
 * into routes, `surfaceModel` reads it into a plain data structure that ANY visual
 * surface (a web UI, a TUI) renders. It is pure data (like the `records analyze`
 * envelope) — no HTML, no terminal, no run(). A verb declared once, carrying
 * `renderers.web` / `renderers.tui` / `transports.http`, appears on every visual
 * surface from that one declaration.
 *
 * A verb with no visual hint (no renderers.web/tui) is simply absent from the model —
 * projecting a hint is inert; the CLI/agent surfaces still reach it.
 */

/** A verb's hint for ONE surface — an OPEN record the projector for that surface
 * interprets. `web` reads `{ route, icon }`, `tui` reads `{ section, shortcut, icon }`,
 * a future `webxr` reads `{ anchor, mesh }` — the model never enumerates them. This is
 * ADR-085: surfaces are data, so a new surface adds a key, not a type field. */
export type SurfaceHint = Record<string, unknown>;

/** One verb as a surface item — its name/summary plus the OPEN map of the surfaces it
 * declared it belongs on. Each projector reads its own key from `surfaces`; the model
 * commits to no fixed surface set. The `section` is the group label (from the tui hint's
 * section, else "actions") kept at top level because grouping is cross-surface. */
export interface SurfaceItem {
	/** The verb name (the invocable id on the surface). */
	name: string;
	/** Human-readable summary — the card subtitle / row label. */
	summary: string;
	/** The section this item groups under (from renderers.tui.section, else "actions"). */
	section: string;
	/** The OPEN surface axis: which surfaces this verb declared, each with its hint.
	 * Keys are surface ids (`web`/`tui`/`http`/…/`webxr`); values are the surface's hint.
	 * A projector for surface `k` takes items where `surfaces[k]` is present. */
	surfaces: Record<string, SurfaceHint>;
}

/** A named group of surface items — a web section / a TUI palette section. */
export interface SurfaceSection {
	section: string;
	items: SurfaceItem[];
}

/** The full neutral surface model: sections (name-sorted) each with their items
 * (name-sorted), for a stable render across surfaces. */
export interface SurfaceModel {
	sections: SurfaceSection[];
}

/** The surfaces the model reads off a descriptor: `renderers.*` (presentation) and the
 * one transport a visual surface needs to INVOKE a verb, `transports.http`, folded in
 * under the `http` key. This is the ONLY place surface keys are gathered from a
 * descriptor; everything downstream reads the open `surfaces` map. Add a renderer key to
 * a verb and it flows through with zero changes here — the open axis in practice. */
function gatherSurfaces(entry: CapabilityEntry): Record<string, SurfaceHint> {
	const surfaces: Record<string, SurfaceHint> = {};
	// Every declared renderer is a surface, verbatim — no enumeration of known keys.
	for (const [key, hint] of Object.entries(entry.renderers ?? {})) {
		if (hint && typeof hint === "object") surfaces[key] = hint as SurfaceHint;
	}
	// The http transport is the invoke channel a visual surface pairs with its render.
	const http = entry.transports?.http;
	if (http?.path) {
		surfaces.http = { method: http.method ?? "POST", path: http.path };
	}
	return surfaces;
}

/** Whether a verb declares any VISUAL surface hint (any renderer). Verbs without one are
 * CLI/agent-only and absent from the visual model. */
function hasVisualHint(entry: CapabilityEntry): boolean {
	const renderers = entry.renderers ?? {};
	return Object.keys(renderers).length > 0;
}

/** Build the neutral surface item for a verb — its section plus the open surfaces map. */
function toSurfaceItem(entry: CapabilityEntry): SurfaceItem {
	const surfaces = gatherSurfaces(entry);
	const tuiSection = (surfaces.tui?.section as string | undefined) ?? undefined;
	return {
		name: entry.name,
		summary: entry.summary,
		section: tuiSection ?? "actions",
		surfaces,
	};
}

/**
 * Derive the neutral {@link SurfaceModel} from a mounted registry — a BLIND reader over
 * `registry.list()` of the verbs carrying any renderer. Grouped by section, everything
 * name-sorted. Every visual surface (web, tui, …) projects from THIS via
 * {@link projectSurface}; none re-reads the registry, so a verb registered once
 * (including a plugin-contributed one, or a NEW surface) lights up from one declaration.
 */
export function surfaceModel(registry: CapabilityRegistry): SurfaceModel {
	const bySection = new Map<string, SurfaceItem[]>();
	for (const entry of registry.list()) {
		// A group's sub-actions aren't individually in list(); the group itself carries
		// the renderers hint (its default action's surface). Treat the group as one item.
		if (!hasVisualHint(entry)) continue;
		const item = toSurfaceItem(entry);
		const list = bySection.get(item.section) ?? [];
		list.push(item);
		bySection.set(item.section, list);
	}
	const sections = [...bySection.entries()]
		.map(([section, items]) => ({
			section,
			items: items.sort((a, b) => a.name.localeCompare(b.name)),
		}))
		.sort((a, b) => a.section.localeCompare(b.section));
	return { sections };
}

/**
 * Project a surface model onto ONE surface's face: keep only items that declared they
 * belong on it (`surfaces[surface]` present), dropping now-empty sections. This is how a
 * projector reads its own items from the single neutral model instead of re-reading the
 * registry with a divergent rule — the fix for the surfaceModel(any-visual) vs
 * tuiSections(tui-only) drift, and the seam a new surface (webxr, voice) plugs into.
 */
export function projectSurface(model: SurfaceModel, surface: string): SurfaceModel {
	const sections = model.sections
		.map((section) => ({
			section: section.section,
			items: section.items.filter((item) => item.surfaces[surface] !== undefined),
		}))
		.filter((section) => section.items.length > 0);
	return { sections };
}

/** The TUI face — items that declared `renderers.tui`. The canonical replacement for a
 * bespoke tui-only registry re-read. */
export function tuiSurfaceModel(registry: CapabilityRegistry): SurfaceModel {
	return projectSurface(surfaceModel(registry), "tui");
}

/** The web face — items that declared `renderers.web`. */
export function webSurfaceModel(registry: CapabilityRegistry): SurfaceModel {
	return projectSurface(surfaceModel(registry), "web");
}

/** Convenience: is this registry entry a group? Re-exported so a surface renderer can
 * distinguish a group (which dispatches to sub-actions) from a bare verb. */
export function isSurfaceGroup(entry: CapabilityEntry): boolean {
	return isCapabilityGroup(entry);
}
