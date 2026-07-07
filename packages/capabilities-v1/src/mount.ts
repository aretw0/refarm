import {
	capabilityCliCommands,
	createCapabilityRegistry,
	type CapabilityEntry,
	type CapabilityHooksResolver,
	type CapabilityRegistry,
} from "@refarm.dev/cli/capabilities";

import {
	refarmBuiltinCapabilities,
	type RefarmCapabilityDeps,
} from "./builtin-capabilities.js";
import {
	registerPluginCapabilities,
	type PluginDescriptorDeps,
	type SurfaceableManifest,
} from "./plugin-bridge.js";

/**
 * The consumer-mount seam — the ONE call a white-label app makes to turn its deps +
 * extensions into a live capability registry. It bundles the whole two-layer wiring:
 * the neutral refarm blocks (from an injected deps bundle), the app's own JS work
 * verbs, and any plugin-manifest verbs surfaced via the bridge. The result projects to
 * CLI / REPL / TUI / HTTP / agent from the shared projectors.
 *
 * A consuming app is then just: its persona deps + verbs + one `mountCapabilities`
 * call. This is what makes a per-work example thin — the boilerplate lives here.
 */
export interface MountOptions {
	/** The deps bundle for the neutral blocks (source/records/vault). */
	deps: RefarmCapabilityDeps;
	/** The app's own work verbs (JS CapabilityDescriptors/-Groups), added alongside the
	 * built-ins. */
	verbs?: CapabilityEntry[];
	/** Plugin manifests whose dispatchable verbs are surfaced via the bridge (the
	 * refarm extension path — declare once, multi-surface). */
	manifests?: SurfaceableManifest[];
	/** Deps for the surfaced plugin verbs (how they submit efforts). Required when
	 * `manifests` is non-empty. */
	pluginDeps?: PluginDescriptorDeps;
	/** Reserved slash names the registry should refuse (defaults to none). */
	reservedNames?: Iterable<string>;
}

/** Build the composed capability registry for a consuming app. */
export function mountCapabilities(options: MountOptions): CapabilityRegistry {
	const entries: CapabilityEntry[] = [
		...refarmBuiltinCapabilities(options.deps),
		...(options.verbs ?? []),
	];
	const registry = createCapabilityRegistry(entries, options.reservedNames ?? []);

	const manifests = options.manifests ?? [];
	if (manifests.length > 0) {
		if (!options.pluginDeps) {
			throw new Error(
				"mountCapabilities: `manifests` given without `pluginDeps` (how surfaced verbs submit)",
			);
		}
		registerPluginCapabilities(registry, manifests, options.pluginDeps);
	}

	return registry;
}

/** The top-level CLI commands for a mounted registry — feed each to a Commander
 * `program.addCommand(...)`. A thin re-projection so a consumer never re-implements the
 * projector wiring; `hooksFor` defaults to no surface hooks. */
export function mountedCliCommands(
	registry: CapabilityRegistry,
	hooksFor: CapabilityHooksResolver = () => ({}),
): ReturnType<typeof capabilityCliCommands> {
	return capabilityCliCommands(registry.list(), hooksFor);
}
