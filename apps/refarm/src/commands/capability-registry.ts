import {
	CapabilityRegistry,
	isCapabilityGroup,
	type CapabilityDescriptor,
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
 * The one registry of tri-surface capabilities for this app. Every declared
 * verb is registered here once; the CLI, the REPL slash, and any direct alias
 * are derived from it. New verbs (and, later, plugin-contributed ones) register
 * here and light up on all surfaces without touching the commander wiring or the
 * chat switch again.
 */
export const capabilityRegistry = new CapabilityRegistry(RESERVED_SLASH_NAMES);

/** Surface hooks (text render + exit intent) keyed by capability name. */
const capabilityHooks = new Map<string, CapabilitySurfaceHooks>();

function registerCapability(
	descriptor: CapabilityDescriptor,
	hooks: CapabilitySurfaceHooks = {},
): void {
	capabilityRegistry.register(descriptor);
	capabilityHooks.set(descriptor.name.toLowerCase(), hooks);
	for (const alias of descriptor.transports?.repl?.slashAliases ?? []) {
		capabilityHooks.set(alias.toLowerCase(), hooks);
	}
}

/**
 * Register a verb-group and its per-sub-action hooks. The REPL dispatcher keys a
 * group's hooks by the composite `"<group> <sub>"` name (see chat.ts case
 * "capability"), so we index every sub-action under that key for the group's own
 * verb AND each slash alias. This lets `/model set …` and `/provider set …`
 * resolve the same render/exit hooks the CLI group projector uses.
 */
function registerCapabilityGroup(
	group: CapabilityGroup,
	hooksFor: (subVerb: string) => CapabilitySurfaceHooks,
): void {
	capabilityRegistry.register(group);
	const verbs = [
		group.name,
		...(group.transports?.repl?.slashAliases ?? []),
	].map((name) => name.toLowerCase());
	for (const verb of verbs) {
		for (const subVerb of Object.keys(group.actions)) {
			capabilityHooks.set(`${verb} ${subVerb.toLowerCase()}`, hooksFor(subVerb));
		}
	}
}

registerCapability(extensionReviewCapability, extensionReviewHooks);
registerCapabilityGroup(createModelCapabilityGroup(), modelCapabilityHooks);
registerCapabilityGroup(createSkillCapabilityGroup(), skillCapabilityHooks);

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
