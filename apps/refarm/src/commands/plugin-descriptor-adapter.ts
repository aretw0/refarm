import type {
	CapabilityDescriptor,
	CapabilityRegistry,
} from "@refarm.dev/cli/capabilities";
import {
	buildJsonErrorEnvelope,
	buildJsonSuccessEnvelope,
} from "@refarm.dev/cli/json-output";

import {
	buildDispatchEffort,
	submitEffortViaSidecar,
	type SubmitEffort,
} from "./dispatch-submit.js";
import { parseDispatchArgs } from "./dispatch-capability.js";

/**
 * The adapter that lets a PLUGIN surface a first-class capability — the extension
 * effect. A plugin already declares its dispatchable verbs in the manifest
 * (`capabilities.provides: ["<plugin>:<verb>"]` guarded by
 * `capabilities.subscribes ∋ "<plugin>:dispatch"`). This synthesizes a
 * `CapabilityDescriptor` per verb, which — registered into the surface registry —
 * projects to CLI / REPL / TUI / HTTP for free (the projectors are generic).
 *
 * SECURITY — no host-JS escape. `run()` is HOST-built here (never plugin-supplied
 * JS): it closes over `buildDispatchEffort` + submit, exactly like the generic
 * `dispatch` command. The plugin contributes only INERT DATA (the provides/subscribes
 * strings); the BEHAVIOR crosses the WASM boundary via the event router (the verb is
 * delivered to the plugin's `on-event` behind wasmtime). Surfacing a verb is
 * byte-identical to `refarm dispatch <plugin> <verb>` — same load-time A/B/G grant,
 * same seam. It widens the SURFACE (more places reach it), never the POWER: a
 * revoked/untrusted plugin never loads, so its channel is never registered and the
 * dispatched effort finalises with no subscriber (G composes).
 *
 * TWO-PHASE, honestly. `run()` returns immediately with a delivery receipt
 * (`{effortId, replyRef}`); the verb's actual result lands later as a
 * `dispatch-result:v1` node keyed by `replyRef`. A surfaced plugin verb is
 * fire-and-correlate, unlike a built-in whose run() returns synchronously.
 */

export interface PluginDescriptorDeps {
	submitEffort: SubmitEffort;
	newId: () => string;
	nowIso: () => string;
}

export function defaultPluginDescriptorDeps(): PluginDescriptorDeps {
	return {
		submitEffort: submitEffortViaSidecar,
		newId: () => crypto.randomUUID(),
		nowIso: () => new Date().toISOString(),
	};
}

/** Split a `<plugin>:<verb>` provides entry. Returns null for a non-verb entry
 * (no colon, or the reserved `:dispatch` routing key itself). */
function parseProvidedVerb(
	entry: string,
): { pluginKey: string; verb: string } | null {
	const idx = entry.indexOf(":");
	if (idx <= 0 || idx === entry.length - 1) return null;
	const pluginKey = entry.slice(0, idx);
	const verb = entry.slice(idx + 1);
	if (verb === "dispatch") return null; // the routing key, not a user verb
	return { pluginKey, verb };
}

/** The minimal manifest shape the adapter needs — just the id + the routing lists.
 * Structurally satisfied by a full PluginManifest, so a caller passes one directly. */
export interface SurfaceableManifest {
	id: string;
	capabilities?: {
		provides?: string[];
		subscribes?: string[];
	};
}

/**
 * Build the surface capabilities a plugin manifest contributes — one
 * `CapabilityDescriptor` per dispatchable verb in `capabilities.provides`, guarded by
 * `capabilities.subscribes ∋ "<pluginKey>:dispatch"` (only a plugin that receives its
 * own dispatch events can serve a dispatched verb). Returns [] when the plugin
 * declares no surfaceable verbs — most plugins won't, and that's fine.
 */
