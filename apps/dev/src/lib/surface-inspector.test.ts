/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest";
import {
	mountedSurfaceLabel,
	mountStudioSurfaceInspector,
} from "./surface-inspector";

describe("Studio surface inspector", () => {
	it("formats labels for extension and legacy mounts", () => {
		expect(
			mountedSurfaceLabel({
				pluginId: "stream-plugin",
				slotId: "streams",
				mountSource: "extension-surface",
				surfaceId: "stream-panel",
			}),
		).toBe("stream-plugin · stream-panel → streams");
		expect(
			mountedSurfaceLabel({
				pluginId: "legacy-plugin",
				slotId: "statusbar",
				mountSource: "legacy-ui-slot",
			}),
		).toBe("legacy-plugin · legacy-ui-slot → statusbar");
	});

	it("mounts an inspectable list of Homestead surfaces", () => {
		const container = document.createElement("div");
		const root = document.createElement("div");
		root.appendChild(
			createSurfaceMount({
				pluginId: "stream-plugin",
				slotId: "streams",
				mountSource: "extension-surface",
				state: "running",
				surfaceKind: "panel",
				surfaceId: "stream-panel",
			}),
		);

		const inspector = mountStudioSurfaceInspector(container, root);

		expect(inspector.textContent).toContain("1 mounted surface");
		expect(inspector.textContent).toContain(
			"stream-plugin · stream-panel → streams",
		);
		expect(inspector.textContent).toContain("panel · running");
		expect(
			container.querySelectorAll("[data-refarm-studio-surface-inspector]"),
		).toHaveLength(1);
	});

	it("replaces any previous inspector when remounted", () => {
		const container = document.createElement("div");

		mountStudioSurfaceInspector(container, document.createElement("div"));
		mountStudioSurfaceInspector(container, document.createElement("div"));

		expect(
			container.querySelectorAll("[data-refarm-studio-surface-inspector]"),
		).toHaveLength(1);
		expect(container.textContent).toContain(
			"No plugin surfaces are mounted yet.",
		);
	});
});

function createSurfaceMount(metadata: {
	pluginId: string;
	slotId: string;
	mountSource: string;
	state?: string;
	surfaceKind?: string;
	surfaceId?: string;
}): HTMLElement {
	const element = document.createElement("div");
	element.dataset.refarmPluginId = metadata.pluginId;
	element.dataset.refarmSlotId = metadata.slotId;
	element.dataset.refarmMountSource = metadata.mountSource;
	if (metadata.state) element.dataset.refarmState = metadata.state;
	if (metadata.surfaceKind)
		element.dataset.refarmSurfaceKind = metadata.surfaceKind;
	if (metadata.surfaceId) element.dataset.refarmSurfaceId = metadata.surfaceId;
	return element;
}
