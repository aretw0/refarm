import type { PluginManifest } from "@refarm.dev/plugin-manifest";
import type { TelemetryEvent } from "./telemetry.js";

export function manifestReceivesEvent(manifest: PluginManifest, event: TelemetryEvent): boolean {
	return (
		event.event.startsWith("system:") ||
		(manifest.capabilities?.subscribes?.includes(event.event) ?? false)
	);
}
