export interface MountedHomesteadSurface {
	pluginId: string;
	slotId: string;
	mountSource: string;
	state?: string;
	surfaceLayer?: string;
	surfaceKind?: string;
	surfaceId?: string;
	surfaceCapabilities?: string[];
	surfaceRenderMode?: string;
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
	"ui:surface_rendered",
	"ui:surface_render_failed",
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

export type HomesteadSurfaceActionStatus = "requested" | "failed";

export interface HomesteadSurfaceActionDiagnostic {
	pluginId?: string;
	status: HomesteadSurfaceActionStatus;
	actionId: string;
	actionIntent?: string;
	surfaceId?: string;
	surfaceKind?: string;
	surfaceLayer?: string;
	slotId?: string;
	mountSource?: string;
	errorMessage?: string;
}

export const HOMESTEAD_SURFACE_ACTION_EVENTS = [
	"ui:surface_action_requested",
	"ui:surface_action_failed",
] as const;

export type HomesteadSurfaceActionEventName =
	(typeof HOMESTEAD_SURFACE_ACTION_EVENTS)[number];

export function isHomesteadSurfaceChangeEvent(
	event: HomesteadSurfaceTelemetryEvent,
): event is HomesteadSurfaceTelemetryEvent & {
	event: HomesteadSurfaceChangeEventName;
} {
	return (HOMESTEAD_SURFACE_CHANGE_EVENTS as readonly string[]).includes(
		event.event,
	);
}

export function isHomesteadSurfaceActionEvent(
	event: HomesteadSurfaceTelemetryEvent,
): event is HomesteadSurfaceTelemetryEvent & {
	event: HomesteadSurfaceActionEventName;
} {
	return (HOMESTEAD_SURFACE_ACTION_EVENTS as readonly string[]).includes(
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

export function homesteadSurfaceActionFromTelemetry(
	event: HomesteadSurfaceTelemetryEvent,
): HomesteadSurfaceActionDiagnostic | undefined {
	if (!isHomesteadSurfaceActionEvent(event)) return undefined;
	const payload = event.payload ?? {};
	const actionId = stringPayloadValue(payload.actionId);
	if (!actionId) return undefined;

	return {
		pluginId: event.pluginId,
		status: event.event === "ui:surface_action_failed" ? "failed" : "requested",
		actionId,
		actionIntent: stringPayloadValue(payload.actionIntent),
		surfaceId: stringPayloadValue(payload.surfaceId),
		surfaceKind: stringPayloadValue(payload.surfaceKind),
		surfaceLayer: stringPayloadValue(payload.surfaceLayer),
		slotId: stringPayloadValue(payload.slotId),
		mountSource: stringPayloadValue(payload.mountSource),
		errorMessage: stringPayloadValue(payload.errorMessage),
	};
}

export function listHomesteadSurfaceActions(
	events: readonly HomesteadSurfaceTelemetryEvent[],
): HomesteadSurfaceActionDiagnostic[] {
	return events.flatMap((event) => {
		const action = homesteadSurfaceActionFromTelemetry(event);
		return action ? [action] : [];
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

function dataAttributeListValue(value?: string): string[] | undefined {
	if (!value) return undefined;
	const strings = value
		.split(" ")
		.map((item) => item.trim())
		.filter((item) => item.length > 0);
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
		surfaceCapabilities: dataAttributeListValue(
			element.dataset.refarmSurfaceCapabilities,
		),
		surfaceRenderMode: element.dataset.refarmSurfaceRenderMode,
	}));
}