export function pluginDescriptorsFrom(
	manifest: SurfaceableManifest,
	deps: PluginDescriptorDeps = defaultPluginDescriptorDeps(),
): CapabilityDescriptor[] {
	const provides = manifest.capabilities?.provides ?? [];
	const subscribes = new Set(manifest.capabilities?.subscribes ?? []);

	const descriptors: CapabilityDescriptor[] = [];
	for (const entry of provides) {
		const parsed = parseProvidedVerb(entry);
		if (!parsed) continue;
		// Only surface a verb the plugin can actually receive a dispatch for.
		if (!subscribes.has(`${parsed.pluginKey}:dispatch`)) continue;
		descriptors.push(
			pluginVerbDescriptor(manifest.id, parsed.pluginKey, parsed.verb, deps),
		);
	}
	return descriptors;
}

/** One dispatch-backed descriptor for a `<pluginKey>:<verb>`. Its run() submits a
 * dispatch effort to the plugin's WASM — the same neutral seam the generic
 * `dispatch` command uses, just with the plugin + verb bound. */
function pluginVerbDescriptor(
	pluginId: string,
	pluginKey: string,
	verb: string,
	deps: PluginDescriptorDeps,
): CapabilityDescriptor {
	return {
		name: verb,
		summary: `${verb} — dispatched to the ${pluginId} plugin`,
		args: [{ name: "args", variadic: true }],
		async run(input) {
			const rawArgs = (input.args.args as string[] | undefined) ?? [];
			const parsed = parseDispatchArgs(rawArgs);
			if ("error" in parsed) {
				return buildJsonErrorEnvelope({
					command: verb,
					operation: "dispatch",
					error: "invalid-args",
					message: parsed.error,
					nextAction: `Pass args as key=value, e.g. \`${verb} note={"path":"n.md"}\`.`,
				});
			}
			const effort = buildDispatchEffort(
				{ pluginId: pluginKey, verb, args: parsed.args },
				deps.newId,
				deps.nowIso,
			);
			try {
				const effortId = await deps.submitEffort(effort);
				return buildJsonSuccessEnvelope({
					command: verb,
					operation: "dispatch",
					extra: { effortId, pluginId, verb, replyRef: effort.id },
					nextAction: `The result will be stored as a dispatch-result node keyed by replyRef "${effort.id}".`,
				});
			} catch (error) {
				return buildJsonErrorEnvelope({
					command: verb,
					operation: "dispatch",
					error: "dispatch-failed",
					message: `Could not dispatch ${verb} to ${pluginId}: ${String(error)}`,
					nextAction:
						"Is the runtime daemon up (`refarm runtime status`) and the plugin loaded + trusted (not revoked)?",
				});
			}
		},
		transports: { cli: {}, repl: {}, http: { method: "POST", path: `/${verb}` } },
	};
}

/** The outcome of registering plugin capabilities — what surfaced, what collided. */
export interface PluginCapabilityRegistration {
	/** Verb names successfully registered (now reachable on every surface). */
	registered: string[];
	/** Verbs skipped because the name collides with an existing capability. */
	collided: string[];
}

/**
 * Register the surface capabilities every installed plugin contributes into the
 * shared registry — the register-at-load wire that makes a plugin's verb reachable
 * on CLI / REPL / TUI / HTTP. Runs in apps/refarm (which OWNS the capabilityRegistry;
 * farmhand can't reach it — app→app is forbidden), so it enumerates the installed
 * manifests here and registers.
 *
 * A name collision (a plugin verb clashing with a built-in or another plugin's verb)
 * is skipped, not fatal — one bad plugin must not break the app's own commands. The
 * registry's register() throws on collision; we catch per-descriptor so the rest
 * still surface. deps.manifests is injected so this is testable without the fs.
 */
export function registerPluginCapabilities(
	registry: CapabilityRegistry,
	manifests: readonly SurfaceableManifest[],
	deps: PluginDescriptorDeps = defaultPluginDescriptorDeps(),
): PluginCapabilityRegistration {
	const registered: string[] = [];
	const collided: string[] = [];
	for (const manifest of manifests) {
		for (const descriptor of pluginDescriptorsFrom(manifest, deps)) {
			try {
				registry.register(descriptor);
				registered.push(descriptor.name);
			} catch {
				// Collision with a reserved/existing name — skip this verb, keep the rest.
				collided.push(descriptor.name);
			}
		}
	}
	return { registered, collided };
}
