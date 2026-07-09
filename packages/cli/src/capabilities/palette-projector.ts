import { projectSurface, surfaceModel, type SurfaceModel } from "./surface-model.js";
import type { CapabilityRegistry } from "./registry.js";

/**
 * The palette projector — a command palette / quick-switcher (cmd-K) surface, built
 * over the OPEN surface axis (ADR-085). A verb opts in with `renderers.palette`; this
 * projects the palette face of the neutral surfaceModel into a flat, ranked list a
 * switcher paints. It is the first projector written on top of `projectSurface` rather
 * than re-reading the registry — the shape the projector registry will generalize.
 *
 * `palette` is a NEW surface: nothing in the core enumerates it. It flows through
 * `surfaceModel` verbatim (the open axis) and this projector reads its hints
 * (`group` / `keybind` / `hint`). Adding it required ZERO edits to surfaceModel or any
 * other projector — the daily-driver proof that a domain can reach a new surface from
 * one declaration.
 */

/** One entry in the palette — a verb the switcher can jump to. */
export interface PaletteEntry {
	/** The verb name (what the switcher invokes). */
	name: string;
	/** Human-readable label — the switcher row. */
	summary: string;
	/** The palette group this verb sorts under (from `renderers.palette.group`). */
	group: string;
	/** An optional keybinding the switcher can bind (`renderers.palette.keybind`). */
	keybind?: string;
	/** Optional extra guidance shown in the switcher (`renderers.palette.hint`). */
	hint?: string;
}

/** The palette projection — entries grouped, each group and its entries name-sorted for
 * a stable switcher. Pure data; a terminal, web, or XR switcher renders it. */
export interface PaletteModel {
	groups: { group: string; entries: PaletteEntry[] }[];
}

function paletteEntry(name: string, summary: string, hint: Record<string, unknown>): PaletteEntry {
	const group = typeof hint.group === "string" ? hint.group : "commands";
	return {
		name,
		summary,
		group,
		...(typeof hint.keybind === "string" ? { keybind: hint.keybind } : {}),
		...(typeof hint.hint === "string" ? { hint: hint.hint } : {}),
	};
}

/**
 * Project the palette face of a registry: verbs that declared `renderers.palette`,
 * grouped and sorted. A verb with no `palette` hint is simply absent — projecting is
 * inert data, never a run().
 */
export function buildPaletteModel(registry: CapabilityRegistry): PaletteModel {
	const face: SurfaceModel = projectSurface(surfaceModel(registry), "palette");
	const byGroup = new Map<string, PaletteEntry[]>();
	for (const section of face.sections) {
		for (const item of section.items) {
			const hint = item.surfaces.palette ?? {};
			const entry = paletteEntry(item.name, item.summary, hint);
			const list = byGroup.get(entry.group) ?? [];
			list.push(entry);
			byGroup.set(entry.group, list);
		}
	}
	const groups = [...byGroup.entries()]
		.map(([group, entries]) => ({
			group,
			entries: entries.sort((a, b) => a.name.localeCompare(b.name)),
		}))
		.sort((a, b) => a.group.localeCompare(b.group));
	return { groups };
}
