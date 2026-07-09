import {
	createPluginDescriptorDeps,
	type PluginDescriptorDeps,
} from "@refarm.dev/capabilities-v1";

import { submitEffortViaSidecar } from "./dispatch-submit.js";

/**
 * The plugin→capability bridge (the extension effect) now lives in
 * `@refarm.dev/capabilities-v1` so a consuming white-label app can use the SAME
 * mechanism — an installed plugin's verb lighting up on every surface from one
 * declaration. This module re-exports the bridge and supplies the app-side default
 * deps (the sidecar submit sink is host plumbing).
 */

export {
	pluginDescriptorsFrom,
	registerPluginCapabilities,
	type PluginCapabilityRegistration,
	type PluginDescriptorDeps,
	type SurfaceableManifest,
} from "@refarm.dev/capabilities-v1";

/** The refarm app's plugin-descriptor deps: submit dispatch efforts via the sidecar,
 * crypto UUIDs, wall clock. A white-label app supplies its OWN submit sink. */
export function defaultPluginDescriptorDeps(): PluginDescriptorDeps {
	return createPluginDescriptorDeps({
		submitEffort: submitEffortViaSidecar,
	});
}
