export interface MountedHomesteadSurface {
	pluginId: string;
	slotId: string;
	mountSource: string;
	state?: string;
	surfaceLayer?: string;
	surfaceKind?: string;
	surfaceId?: string;
}

/**
 * Inspect Homestead DOM mounts. Studio tooling can use this to correlate a
 * manifest-declared surface with the shell wrapper that was actually activated.
 */
export function listMountedHomesteadSurfaces(
	root: ParentNode = document,
): MountedHomesteadSurface[] {
	return Array.from(
		root.querySelectorAll<HTMLElement>(
			"[data-refarm-plugin-id][data-refarm-slot-id][data-refarm-mount-source]",
		),
	).map((element) => ({
		pluginId: element.dataset.refarmPluginId ?? "",
		slotId: element.dataset.refarmSlotId ?? "",
		mountSource: element.dataset.refarmMountSource ?? "",
		state: element.dataset.refarmState,
		surfaceLayer: element.dataset.refarmSurfaceLayer,
		surfaceKind: element.dataset.refarmSurfaceKind,
		surfaceId: element.dataset.refarmSurfaceId,
	}));
}
