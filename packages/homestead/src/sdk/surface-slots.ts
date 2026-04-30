import {
	getExtensionSurfaces,
	type PluginManifest,
} from "@refarm.dev/plugin-manifest";

/**
 * Resolve Homestead shell slots from both the legacy `ui.slots` field and the
 * additive multi-surface manifest contract.
 */
export function resolveHomesteadSurfaceSlots(
	manifest: PluginManifest,
): string[] {
	const slots = new Set<string>();

	for (const slotId of manifest.ui?.slots ?? []) {
		if (typeof slotId === "string" && slotId.trim().length > 0) {
			slots.add(slotId);
		}
	}

	for (const surface of getExtensionSurfaces(manifest, "homestead")) {
		if (surface.slot === undefined || surface.slot.trim().length === 0)
			continue;
		slots.add(surface.slot);
	}

	return [...slots];
}
