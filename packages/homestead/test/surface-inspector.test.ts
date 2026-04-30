/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest";
import {
	homesteadSurfaceActionFromTelemetry,
	isHomesteadSurfaceActionEvent,
	isHomesteadSurfaceChangeEvent,
	listHomesteadSurfaceActions,
	listRejectedHomesteadSurfaces,
	listMountedHomesteadSurfaces,
	mountedHomesteadSurfaceKey,
	observeMountedHomesteadSurfaceChanges,
	rejectedHomesteadSurfaceFromTelemetry,
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
				surfaceCapabilities: ["ui:panel:render", "ui:stream:read"],
				surfaceRenderMode: "html",
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
				surfaceCapabilities: ["ui:panel:render", "ui:stream:read"],
				surfaceRenderMode: "html",
			},
			{
				pluginId: "legacy-plugin",
				slotId: "statusbar",
				mountSource: "legacy-ui-slot",
				state: undefined,
				surfaceLayer: undefined,
				surfaceKind: undefined,
				surfaceId: undefined,
				surfaceCapabilities: undefined,
				surfaceRenderMode: undefined,
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
		).toBe(
			"stream-plugin:extension-surface:streams:homestead:panel:stream-panel",
		);

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
			isHomesteadSurfaceChangeEvent({ event: "ui:surface_rendered" }),
		).toBe(true);
		expect(
			isHomesteadSurfaceChangeEvent({ event: "ui:surface_render_failed" }),
		).toBe(true);
		expect(
			isHomesteadSurfaceChangeEvent({
				event: "system:plugin_state_changed",
			}),
		).toBe(true);
		expect(isHomesteadSurfaceChangeEvent({ event: "storage:io" })).toBe(false);
	});

	it("detects surface action telemetry events", () => {
		expect(
			isHomesteadSurfaceActionEvent({ event: "ui:surface_action_requested" }),
		).toBe(true);
		expect(
			isHomesteadSurfaceActionEvent({ event: "ui:surface_action_failed" }),
		).toBe(true);
		expect(isHomesteadSurfaceActionEvent({ event: "ui:surface_mounted" })).toBe(
			false,
		);
	});

	it("observes only telemetry events that can change mounted surfaces", () => {
		const telemetry = createTelemetrySource();
		const observed: string[] = [];
		const dispose = observeMountedHomesteadSurfaceChanges(
			telemetry,
			(event) => {
				observed.push(event.event);
			},
		);

		telemetry.emit({ event: "storage:io" });
		telemetry.emit({ event: "ui:surface_mounted" });
		telemetry.emit({ event: "ui:surface_rendered" });
		telemetry.emit({ event: "ui:surface_render_failed" });
		telemetry.emit({ event: "system:plugin_state_changed" });
		dispose();
		telemetry.emit({ event: "ui:surface_mounted" });

		expect(observed).toEqual([
			"ui:surface_mounted",
			"ui:surface_rendered",
			"ui:surface_render_failed",
			"system:plugin_state_changed",
		]);
	});

	it("extracts rejected surface activations from telemetry", () => {
		const event: HomesteadSurfaceTelemetryEvent = {
			event: "ui:surface_rejected",
			pluginId: "plugin-a",
			payload: {
				reason: "unsupported-capability",
				surfaceId: "secrets-panel",
				surfaceKind: "panel",
				surfaceLayer: "homestead",
				slotId: "main",
				missingCapabilities: ["ui:secrets:read"],
				trustSource: "registry",
				registryStatus: "registered",
			},
		};

		expect(rejectedHomesteadSurfaceFromTelemetry(event)).toEqual({
			pluginId: "plugin-a",
			reason: "unsupported-capability",
			surfaceId: "secrets-panel",
			surfaceKind: "panel",
			surfaceLayer: "homestead",
			slotId: "main",
			missingCapabilities: ["ui:secrets:read"],
			trustSource: "registry",
			registryStatus: "registered",
		});
		expect(
			listRejectedHomesteadSurfaces([{ event: "storage:io" }, event]),
		).toHaveLength(1);
		expect(
			rejectedHomesteadSurfaceFromTelemetry({ event: "ui:surface_mounted" }),
		).toBeUndefined();
	});

	it("extracts surface action diagnostics from telemetry", () => {
		const requested: HomesteadSurfaceTelemetryEvent = {
			event: "ui:surface_action_requested",
			pluginId: "studio-stream-surface-demo",
			payload: {
				actionId: "open-stream-workbench",
				actionIntent: "studio:navigate",
				surfaceId: "studio-stream-panel",
				surfaceKind: "panel",
				surfaceLayer: "homestead",
				slotId: "streams",
				mountSource: "extension-surface",
			},
		};
		const failed: HomesteadSurfaceTelemetryEvent = {
			event: "ui:surface_action_failed",
			pluginId: "studio-stream-surface-demo",
			payload: {
				actionId: "retry-stream",
				actionIntent: "studio:retry",
				errorMessage: "retry unavailable",
			},
		};

		expect(homesteadSurfaceActionFromTelemetry(requested)).toEqual({
			pluginId: "studio-stream-surface-demo",
			status: "requested",
			actionId: "open-stream-workbench",
			actionIntent: "studio:navigate",
			surfaceId: "studio-stream-panel",
			surfaceKind: "panel",
			surfaceLayer: "homestead",
			slotId: "streams",
			mountSource: "extension-surface",
			errorMessage: undefined,
		});
		expect(homesteadSurfaceActionFromTelemetry(failed)).toMatchObject({
			status: "failed",
			actionId: "retry-stream",
			errorMessage: "retry unavailable",
		});
		expect(
			listHomesteadSurfaceActions([{ event: "storage:io" }, requested, failed]),
		).toHaveLength(2);
		expect(
			homesteadSurfaceActionFromTelemetry({
				event: "ui:surface_action_requested",
			}),
		).toBeUndefined();
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
	surfaceCapabilities?: string[];
	surfaceRenderMode?: string;
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
	if (metadata.surfaceCapabilities?.length) {
		element.dataset.refarmSurfaceCapabilities =
			metadata.surfaceCapabilities.join(" ");
	}
	if (metadata.surfaceRenderMode) {
		element.dataset.refarmSurfaceRenderMode = metadata.surfaceRenderMode;
	}
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
