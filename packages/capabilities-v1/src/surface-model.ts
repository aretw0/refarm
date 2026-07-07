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

/** One verb as a visual surface item — the neutral shape a web card or TUI row paints. */
export interface SurfaceItem {
	/** The verb name (the invocable id on the surface). */
	name: string;
	/** Human-readable summary — the card subtitle / row label. */
	summary: string;
	/** The section this item groups under (from renderers.tui.section, else "actions"). */
	section: string;
	/** An icon token (renderers.web.icon ?? renderers.tui.icon) — a theme/icon name. */
	icon?: string;
	/** A TUI keybinding (renderers.tui.shortcut), for a TUI surface only. */
	shortcut?: string;
	/** The web route this verb mounts at (renderers.web.route), for a web surface. */
	route?: string;
	/** The HTTP method+path the verb serves (transports.http) — how a web surface
	 * INVOKES it (the same endpoint mountedHttpHandler serves). */
	http?: { method: string; path: string };
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

/** Whether a verb declares any VISUAL surface hint (web or tui). Verbs without one are
 * CLI/agent-only and absent from the visual model. */
function hasVisualHint(entry: CapabilityEntry): boolean {
	return entry.renderers?.web !== undefined || entry.renderers?.tui !== undefined;
}

/** Build the neutral surface item for a verb from its declared hints. */
function toSurfaceItem(entry: CapabilityEntry): SurfaceItem {
	const web = entry.renderers?.web;
	const tui = entry.renderers?.tui;
	const http = entry.transports?.http;
	return {
		name: entry.name,
		summary: entry.summary,
		section: tui?.section ?? "actions",
		...(web?.icon ?? tui?.icon ? { icon: web?.icon ?? tui?.icon } : {}),
		...(tui?.shortcut ? { shortcut: tui.shortcut } : {}),
		...(web?.route ? { route: web.route } : {}),
		...(http?.path
			? { http: { method: http.method ?? "POST", path: http.path } }
			: {}),
	};
}

/**
 * Derive the neutral {@link SurfaceModel} from a mounted registry — a BLIND reader over
 * `registry.list()` of only the verbs carrying a visual hint. Grouped by section,
 * everything name-sorted. Both the web UI and the TUI render from THIS; neither
 * re-reads the registry, so a verb registered once (including a plugin-contributed one)
 * lights up on both from a single declaration.
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

/** Convenience: is this registry entry a group? Re-exported so a surface renderer can
 * distinguish a group (which dispatches to sub-actions) from a bare verb. */
export function isSurfaceGroup(entry: CapabilityEntry): boolean {
	return isCapabilityGroup(entry);
}
