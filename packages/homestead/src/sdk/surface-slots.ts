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

export interface HomesteadSurfaceMount {
	slotId: string;
	source: "legacy-ui-slot" | "extension-surface";
	surface?: ExtensionSurfaceDeclaration;
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
	for (const mount of resolveHomesteadSurfaceMounts(manifest, options)) {
		slots.add(mount.slotId);
	}
	return [...slots];
}

/**
 * Resolve mount descriptors for Homestead. Hosts can use these descriptors to
 * preserve surface identity (`layer:id`) while still supporting legacy slots.
 */
export function resolveHomesteadSurfaceMounts(
	manifest: PluginManifest,
	options: HomesteadSurfaceSlotOptions = {},
): HomesteadSurfaceMount[] {
	const mounts: HomesteadSurfaceMount[] = [];
	const legacySlots = new Set<string>();
	const surfaceIds = new Set<string>();
	const allowedCapabilities = normalizeAllowedCapabilities(
		options.allowedCapabilities,
	);

	for (const slotId of manifest.ui?.slots ?? []) {
		if (typeof slotId === "string" && slotId.trim().length > 0) {
			legacySlots.add(slotId);
		}
	}
	for (const slotId of legacySlots) {
		mounts.push({ slotId, source: "legacy-ui-slot" });
	}

	for (const surface of getExtensionSurfaces(manifest, "homestead")) {
		if (surface.slot === undefined || surface.slot.trim().length === 0)
			continue;
		if (!isHomesteadSurfaceCapabilityAllowed(surface, allowedCapabilities))
			continue;
		if (surfaceIds.has(surface.id)) continue;
		surfaceIds.add(surface.id);
		mounts.push({
			slotId: surface.slot,
			source: "extension-surface",
			surface,
		});
	}

	return mounts;
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
