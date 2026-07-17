import { createCapabilityRegistry, type CapabilityRegistry } from "@refarm.dev/capabilities";

import { createExtensionGraphCapability } from "../extension-graph.js";
import { DEVBENCH_DEFAULT_MANIFESTS, DEVBENCH_LIVE_MANIFESTS, DEVBENCH_LIVE_PLUGIN_IDS } from "../manifests.js";

/**
 * A BROWSER-safe devbench registry for the extension-graph web face. `extension-graph` is pure
 * compute over the plugin manifests (buildExtensionGraph → graphToSvg from @refarm.dev/surveyor) —
 * no node, no WASM, no records. It draws the SPI dependency graph (each plugin a node; a
 * `requiresApi` → `providesApi` an edge) and marks the delegate → agent edge `executed: true`
 * (the real, host-mediated call_plugin recursion, live via delegate-run --chain). The manifests
 * are pure data from ../manifests.ts, so this imports nothing from ../cli.js or ../persona.js.
 */
export function createExtensionGraphWebRegistry(): CapabilityRegistry {
	return createCapabilityRegistry([
		createExtensionGraphCapability([...DEVBENCH_DEFAULT_MANIFESTS, ...DEVBENCH_LIVE_MANIFESTS], {
			livePluginIds: DEVBENCH_LIVE_PLUGIN_IDS,
		}),
	]);
}
