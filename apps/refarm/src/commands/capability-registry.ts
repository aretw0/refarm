import {
	CapabilityRegistry,
	type CapabilityDescriptor,
} from "@refarm.dev/cli/capabilities";
import { RESERVED_SLASH_NAMES } from "@refarm.dev/cli/chat-repl";
import type { CapabilitySurfaceHooks } from "./capability-commander.js";
import {
	extensionReviewCapability,
	extensionReviewHooks,
} from "./extension-review-capability.js";

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
	for (const alias of descriptor.slashAliases ?? []) {
		capabilityHooks.set(alias.toLowerCase(), hooks);
	}
}

registerCapability(extensionReviewCapability, extensionReviewHooks);

export function capabilityHooksFor(name: string): CapabilitySurfaceHooks {
	return capabilityHooks.get(name.toLowerCase()) ?? {};
}

/** Lowercased slash names the REPL parser should treat as capabilities. */
export function capabilitySlashNames(): ReadonlySet<string> {
	return new Set(
		capabilityRegistry.list().flatMap((descriptor) => [
			descriptor.name.toLowerCase(),
			...(descriptor.slashAliases ?? []).map((alias) => alias.toLowerCase()),
		]),
	);
}
