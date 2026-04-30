/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest";
import {
	isHomesteadSurfaceChangeEvent,
	listMountedHomesteadSurfaces,
	mountedHomesteadSurfaceKey,
	observeMountedHomesteadSurfaceChanges,
	type HomesteadSurfaceTelemetryEvent,
} from "../src/sdk/surface-inspector";

describe("listMountedHomesteadSurfaces", () => {
	it("reads mounted surface metadata from Homestead DOM wrappers", () => {
		document.body.replaceChildren(
			createMountElement({
				pluginId: "stream-plugin",
				slotId: "streams",
				mountSource: "extension-surface",
				state: "running",
				surfaceLayer: "homestead",
				surfaceKind: "panel",
				surfaceId: "stream-panel",
			}),
			createMountElement({
				pluginId: "legacy-plugin",
				slotId: "statusbar",
				mountSource: "legacy-ui-slot",
			}),
		);

		expect(listMountedHomesteadSurfaces()).toEqual([
			{
				pluginId: "stream-plugin",
				slotId: "streams",
				mountSource: "extension-surface",
				state: "running",
				surfaceLayer: "homestead",
				surfaceKind: "panel",
				surfaceId: "stream-panel",
			},
			{
				pluginId: "legacy-plugin",
				slotId: "statusbar",
				mountSource: "legacy-ui-slot",
				state: undefined,
				surfaceLayer: undefined,
				surfaceKind: undefined,
				surfaceId: undefined,
			},
		]);
	});

	it("builds stable keys for mounted surface diagnostics", () => {
		expect(
			mountedHomesteadSurfaceKey({
				pluginId: "stream-plugin",
				slotId: "streams",
				mountSource: "extension-surface",
				surfaceLayer: "homestead",
				surfaceKind: "panel",
				surfaceId: "stream-panel",
			}),
		).toBe("stream-plugin:extension-surface:streams:homestead:panel:stream-panel");

		expect(
			mountedHomesteadSurfaceKey({
				pluginId: "legacy-plugin",
				slotId: "statusbar",
				mountSource: "legacy-ui-slot",
			}),
		).toBe("legacy-plugin:legacy-ui-slot:statusbar:::");
	});

	it("detects surface-changing telemetry events", () => {
		expect(isHomesteadSurfaceChangeEvent({ event: "ui:surface_mounted" })).toBe(
			true,
		);
		expect(
			isHomesteadSurfaceChangeEvent({
				event: "system:plugin_state_changed",
			}),
		).toBe(true);
		expect(isHomesteadSurfaceChangeEvent({ event: "storage:io" })).toBe(
			false,
		);
	});

	it("observes only telemetry events that can change mounted surfaces", () => {
		const telemetry = createTelemetrySource();
		const observed: string[] = [];
		const dispose = observeMountedHomesteadSurfaceChanges(telemetry, (event) => {
			observed.push(event.event);
		});

		telemetry.emit({ event: "storage:io" });
		telemetry.emit({ event: "ui:surface_mounted" });
		telemetry.emit({ event: "system:plugin_state_changed" });
		dispose();
		telemetry.emit({ event: "ui:surface_mounted" });

		expect(observed).toEqual([
			"ui:surface_mounted",
			"system:plugin_state_changed",
		]);
	});
});

function createMountElement(metadata: {
	pluginId: string;
	slotId: string;
	mountSource: string;
	state?: string;
	surfaceLayer?: string;
	surfaceKind?: string;
	surfaceId?: string;
}): HTMLElement {
	const element = document.createElement("div");
	element.dataset.refarmPluginId = metadata.pluginId;
	element.dataset.refarmSlotId = metadata.slotId;
	element.dataset.refarmMountSource = metadata.mountSource;
	if (metadata.state) element.dataset.refarmState = metadata.state;
	if (metadata.surfaceLayer)
		element.dataset.refarmSurfaceLayer = metadata.surfaceLayer;
	if (metadata.surfaceKind)
		element.dataset.refarmSurfaceKind = metadata.surfaceKind;
	if (metadata.surfaceId) element.dataset.refarmSurfaceId = metadata.surfaceId;
	return element;
}

function createTelemetrySource() {
	const listeners = new Set<(event: HomesteadSurfaceTelemetryEvent) => void>();
	return {
		observe(listener: (event: HomesteadSurfaceTelemetryEvent) => void) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		emit(event: HomesteadSurfaceTelemetryEvent) {
			for (const listener of listeners) listener(event);
		},
	};
}
