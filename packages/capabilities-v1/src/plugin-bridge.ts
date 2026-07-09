import type {
	CapabilityDescriptor,
	CapabilityRegistry,
} from "@refarm.dev/cli/capabilities";
import {
	buildJsonErrorEnvelope,
	buildJsonSuccessEnvelope,
} from "@refarm.dev/cli/json-output";
import type { Effort } from "@refarm.dev/effort-contract-v1";

/**
 * The plugin→capability BRIDGE — the extension effect. This is the mechanism that
 * makes an installed plugin's declared verb light up on every surface (CLI / REPL /
 * TUI / HTTP) from ONE declaration, WITHOUT hand-wiring each surface. It is what
 * separates "extend via declaration" (declare once → multi-surface) from plain
 * software composition (import a package, mount a CLI).
 *
 * A plugin declares its dispatchable verbs in its manifest
 * (`capabilities.provides: ["<plugin>:<verb>"]`, guarded by
 * `capabilities.subscribes ∋ "<plugin>:dispatch"`). This synthesizes a
 * `CapabilityDescriptor` per verb with a stable scoped surface name
 * (`<plugin>-<verb>`); registered into a surface registry, it projects to every
 * surface for free (the projectors are generic). Short names like `search` are app /
 * persona aliases, not bridge-invented defaults.
 *
 * SECURITY — no host-JS escape. `run()` is HOST-built here (never plugin-supplied JS):
 * it closes over the injected `submitEffort` + a pure effort builder, exactly like the
 * generic `dispatch` command. The plugin contributes only INERT DATA (the
 * provides/subscribes strings); the BEHAVIOR crosses the WASM boundary via the event
 * router. Surfacing a verb widens the SURFACE (more places reach it), never the POWER:
 * a revoked/untrusted plugin never loads, so its channel is never registered and the
 * dispatched effort finalises with no subscriber.
 *
 * TWO-PHASE, honestly. `run()` returns a delivery receipt (`{effortId, replyRef}`);
 * the verb's actual result lands later as a `dispatch-result:v1` node keyed by
 * `replyRef`. A surfaced plugin verb is fire-and-correlate.
 *
 * The HOST injects `submitEffort` (how to reach its runtime) — this neutral block holds
 * no sidecar/transport impl.
 */

/** How a host submits a dispatch effort to its runtime. Injected — the impl is host
 * plumbing (a sidecar HTTP sink, an in-process runtime, …). */
export type SubmitEffort = (effort: Effort) => Promise<string>;

export interface PluginDescriptorDeps {
	submitEffort: SubmitEffort;
	newId: () => string;
	nowIso: () => string;
}

export interface PluginDescriptorDepsOptions {
	submitEffort: SubmitEffort;
	newId?: () => string;
	nowIso?: () => string;
}

export function createPluginDescriptorDeps(
	options: PluginDescriptorDepsOptions,
): PluginDescriptorDeps {
	return {
		submitEffort: options.submitEffort,
		newId: options.newId ?? (() => crypto.randomUUID()),
		nowIso: options.nowIso ?? (() => new Date().toISOString()),
	};
}

/** A dispatch request: the plugin + verb to invoke and the args to carry. */
export interface DispatchRequest {
	pluginId: string;
	verb: string;
	args: Record<string, unknown>;
}

/** Build a dispatch Effort from a request. PURE — id/time are injected. The task's
 * args carry a `replyRef` (the effort id) so the async result can be correlated. */
export function buildDispatchEffort(
	request: DispatchRequest,
	newId: () => string,
	nowIso: () => string,
): Effort {
	const effortId = newId();
	return {
		id: effortId,
		direction: "dispatch",
		tasks: [
			{
				id: newId(),
				pluginId: request.pluginId,
				fn: request.verb,
				args: { ...request.args, replyRef: effortId },
			},
		],
		source: "capability-dispatch",
		submittedAt: nowIso(),
	};
}

/** Parse `key=value` dispatch args into a record. Values are JSON-parsed when possible,
 * else kept as a bare string. PURE. */
