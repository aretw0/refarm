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
	pluginId?: string;
	payload?: Record<string, unknown>;
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

export interface RejectedHomesteadSurfaceActivation {
	pluginId?: string;
	reason: string;
	surfaceId?: string;
	surfaceKind?: string;
	surfaceLayer?: string;
	slotId?: string;
	missingCapabilities?: string[];
	trustSource?: string;
	registryStatus?: string;
}

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

export function rejectedHomesteadSurfaceFromTelemetry(
	event: HomesteadSurfaceTelemetryEvent,
): RejectedHomesteadSurfaceActivation | undefined {
	if (event.event !== "ui:surface_rejected") return undefined;
	const payload = event.payload ?? {};
	return {
		pluginId: event.pluginId,
		reason: stringPayloadValue(payload.reason) ?? "unknown",
		surfaceId: stringPayloadValue(payload.surfaceId),
		surfaceKind: stringPayloadValue(payload.surfaceKind),
		surfaceLayer: stringPayloadValue(payload.surfaceLayer),
		slotId: stringPayloadValue(payload.slotId),
		missingCapabilities: stringArrayPayloadValue(payload.missingCapabilities),
		trustSource: stringPayloadValue(payload.trustSource),
		registryStatus: stringPayloadValue(payload.registryStatus),
	};
}

export function listRejectedHomesteadSurfaces(
	events: readonly HomesteadSurfaceTelemetryEvent[],
): RejectedHomesteadSurfaceActivation[] {
	return events.flatMap((event) => {
		const rejection = rejectedHomesteadSurfaceFromTelemetry(event);
		return rejection ? [rejection] : [];
	});
}

function stringPayloadValue(value: unknown): string | undefined {
	return typeof value === "string" && value.trim().length > 0
		? value
		: undefined;
}

function stringArrayPayloadValue(value: unknown): string[] | undefined {
	if (!Array.isArray(value)) return undefined;
	const strings = value.filter(
		(item): item is string => typeof item === "string" && item.length > 0,
	);
	return strings.length > 0 ? strings : undefined;
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
