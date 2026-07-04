import {
	createCapabilityRegistry,
	isCapabilityGroup,
	type CapabilityDescriptor,
	type CapabilityEntry,
	type CapabilityGroup,
} from "@refarm.dev/cli/capabilities";
import { RESERVED_SLASH_NAMES } from "@refarm.dev/cli/chat-repl";
import type { Command } from "commander";

import {
	toCommanderCommand,
	toCommanderGroup,
	type CapabilitySurfaceHooks,
} from "./capability-commander.js";
import {
	extensionReviewCapability,
	extensionReviewHooks,
} from "./extension-review-capability.js";
import {
	createModelCapabilityGroup,
	modelCapabilityHooks,
} from "./model-capability.js";
import {
	createSkillCapabilityGroup,
	skillCapabilityHooks,
} from "./skill-capability.js";

/**
 * A capability plus its surface hooks (text render + exit intent). A descriptor
 * carries ONE hook set; a group carries a per-sub-action `hooksFor`. Bundling the
 * entry with its hooks keeps the built-in set a single declarative list — the ONE
 * registration site the whole app (and every surface projector) derives from.
 */
type BuiltinCapability =
	| { entry: CapabilityDescriptor; hooks: CapabilitySurfaceHooks }
	| {
			entry: CapabilityGroup;
			hooksFor: (subVerb: string) => CapabilitySurfaceHooks;
	  };

/** The app's built-in capabilities, declared ONCE. New verbs are added here and
 * light up on every surface (CLI, REPL, TUI, and later HTTP/web) with no
 * per-surface wiring. */
const BUILTIN_CAPABILITIES: BuiltinCapability[] = [
	{ entry: extensionReviewCapability, hooks: extensionReviewHooks },
	{ entry: createModelCapabilityGroup(), hooksFor: modelCapabilityHooks },
	{ entry: createSkillCapabilityGroup(), hooksFor: skillCapabilityHooks },
];

/**
 * The one registry of tri-surface capabilities for this app, built from
 * {@link BUILTIN_CAPABILITIES} via the shared `createCapabilityRegistry` factory
 * (the SDK seam — the same call farmhand / apps/me / a third party uses to obtain
 * a live registry). Every declared verb is registered here once; the CLI, the
 * REPL slash, the TUI menu, and any direct alias are derived from it.
 */
export const capabilityRegistry = createCapabilityRegistry(
	BUILTIN_CAPABILITIES.map((c) => c.entry as CapabilityEntry),
	RESERVED_SLASH_NAMES,
);

/** Surface hooks (text render + exit intent) keyed by capability name. The REPL
 * dispatcher keys a group's hooks by the composite `"<group> <sub>"` name (see
 * chat.ts case "capability"), so each sub-action is indexed under that key for the
 * group's own verb AND each slash alias, matching the CLI group projector. */
const capabilityHooks = new Map<string, CapabilitySurfaceHooks>();
for (const builtin of BUILTIN_CAPABILITIES) {
	if ("hooks" in builtin) {
		const { entry, hooks } = builtin;
		capabilityHooks.set(entry.name.toLowerCase(), hooks);
		for (const alias of entry.transports?.repl?.slashAliases ?? []) {
			capabilityHooks.set(alias.toLowerCase(), hooks);
		}
		continue;
	}
	const { entry, hooksFor } = builtin;
	const verbs = [
		entry.name,
		...(entry.transports?.repl?.slashAliases ?? []),
	].map((name) => name.toLowerCase());
	for (const verb of verbs) {
		for (const subVerb of Object.keys(entry.actions)) {
			capabilityHooks.set(`${verb} ${subVerb.toLowerCase()}`, hooksFor(subVerb));
		}
	}
}

export function capabilityHooksFor(name: string): CapabilitySurfaceHooks {
	return capabilityHooks.get(name.toLowerCase()) ?? {};
}

/** Lowercased slash names the REPL parser should treat as capabilities. */
export function capabilitySlashNames(): ReadonlySet<string> {
	return new Set(
		capabilityRegistry.list().flatMap((descriptor) => [
			descriptor.name.toLowerCase(),
			...(descriptor.transports?.repl?.slashAliases ?? []).map((alias) =>
				alias.toLowerCase(),
			),
		]),
	);
}

