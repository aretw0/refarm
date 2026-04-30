/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest";
import type { HomesteadSurfaceTelemetryEvent } from "@refarm.dev/homestead/sdk/surface-inspector";
import {
	mountReactiveStudioSurfaceLedger,
	mountStudioSurfaceLedger,
} from "./surface-ledger";

describe("Studio surface ledger", () => {
	it("renders mounted and rejected surfaces as structured rows", () => {
		const container = document.createElement("div");
		const root = document.createElement("div");
		root.appendChild(
			createSurfaceMount({
				pluginId: "studio-surface-diagnostics",
				slotId: "main",
				mountSource: "extension-surface",
				state: "running",
				surfaceKind: "panel",
				surfaceId: "surface-ledger-panel",
			}),
		);

		const ledger = mountStudioSurfaceLedger(container, root, {
			telemetryEvents: [
				{
					event: "ui:surface_rejected",
					pluginId: "external-untrusted-surface",
					payload: {
						reason: "untrusted-plugin",
						surfaceId: "external-ledger-panel",
						slotId: "main",
						surfaceKind: "panel",
						trustSource: "registry",
						registryStatus: "registered",
					},
				},
			],
		});

		expect(ledger.textContent).toContain("1 mounted");
		expect(ledger.textContent).toContain("1 rejected");
		expect(ledger.textContent).toContain("studio-surface-diagnostics");
		expect(ledger.textContent).toContain("surface-ledger-panel");
		expect(ledger.textContent).toContain("external-untrusted-surface");
		expect(ledger.textContent).toContain(
			"untrusted-plugin registry: registered",
		);
		expect(
			ledger.querySelectorAll('[data-refarm-surface-ledger-state="mounted"]'),
		).toHaveLength(1);
		expect(
			ledger.querySelectorAll('[data-refarm-surface-ledger-state="rejected"]'),
		).toHaveLength(1);
	});

	it("replaces previous ledgers when remounted", () => {
		const container = document.createElement("div");

		mountStudioSurfaceLedger(container, document.createElement("div"));
		mountStudioSurfaceLedger(container, document.createElement("div"));

		expect(
			container.querySelectorAll("[data-refarm-studio-surface-ledger]"),
		).toHaveLength(1);
		expect(container.textContent).toContain(
			"No surface activation telemetry is available yet.",
		);
	});

	it("refreshes as surface telemetry arrives", () => {
		const container = document.createElement("div");
		const root = document.createElement("div");
		const telemetry = createTelemetrySource();
		const controller = mountReactiveStudioSurfaceLedger(container, {
			root,
			telemetry,
		});

		expect(controller.element.textContent).toContain("0 mounted");

		root.appendChild(
			createSurfaceMount({
				pluginId: "studio-surface-diagnostics",
				slotId: "main",
				mountSource: "extension-surface",
				surfaceKind: "panel",
				surfaceId: "surface-ledger-panel",
			}),
		);
		telemetry.emit({ event: "ui:surface_mounted" });

		expect(controller.element.textContent).toContain("1 mounted");
		expect(controller.element.textContent).toContain("surface-ledger-panel");

		telemetry.emit({
			event: "ui:surface_rejected",
			pluginId: "external-untrusted-surface",
			payload: {
				reason: "missing-required-capability",
				surfaceId: "external-ledger-panel",
				missingCapabilities: ["ui:panel:render"],
			},
		});

		expect(controller.element.textContent).toContain("1 rejected");
		expect(controller.element.textContent).toContain(
			"missing-required-capability missing: ui:panel:render",
		);
	});

	it("disposes reactive telemetry subscriptions", () => {
		const container = document.createElement("div");
		const root = document.createElement("div");
		const telemetry = createTelemetrySource();
		const controller = mountReactiveStudioSurfaceLedger(container, {
			root,
			telemetry,
		});

		controller.dispose();
		root.appendChild(
			createSurfaceMount({
				pluginId: "late-plugin",
				slotId: "main",
				mountSource: "extension-surface",
			}),
		);
		telemetry.emit({ event: "ui:surface_mounted" });

		expect(controller.element.textContent).toContain("0 mounted");
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
