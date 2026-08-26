import { pluginIdRuntimeToken } from "./plugin-identity.js";

/**
 * PURE. Which plugins THIS NODE has declared it is developing.
 *
 * IN THE NODE'S CONFIG, NEVER IN THE MANIFEST, and that is the load-bearing choice. A manifest
 * travels with the plugin, so an author who marked their own plugin "under development" would
 * ship an artifact that loads unverified on every node that installs it — a supply-chain hole
 * wearing a convenience's clothes. This is a statement by the operator ABOUT THIS MACHINE,
 * beside `trusted_plugins` and `modelAuthorization`.
 *
 * KEYED BY THE RUNTIME ID because that is what the load path looks up (proven 57ff5cc1).
 *
 * A MALFORMED DECLARATION READS AS ABSENT rather than as present, the same rule
 * `readModelAuthorization` follows: every failure of this parser lands on the state that
 * permits nothing.
 */
export function readPluginDevelopment(config) {
	const out = new Map();
	if (!config || typeof config !== "object" || Array.isArray(config)) return out;
	const raw = config.pluginDevelopment;
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
	for (const [id, entry] of Object.entries(raw)) {
		if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
		const declaredAt = typeof entry.declaredAt === "string" ? entry.declaredAt.trim() : "";
		if (!declaredAt) continue;
		out.set(pluginIdRuntimeToken(id), { declaredAt });
	}
	return out;
}

/** Whether this node declared it is developing `pluginId`, in either id vocabulary. */
export function isUnderDevelopment(config, pluginId) {
	return readPluginDevelopment(config).has(pluginIdRuntimeToken(pluginId));
}