export function parseDispatchArgs(
	pairs: string[],
): { args: Record<string, unknown> } | { error: string } {
	const args: Record<string, unknown> = {};
	for (const pair of pairs) {
		const eq = pair.indexOf("=");
		if (eq <= 0) {
			return { error: `arg "${pair}" must be key=value` };
		}
		const key = pair.slice(0, eq);
		const raw = pair.slice(eq + 1);
		try {
			args[key] = JSON.parse(raw);
		} catch {
			args[key] = raw; // a bare string value (e.g. verb=extract path=x)
		}
	}
	return { args };
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

/** The minimal manifest shape the bridge needs — the id + the routing lists.
 * Structurally satisfied by a full PluginManifest, so a caller passes one directly.
 *
 * `providesApi`/`requiresApi` are the plugin-to-plugin (SPI) axis: a plugin that
 * declares `requiresApi: ["FooApi"]` resolves a provider via the host's
 * `get-plugin-api` and calls it via `call-plugin` — one extension using another,
 * host-mediated, no import. They are orthogonal to `provides`/`subscribes` (the
 * host-verb axis) and mirror the full PluginManifest's `capabilities` fields. */
export interface SurfaceableManifest {
	id: string;
	capabilities?: {
		provides?: string[];
		subscribes?: string[];
		providesApi?: string[];
		requiresApi?: string[];
	};
}

export interface SurfaceablePluginVerb {
	pluginId: string;
	pluginKey: string;
	verb: string;
	target: string;
	dispatchEvent: string;
	surfaceName: string;
}

export function pluginSurfaceName(pluginKey: string, verb: string): string {
	return `${pluginKey}-${verb}`;
}

export function surfaceablePluginVerbsFrom(
	manifest: SurfaceableManifest,
): SurfaceablePluginVerb[] {
	const provides = manifest.capabilities?.provides ?? [];
	const subscribes = new Set(manifest.capabilities?.subscribes ?? []);

	const verbs: SurfaceablePluginVerb[] = [];
	for (const entry of provides) {
		const parsed = parseProvidedVerb(entry);
		if (!parsed) continue;
		const dispatchEvent = `${parsed.pluginKey}:dispatch`;
		// Only surface a verb the plugin can actually receive a dispatch for.
		if (!subscribes.has(dispatchEvent)) continue;
		verbs.push({
			pluginId: manifest.id,
			pluginKey: parsed.pluginKey,
			verb: parsed.verb,
			target: entry,
			dispatchEvent,
			surfaceName: pluginSurfaceName(parsed.pluginKey, parsed.verb),
		});
	}
	return verbs;
}

export interface PluginInspectorCapabilityOptions {
	name: string;
	summary: string;
	manifest: SurfaceableManifest;
	deps: PluginDescriptorDeps;
	operation?: string;
	httpPath?: string;
	tuiSection?: string;
	agentToolName?: string;
	note?: string;
	transports?: CapabilityDescriptor["transports"];
	renderers?: CapabilityDescriptor["renderers"];
}

export function definePluginInspectorCapability(
	options: PluginInspectorCapabilityOptions,
): CapabilityDescriptor {
	return {
		name: options.name,
		summary: options.summary,
		transports: options.transports ?? {
			cli: {},
			repl: {},
			http: { method: "GET", path: options.httpPath ?? `/${options.name}` },
			agent: { tool: true, toolName: options.agentToolName ?? options.name },
		},
		renderers: options.renderers ?? {
			tui: { section: options.tuiSection ?? options.name },
		},
		run() {
			const descriptors = pluginDescriptorsFrom(options.manifest, options.deps);
			return buildJsonSuccessEnvelope({
				command: options.name,
				operation: options.operation ?? "inspect",
				extra: {
					pluginId: options.manifest.id,
					declared: options.manifest.capabilities?.provides ?? [],
					surfaced: descriptors.map((descriptor) => ({
						verb: descriptor.name,
						summary: descriptor.summary,
					})),
					// The plugin-to-plugin (SPI) axis: which APIs this extension offers to
					// other plugins, and which it consumes from them. This is what makes the
					// "extension using another extension" recursion visible on the surface.
					providesApi: options.manifest.capabilities?.providesApi ?? [],
					requiresApi: options.manifest.capabilities?.requiresApi ?? [],
					...(options.note ? { note: options.note } : {}),
				},
			});
		},
	};
}

/**
 * Build the surface capabilities a plugin manifest contributes — one
 * `CapabilityDescriptor` per dispatchable verb in `capabilities.provides`, guarded by
 * `capabilities.subscribes ∋ "<pluginKey>:dispatch"` (only a plugin that receives its
 * own dispatch events can serve a dispatched verb). Returns [] when the plugin declares
 * no surfaceable verbs.
 */
export function pluginDescriptorsFrom(
	manifest: SurfaceableManifest,
	deps: PluginDescriptorDeps,
): CapabilityDescriptor[] {
	const descriptors: CapabilityDescriptor[] = [];
	for (const verb of surfaceablePluginVerbsFrom(manifest)) {
		descriptors.push(
			pluginVerbDescriptor(
				manifest.id,
				verb.pluginKey,
				verb.verb,
				deps,
			),
		);
	}
	return descriptors;
}

/** One dispatch-backed descriptor for a `<pluginKey>:<verb>`. Its run() submits a
 * dispatch effort to the plugin's WASM — the same neutral seam the generic `dispatch`
 * command uses, just with the plugin + verb bound. The public surface name is scoped
 * (`<pluginKey>-<verb>`) so `vault:search` and `web:search` are distinct without
 * registration-order fallback. */
function pluginVerbDescriptor(
	pluginId: string,
	pluginKey: string,
	verb: string,
	deps: PluginDescriptorDeps,
): CapabilityDescriptor {
	const name = pluginSurfaceName(pluginKey, verb);
	return {
		name,
		summary: `${name} — dispatched to the ${pluginId} plugin`,
		args: [{ name: "args", variadic: true }],
		async run(input) {
			const rawArgs = (input.args.args as string[] | undefined) ?? [];
			const parsed = parseDispatchArgs(rawArgs);
			if ("error" in parsed) {
				return buildJsonErrorEnvelope({
					command: name,
					operation: "dispatch",
					error: "invalid-args",
					message: parsed.error,
					nextAction: `Pass args as key=value, e.g. \`${name} note={"path":"n.md"}\`.`,
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
					command: name,
					operation: "dispatch",
					extra: { effortId, pluginId, pluginKey, verb, replyRef: effort.id },
					nextAction: `The result will be stored as a dispatch-result node keyed by replyRef "${effort.id}".`,
				});
			} catch (error) {
				return buildJsonErrorEnvelope({
					command: name,
					operation: "dispatch",
					error: "dispatch-failed",
					message: `Could not dispatch ${verb} to ${pluginId}: ${String(error)}`,
					nextAction:
						"Is the runtime daemon up and the plugin loaded + trusted (not revoked)?",
				});
			}
		},
		transports: { cli: {}, repl: {}, http: { method: "POST", path: `/${name}` } },
		renderers: { tui: { section: pluginKey }, web: { route: `/${name}` } },
	};
}

/** The outcome of registering plugin capabilities — what surfaced, what collided. */
export interface PluginCapabilityRegistration {
	/** Scoped surface names successfully registered (now reachable on every surface). */
	registered: string[];
	/** Scoped surface names skipped because they collide with an existing capability. */
	collided: string[];
}

/**
 * Register the surface capabilities every installed plugin contributes into a shared
 * registry — the register-at-load wire that makes a plugin's verb reachable on every
 * surface. A host enumerates its installed manifests and calls this; plugin verbs use
 * scoped names by default, and exact collisions are skipped so one bad plugin does not
 * break the app's own commands.
 */
export function registerPluginCapabilities(
	registry: CapabilityRegistry,
	manifests: readonly SurfaceableManifest[],
	deps: PluginDescriptorDeps,
): PluginCapabilityRegistration {
	const registered: string[] = [];
	const collided: string[] = [];
	for (const manifest of manifests) {
		for (const descriptor of pluginDescriptorsFrom(manifest, deps)) {
			try {
				registry.register(descriptor);
				registered.push(descriptor.name);
			} catch {
				collided.push(descriptor.name);
			}
		}
	}
	return { registered, collided };
}