/** Project ONE registered capability entry into a commander Command, wiring the
 * same surface hooks the REPL uses. A group binds each sub-action's hooks by the
 * composite `"<group> <sub>"` key; a flat descriptor binds by its own name. */
function toCliCommand(
	entry: CapabilityDescriptor | CapabilityGroup,
): Command {
	if (isCapabilityGroup(entry)) {
		return toCommanderGroup(entry, (subVerb) =>
			capabilityHooksFor(`${entry.name} ${subVerb}`),
		);
	}
	return toCommanderCommand(entry, capabilityHooksFor(entry.name));
}

/**
 * The TOP-LEVEL CLI commands derived from the capability registry — the CLI's
 * half of the declare-once projection (the REPL already derives its slashes from
 * the same registry). `program.ts` mounts these instead of hand-calling each
 * capability factory a second time, so registering a verb ONCE lights it up on
 * both the CLI and the REPL.
 *
 * Two `transports.cli` hints are honored here:
 *   - an entry WITHOUT `cli.group` is a top-level verb (model, skill).
 *   - an entry WITH `cli.group` mounts UNDER that parent (see
 *     {@link capabilityCliCommandsForGroup}) and is NOT top-level — UNLESS it
 *     also sets `cli.directAlias`, in which case a top-level forwarder is minted
 *     too (the verb reachable as both `<bin> <group> <verb>` and `<bin> <verb>`).
 */
export function capabilityCliCommands(): Command[] {
	return capabilityRegistry
		.list()
		.filter(
			(entry) =>
				entry.transports?.cli?.group === undefined ||
				entry.transports?.cli?.directAlias === true,
		)
		.map(toCliCommand);
}

/**
 * The CLI commands that declare `transports.cli.group === groupName` — the verbs
 * a parent command (e.g. `extension`) mounts as its own sub-commands. The parent
 * calls this to self-populate from the registry instead of hand-mounting each
 * capability, so a grouped verb (and later a plugin-contributed one) appears
 * under its parent from ONE declaration.
 */
export function capabilityCliCommandsForGroup(groupName: string): Command[] {
	return capabilityRegistry
		.list()
		.filter((entry) => entry.transports?.cli?.group === groupName)
		.map(toCliCommand);
}

/** One capability verb projected onto a TUI menu — the `renderers.tui` hint plus
 * the neutral name/summary a TUI shell paints into a palette section. */
export interface CapabilityTuiEntry {
	name: string;
	summary: string;
	shortcut?: string;
	icon?: string;
}

/** A TUI menu section (from `renderers.tui.section`) with its capability verbs. */
export interface CapabilityTuiSection {
	section: string;
	entries: CapabilityTuiEntry[];
}

/**
 * The TUI menu derived from the capability registry — the third surface reader,
 * beside {@link capabilitySlashNames} (REPL) and {@link capabilityCliCommands}
 * (CLI). A BLIND reader over `registry.list()` of ONLY the `renderers.tui` bucket:
 * each verb that declares `renderers.tui` is grouped under its `section`, so a
 * verb registered ONCE lights up in the TUI palette with zero tui.ts edits (and,
 * later, so does a plugin-contributed verb). Verbs with no `renderers.tui` are
 * simply absent — projecting a hint is inert data, never a run(). Sections and
 * entries are name-sorted for a stable menu.
 */
export function capabilityTuiSections(): CapabilityTuiSection[] {
	const bySection = new Map<string, CapabilityTuiEntry[]>();
	for (const entry of capabilityRegistry.list()) {
		const tui = entry.renderers?.tui;
		if (!tui?.section) continue;
		const list = bySection.get(tui.section) ?? [];
		list.push({
			name: entry.name,
			summary: entry.summary,
			...(tui.shortcut ? { shortcut: tui.shortcut } : {}),
			...(tui.icon ? { icon: tui.icon } : {}),
		});
		bySection.set(tui.section, list);
	}
	return [...bySection.entries()]
		.map(([section, entries]) => ({
			section,
			entries: entries.sort((a, b) => a.name.localeCompare(b.name)),
		}))
		.sort((a, b) => a.section.localeCompare(b.section));
}
