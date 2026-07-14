import type { CapabilityRegistry } from "./registry.js";
import { projectSurface, surfaceModel, type SurfaceModel } from "./surface-model.js";

/**
 * The IDE projector — the editor face of the declare-once capability projection. Where the CLI
 * projector mints Commander commands and the palette projector a cmd-K list, this projects the
 * registry into the model a code editor's extension renders: a set of invocable COMMANDS (VS
 * Code / JetBrains "commands") plus a grouped TREE the editor paints in a side panel. Sibling of
 * cli-/http-/agent-/palette-projector — the same declaration, a new surface.
 *
 * A verb opts in via `renderers.ide` (an open hint: `{ group, command, icon }`); with no hint a
 * verb falls back to its `tui.section` grouping so an app gets a reasonable IDE tree for free.
 * Projecting is inert DATA — the editor extension binds each command to a `refarm`/app invocation;
 * this never runs anything.
 */

/** One editor command the extension registers + a tree row that invokes it. */
export interface IdeCommand {
	/** The verb name — what the editor invokes (e.g. via `refarm <name>` or the app CLI). */
	name: string;
	/** The command id the editor registers (namespaced, e.g. `devbench.agent-run`). */
	commandId: string;
	/** The human title shown in the palette / tree row. */
	title: string;
	/** The tree group (a side-panel section). */
	group: string;
	/** An optional themable icon id (`renderers.ide.icon`). */
	icon?: string;
}

/** The IDE projection — commands grouped into a tree an editor extension paints. Pure data. */
export interface IdeModel {
	/** The namespace the command ids are minted under (the app command). */
	namespace: string;
	/** Every command, flat (the extension registers each). */
	commands: IdeCommand[];
	/** The same commands grouped into tree sections, group- and name-sorted. */
	tree: { group: string; commands: IdeCommand[] }[];
}

function str(hint: Record<string, unknown>, key: string): string | undefined {
	const v = hint[key];
	return typeof v === "string" ? v : undefined;
}

/**
 * Project the IDE face of a registry: every verb, as an editor command + a tree row. A verb's
 * `renderers.ide` hint refines its group/title/icon/command-id; absent, it falls back to the verb
 * name + its `tui.section` group, so any app gets a usable IDE tree without extra declaration.
 * `namespace` prefixes the command ids (the app's command, e.g. "dgk"). PURE.
 */
export function buildIdeModel(registry: CapabilityRegistry, namespace = "refarm"): IdeModel {
	// Take the whole surface (not just verbs that opted into an `ide` hint) so an app gets its full
	// command set in the editor; the `ide` hint only REFINES presentation.
	const model: SurfaceModel = surfaceModel(registry);
	const ideFace: SurfaceModel = projectSurface(model, "ide");
	// A quick lookup of the ide hint per verb (present only for opted-in verbs).
	const ideHint = new Map<string, Record<string, unknown>>();
	for (const section of ideFace.sections) {
		for (const item of section.items) ideHint.set(item.name, item.surfaces.ide ?? {});
	}

	const commands: IdeCommand[] = [];
	for (const section of model.sections) {
		for (const item of section.items) {
			const hint = ideHint.get(item.name) ?? {};
			const group = str(hint, "group") ?? item.section ?? "commands";
			const command: IdeCommand = {
				name: item.name,
				commandId: str(hint, "command") ?? `${namespace}.${item.name}`,
				title: str(hint, "title") ?? (item.summary || item.name),
				group,
				...(str(hint, "icon") ? { icon: str(hint, "icon")! } : {}),
			};
			commands.push(command);
		}
	}

	const byGroup = new Map<string, IdeCommand[]>();
	for (const c of commands) {
		const list = byGroup.get(c.group) ?? [];
		list.push(c);
		byGroup.set(c.group, list);
	}
	const tree = [...byGroup.entries()]
		.map(([group, cmds]) => ({ group, commands: cmds.sort((a, b) => a.name.localeCompare(b.name)) }))
		.sort((a, b) => a.group.localeCompare(b.group));

	return { namespace, commands: commands.sort((a, b) => a.name.localeCompare(b.name)), tree };
}
