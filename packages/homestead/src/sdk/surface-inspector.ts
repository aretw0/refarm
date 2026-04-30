export interface MountedHomesteadSurface {
	pluginId: string;
	slotId: string;
	mountSource: string;
	state?: string;
	surfaceLayer?: string;
	surfaceKind?: string;
	surfaceId?: string;
}

export interface HomesteadSurfaceTelemetryEvent {
	event: string;
}

export interface HomesteadSurfaceTelemetrySource {
	observe(
		listener: (event: HomesteadSurfaceTelemetryEvent) => void,
	): (() => void) | void;
}

export const HOMESTEAD_SURFACE_CHANGE_EVENTS = [
	"ui:surface_mounted",
	"system:plugin_state_changed",
] as const;

export type HomesteadSurfaceChangeEventName =
	(typeof HOMESTEAD_SURFACE_CHANGE_EVENTS)[number];

export function isHomesteadSurfaceChangeEvent(
	event: HomesteadSurfaceTelemetryEvent,
): event is HomesteadSurfaceTelemetryEvent & {
	event: HomesteadSurfaceChangeEventName;
} {
	return (HOMESTEAD_SURFACE_CHANGE_EVENTS as readonly string[]).includes(
		event.event,
	);
}

export function mountedHomesteadSurfaceKey(
	surface: MountedHomesteadSurface,
): string {
	return [
		surface.pluginId,
		surface.mountSource,
		surface.slotId,
		surface.surfaceLayer ?? "",
		surface.surfaceKind ?? "",
		surface.surfaceId ?? "",
	].join(":");
}

export function observeMountedHomesteadSurfaceChanges(
	telemetry: HomesteadSurfaceTelemetrySource,
	onChange: (event: HomesteadSurfaceTelemetryEvent) => void,
): () => void {
	const dispose = telemetry.observe((event) => {
		if (isHomesteadSurfaceChangeEvent(event)) onChange(event);
	});
	return typeof dispose === "function" ? dispose : () => {};
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
