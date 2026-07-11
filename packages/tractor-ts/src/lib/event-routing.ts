import { normalizeCapabilities, type PluginManifest } from "@refarm.dev/plugin-manifest";
import type { TelemetryEvent } from "./telemetry.js";

export function manifestReceivesEvent(manifest: PluginManifest, event: TelemetryEvent): boolean {
	if (event.event.startsWith("system:")) return true;
	// Lower the ergonomic `verbs` block first — a verb authored there derives its
	// `<key>:dispatch` subscription, which the router must see to deliver dispatches.
	const caps = manifest.capabilities
		? normalizeCapabilities(
				manifest.capabilities as Parameters<typeof normalizeCapabilities>[0],
				manifest.id,
			)
		: undefined;
	return caps?.subscribes?.includes(event.event) ?? false;
}
