import {
	homesteadHostRendererCan,
	missingHomesteadHostRendererCapabilities,
	type HomesteadHostRendererCapability,
	type HomesteadHostRendererDescriptor,
	type HomesteadHostRendererSnapshot,
} from "@refarm.dev/homestead/sdk/host-renderer";
import {
	listHomesteadSurfaceActions,
	listRejectedHomesteadSurfaces,
	type HomesteadSurfaceTelemetryEvent,
} from "@refarm.dev/homestead/sdk/surface-inspector";
import { STUDIO_HEADLESS_RENDERER } from "./studio-renderers";

export { STUDIO_HEADLESS_RENDERER };

export interface StudioHeadlessSnapshotOptions {
	renderer?: HomesteadHostRendererDescriptor;
	telemetryEvents?: readonly HomesteadSurfaceTelemetryEvent[];
	requiredCapabilities?: readonly HomesteadHostRendererCapability[];
}

export interface StudioHeadlessSnapshot extends HomesteadHostRendererSnapshot {
	missingCapabilities: readonly HomesteadHostRendererCapability[];
}

export function createStudioHeadlessSnapshot(
	options: StudioHeadlessSnapshotOptions = {},
): StudioHeadlessSnapshot {
	const renderer = options.renderer ?? STUDIO_HEADLESS_RENDERER;
	const telemetryEvents = options.telemetryEvents ?? [];
	const requiredCapabilities = options.requiredCapabilities ?? [
		"telemetry",
		"diagnostics",
	];
	const missingCapabilities = missingHomesteadHostRendererCapabilities(
		renderer,
		requiredCapabilities,
	);

	return {
		renderer,
		missingCapabilities,
		telemetryEvents: telemetryEvents.map((event) => event.event),
		surfaces: {
			rejected: listRejectedHomesteadSurfaces(telemetryEvents),
			actions: listHomesteadSurfaceActions(telemetryEvents),
		},
		diagnostics: createStudioHeadlessDiagnostics(renderer, missingCapabilities),
	};
}

function createStudioHeadlessDiagnostics(
	renderer: HomesteadHostRendererDescriptor,
	missingCapabilities: readonly HomesteadHostRendererCapability[],
): string[] {
	const diagnostics: string[] = [];
	if (!homesteadHostRendererCan(renderer, "interactive")) {
		diagnostics.push("renderer:non-interactive");
	}
	if (!homesteadHostRendererCan(renderer, "rich-html")) {
		diagnostics.push("renderer:no-rich-html");
	}
	for (const capability of missingCapabilities) {
		diagnostics.push(`renderer:missing:${capability}`);
	}
	return diagnostics;
}
