import {
	CapabilityRegistry,
	type CapabilityDescriptor,
	type CapabilityGroup,
} from "@refarm.dev/cli/capabilities";
import { RESERVED_SLASH_NAMES } from "@refarm.dev/cli/chat-repl";
import type { CapabilitySurfaceHooks } from "./capability-commander.js";
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
