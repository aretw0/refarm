import {
	getExtensionSurfaces,
	type ExtensionSurfaceDeclaration,
	type PluginManifest,
} from "@refarm.dev/plugin-manifest";

export const DEFAULT_HOMESTEAD_SURFACE_CAPABILITIES = new Set([
	"ui:panel:render",
	"ui:stream:read",
]);

export interface HomesteadSurfaceSlotOptions {
	allowedCapabilities?: ReadonlySet<string> | readonly string[];
}

/**
 * Resolve Homestead shell slots from both the legacy `ui.slots` field and the
 * additive multi-surface manifest contract.
 */
export function resolveHomesteadSurfaceSlots(
	manifest: PluginManifest,
	options: HomesteadSurfaceSlotOptions = {},
): string[] {
	const slots = new Set<string>();
	const allowedCapabilities = normalizeAllowedCapabilities(
		options.allowedCapabilities,
	);

	for (const slotId of manifest.ui?.slots ?? []) {
		if (typeof slotId === "string" && slotId.trim().length > 0) {
			slots.add(slotId);
		}
	}

	for (const surface of getExtensionSurfaces(manifest, "homestead")) {
		if (surface.slot === undefined || surface.slot.trim().length === 0)
			continue;
		if (!isHomesteadSurfaceCapabilityAllowed(surface, allowedCapabilities))
			continue;
		slots.add(surface.slot);
	}

	return [...slots];
}

function normalizeAllowedCapabilities(
	capabilities: HomesteadSurfaceSlotOptions["allowedCapabilities"],
): ReadonlySet<string> {
	if (capabilities instanceof Set) return capabilities;
	return new Set(capabilities ?? DEFAULT_HOMESTEAD_SURFACE_CAPABILITIES);
}

function isHomesteadSurfaceCapabilityAllowed(
	surface: ExtensionSurfaceDeclaration,
	allowedCapabilities: ReadonlySet<string>,
): boolean {
	return (surface.capabilities ?? []).every((capability) =>
		allowedCapabilities.has(capability),
	);
}
