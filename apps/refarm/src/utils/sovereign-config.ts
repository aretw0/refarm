import {
	CONFIG_NODE_DEFAULT_ID,
	configFromNode,
	loadRawSovereignConfig,
} from "@refarm.dev/config";
import { openTractorGraph } from "./tractor-store.js";

/**
 * Resolve the sovereign config object, MIRRORING the Rust host's
 * `resolve_sovereign_config` (tractor env_and_runtime.rs) precedence EXACTLY:
 *
 *   1. fs FIRST — the operator of THIS device is authoritative for their own
 *      cwd `.refarm/config.json` (loadRawSovereignConfig; null on absent/invalid).
 *   2. node FALLBACK — only when there is no usable local file, read the
 *      replicated RefarmConfig graph node (its `data` is the redacted raw config).
 *
 * Returns null when neither is available — callers then fall back to their env
 * default, exactly as before the node existed.
 *
 * Why this lives in apps/refarm and not @refarm.dev/config: the node read needs
 * the tractor sqlite layer (openTractorGraph → storage-sqlite), and
 * @refarm.dev/config is JS-Atomic and dependency-free. So this seam COMPOSES the
 * two pure config exports (loadRawSovereignConfig + configFromNode) with the
 * app-local graph reader, keeping the config package pure — the same split the
 * health ConfigNodeAuditor already uses.
 *
 * SCOPE CAVEAT: the graph node is workspace/cwd-scoped
 * (`urn:refarm:config:workspace`). The home `~/.refarm/config.json` layer is NOT
 * represented in the node; a resolver that also honors the home file must read it
 * from fs separately — do not expect this seam to surface home-scoped config.
 */
export async function resolveSovereignConfig(
	env = process.env,
	root = process.cwd(),
): Promise<Record<string, unknown> | null> {
	// fs wins, exactly like the Rust host: a present, valid local file is the
	// operator's own authoritative config; the node is never consulted for it.
	const local = loadRawSovereignConfig(root);
	if (local != null) return local as Record<string, unknown>;

	// No usable local file → try the replicated node. openTractorGraph returns
	// null when the tractor db is absent, so a device that never ran the runtime
	// degrades to null here (and the caller to its default) — no coupling to a
	// running runtime.
	const graph = openTractorGraph(env);
	if (!graph) return null;
	try {
		const node = await graph.getNode(CONFIG_NODE_DEFAULT_ID);
		if (!node) return null;
		// getNode returns a NormalisedNode; configFromNode validates schema/kind at
		// runtime (throwing on a malformed node, caught below) and returns node.data.
		// The structural cast bridges the read layer's type to the config contract —
		// the same call the health ConfigNodeAuditor makes (untyped, in JS).
		return configFromNode(
			node as unknown as Parameters<typeof configFromNode>[0],
		) as Record<string, unknown> | null;
	} catch {
		// Locked/malformed db or node → degrade to null rather than inventing config.
		return null;
	}
}
