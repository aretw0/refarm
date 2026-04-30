/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest";
import {
	listMountedHomesteadSurfaces,
	mountedHomesteadSurfaceKey,
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
