import {
	createCapabilityRegistry,
	tuiSurfaceModel,
	type CapabilityDescriptor,
	type CapabilityEntry,
	type CapabilityGroup,
} from "@refarm.dev/capabilities";
import { RESERVED_SLASH_NAMES } from "@refarm.dev/cli/chat-repl";
import {
	capabilityCliCommands as projectCliCommands,
	capabilityCliCommandsForGroup as projectCliCommandsForGroup,
	type CapabilitySurfaceHooks,
} from "@refarm.dev/surface-terminal";
import type { Command } from "commander";

import {
	createRecordsCapabilityGroup,
	createSourceCapabilityGroup,
	createVaultCapabilityGroup,
} from "@refarm.dev/capability-host";
import {
	refarmSourceDeps,
	refarmVaultDeps,
} from "./builtin-capability-deps.js";
import { createDispatchCapability } from "./dispatch-capability.js";
import {
	createHealthCapabilityGroup,
	healthCapabilityHooks,
} from "./health-capability.js";
import {
	createModelCapabilityGroup,
	modelCapabilityHooks,
} from "./model-capability.js";
import {
	createPluginCapabilityGroup,
	pluginCapabilityHooks,
} from "./plugin-capability.js";
import {
	defaultPluginDescriptorDeps,
	registerPluginCapabilities,
} from "./plugin-descriptor-adapter.js";
import {
	extensionInstallCapability,
	extensionInstallHooks,
} from "./plugin-install-from-path.js";
import {
	extensionReviewCapability,
	extensionReviewHooks,
} from "./plugin-review-capability.js";
import { readSurfaceablePluginManifests } from "./plugin-shared.js";
import {
	createSkillCapabilityGroup,
	skillCapabilityHooks,
} from "./skill-capability.js";
import { createThemeCapabilityGroup } from "./theme-capability.js";

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
	{ entry: createDispatchCapability(), hooks: {} },
	{ entry: extensionReviewCapability, hooks: extensionReviewHooks },
	{ entry: extensionInstallCapability, hooks: extensionInstallHooks },
	{ entry: createHealthCapabilityGroup(), hooksFor: healthCapabilityHooks },
	{ entry: createModelCapabilityGroup(), hooksFor: modelCapabilityHooks },
	{ entry: createPluginCapabilityGroup(), hooksFor: pluginCapabilityHooks },
	{ entry: createSkillCapabilityGroup(), hooksFor: skillCapabilityHooks },
	{ entry: createThemeCapabilityGroup(), hooksFor: () => ({}) },
	{ entry: createVaultCapabilityGroup(refarmVaultDeps()), hooksFor: () => ({}) },
	{ entry: createSourceCapabilityGroup(refarmSourceDeps()), hooksFor: () => ({}) },
	{ entry: createRecordsCapabilityGroup(), hooksFor: () => ({}) },
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

/** The refarm built-in capability ENTRIES — exposed so an external white-label app
 * can compose them with its OWN verbs into a single registry
 * (`createCapabilityRegistry([...refarmBuiltinCapabilities(), ...myVerbs])`) and
 * project a CLI via the shared `capabilityCliCommands`. This is the two-layer seam:
 * refarm supplies the neutral blocks; the app supplies the work-specific. */
export function refarmBuiltinCapabilities(): CapabilityEntry[] {
	return BUILTIN_CAPABILITIES.map((c) => c.entry as CapabilityEntry);
}

// Register-at-load: every installed plugin that declares a dispatchable verb surfaces
// it into the SAME registry, so a plugin capability projects to CLI/REPL/TUI/HTTP like
// a built-in. Best-effort + collision-safe (a plugin verb clashing with a built-in is
// skipped, never fatal). Read synchronously at import so the CLI's registry-driven
// mount sees the plugin verbs.
registerPluginCapabilities(
	capabilityRegistry,
	readSurfaceablePluginManifests(),
	defaultPluginDescriptorDeps(),
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
	return projectCliCommands(capabilityRegistry.list(), capabilityHooksFor);
}

/**
 * The CLI commands that declare `transports.cli.group === groupName` — the verbs
 * a parent command (e.g. `extension`) mounts as its own sub-commands. The parent
 * calls this to self-populate from the registry instead of hand-mounting each
 * capability, so a grouped verb (and later a plugin-contributed one) appears
 * under its parent from ONE declaration.
 */
export function capabilityCliCommandsForGroup(groupName: string): Command[] {
	return projectCliCommandsForGroup(
		capabilityRegistry.list(),
		groupName,
		capabilityHooksFor,
	);
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
 * (CLI). It now DERIVES from the shared {@link tuiSurfaceModel} (the tui face of the
 * one neutral surface model, ADR-085) rather than re-reading `renderers.tui` here —
 * so the CLI app and the capabilities lib project the TUI from the SAME function,
 * with no duplicated section-grouping logic. A verb registered once (including a
 * plugin-contributed one) still lights up with zero edits; the shape maps the shared
 * SurfaceItem down to the app's {section, entries} view.
 */
export function capabilityTuiSections(): CapabilityTuiSection[] {
	return tuiSurfaceModel(capabilityRegistry).sections.map((section) => ({
		section: section.section,
		entries: section.items.map((item) => {
			const tui = item.surfaces.tui ?? {};
			const shortcut = tui.shortcut;
			const icon = tui.icon;
			return {
				name: item.name,
				summary: item.summary,
				...(typeof shortcut === "string" ? { shortcut } : {}),
				...(typeof icon === "string" ? { icon } : {}),
			};
		}),
	}));
}
