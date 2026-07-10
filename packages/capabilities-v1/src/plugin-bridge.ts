import type { CapabilityDescriptor, CapabilityRegistry } from "@refarm.dev/capabilities";
import { surfacesOf } from "@refarm.dev/capabilities";
import {
	buildJsonErrorEnvelope,
	buildJsonSuccessEnvelope,
} from "@refarm.dev/capabilities/envelope";
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

/** Is this error a "cannot reach the runtime" failure (vs. a plugin-level error)?
 * A fetch to a down daemon rejects with a TypeError "fetch failed" whose cause carries
 * a Node connection code (ECONNREFUSED/ENOTFOUND/ECONNRESET) or an AbortError on
 * timeout. We match structurally rather than on message text so the classification
 * survives locale/runtime differences. */
export function isConnectionError(error: unknown): boolean {
	const codes = new Set([
		"ECONNREFUSED",
		"ENOTFOUND",
		"ECONNRESET",
		"ETIMEDOUT",
		"UND_ERR_CONNECT_TIMEOUT",
		"UND_ERR_SOCKET",
	]);
	const seen = new Set<unknown>();
	let cursor: unknown = error;
	while (cursor && typeof cursor === "object" && !seen.has(cursor)) {
		seen.add(cursor);
		const code = (cursor as { code?: unknown }).code;
		if (typeof code === "string" && codes.has(code)) return true;
		const name = (cursor as { name?: unknown }).name;
		if (name === "AbortError") return true;
		const message = (cursor as { message?: unknown }).message;
		if (typeof message === "string" && /fetch failed|ECONNREFUSED|network/i.test(message)) {
			return true;
		}
		cursor = (cursor as { cause?: unknown }).cause;
	}
	return false;
}

/** Split a `<plugin>:<verb>` provides entry. Returns null for a non-verb entry
 * (no colon, or the reserved `:dispatch` routing key itself). */
function parseProvidedVerb(entry: string): { pluginKey: string; verb: string } | null {
	const idx = entry.indexOf(":");
	if (idx <= 0 || idx === entry.length - 1) return null;
	const pluginKey = entry.slice(0, idx);
	const verb = entry.slice(idx + 1);
	if (verb === "dispatch") return null; // the routing key, not a user verb
	return { pluginKey, verb };
}

/** A surface a plugin declares in its manifest (`extensions.surfaces[]`) — WHERE it mounts
 * (the homestead panel, an asset pack, …). A structural SUBSET of plugin-manifest's
 * `ExtensionSurfaceDeclaration` (the canonical type), redeclared here only because
 * capabilities-v1 does not depend on plugin-manifest — the shared fields are asserted
 * against the canonical type by a conformance test, so this cannot silently drift. */
export interface ManifestExtensionSurface {
	layer: string;
	kind?: string;
	id: string;
	slot?: string;
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
	/** The surfaces this plugin declares in its manifest. Folded onto each surfaced verb's
	 * `renderers` so a plugin-declared surface (homestead panel, a new surface) reaches the
	 * open axis — closing the manifest→descriptor gap where these were ignored (ADR-085). */
	extensions?: {
		surfaces?: ManifestExtensionSurface[];
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

export function surfaceablePluginVerbsFrom(manifest: SurfaceableManifest): SurfaceablePluginVerb[] {
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

/** The host convention: a plugin's `providesApi: ["FooApi"]` folds into its `provides`
 * as `api:FooApi`, and `get-plugin-api` resolves a requirement by matching that key
 * (see tractor `plugin_registry::plugin_providing_api`, needle `api:<name>`). This is
 * the TS mirror of that convention — pure, no host round-trip. */
export function apiProvideKey(apiName: string): string {
	return `api:${apiName}`;
}

/** One resolved plugin-to-plugin (SPI) link: a plugin that `requiresApi` a named API,
 * paired with the id of the loaded plugin that `providesApi` it — or `null` when no
 * loaded manifest provides it (the requirement is unmet, degrade gracefully). */
export interface ResolvedApiLink {
	api: string;
	requiredBy: string;
	providedBy: string | null;
}

/** Resolve the recursion the way the host would: for every `requiresApi` across the
 * given manifests, find the manifest that `providesApi` it. This is what makes
 * "an extension using another extension" checkable on the TS side the example lives on
 * — the same pairing the vault↔quality WASM harness proves in Rust, without a round
 * trip to a running runtime. A requirement no loaded manifest provides resolves to
 * `providedBy: null` (unmet, not an error — the caller degrades). */
export function resolveApiLinks(manifests: readonly SurfaceableManifest[]): ResolvedApiLink[] {
	const providerByApi = new Map<string, string>();
	for (const manifest of manifests) {
		for (const api of manifest.capabilities?.providesApi ?? []) {
			// First provider wins (mirrors the host's registration-order resolution).
			if (!providerByApi.has(api)) providerByApi.set(api, manifest.id);
		}
	}
	const links: ResolvedApiLink[] = [];
	for (const manifest of manifests) {
		for (const api of manifest.capabilities?.requiresApi ?? []) {
			links.push({
				api,
				requiredBy: manifest.id,
				providedBy: providerByApi.get(api) ?? null,
			});
		}
	}
	return links;
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
	/** The other loaded manifests, so the inspector can resolve this plugin's
	 * `requiresApi` against their `providesApi` — surfacing the plugin-to-plugin
	 * recursion (which extension provides the API this one consumes). Omit when the
	 * inspector only reports the single manifest. */
	peers?: readonly SurfaceableManifest[];
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
						// The multi-surface reach of THIS verb, made visible: which surfaces
						// its one declaration projects onto (cli, http, agent, tui, web,
						// palette, …). This is the "declare once → everywhere" effect the
						// inspector demonstrates, now introspectable per verb (ADR-085).
						surfaces: surfacesOf(descriptor),
					})),
					// The plugin-to-plugin (SPI) axis: which APIs this extension offers to
					// other plugins, and which it consumes from them. This is what makes the
					// "extension using another extension" recursion visible on the surface.
					providesApi: options.manifest.capabilities?.providesApi ?? [],
					requiresApi: options.manifest.capabilities?.requiresApi ?? [],
					// The resolved recursion: for each requiresApi, which loaded peer
					// provides it (or null when unmet). Only present when peers are given.
					apiLinks: resolveApiLinks([options.manifest, ...(options.peers ?? [])]),
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
	const manifestSurfaces = manifest.extensions?.surfaces ?? [];
	const descriptors: CapabilityDescriptor[] = [];
	for (const verb of surfaceablePluginVerbsFrom(manifest)) {
		descriptors.push(
			pluginVerbDescriptor(manifest.id, verb.pluginKey, verb.verb, deps, manifestSurfaces),
		);
	}
	return descriptors;
}

/** Fold a plugin's manifest-declared surfaces into a verb's `renderers` — each declared
 * surface layer becomes a renderer key carrying its declaration, ON TOP of the defaults,
 * without overwriting them. This is what lets a plugin's `extensions.surfaces[]` reach the
 * open axis (and thus the web bridge / any projector), instead of being ignored. */
function foldManifestSurfaces(
	base: NonNullable<CapabilityDescriptor["renderers"]>,
	surfaces: readonly ManifestExtensionSurface[],
): NonNullable<CapabilityDescriptor["renderers"]> {
	const merged: Record<string, unknown> = { ...base };
	for (const surface of surfaces) {
		// A declared surface keyed by its layer (homestead, asset, …) — a new surface on the
		// verb the projector for that layer reads. Don't clobber a default already present.
		if (merged[surface.layer] === undefined) {
			merged[surface.layer] = { id: surface.id, kind: surface.kind, slot: surface.slot };
		}
	}
	return merged as NonNullable<CapabilityDescriptor["renderers"]>;
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
	manifestSurfaces: readonly ManifestExtensionSurface[] = [],
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
				// Distinguish "the runtime isn't reachable" from "the plugin can't serve".
				// A white-label app degrades with an actionable next step, not a raw
				// `fetch failed` — the operator needs to know WHICH to fix.
				const offline = isConnectionError(error);
				return buildJsonErrorEnvelope({
					command: name,
					operation: "dispatch",
					error: offline ? "runtime-unreachable" : "dispatch-failed",
					message: offline
						? `The runtime is not reachable, so ${verb} could not dispatch to ${pluginId}.`
						: `Could not dispatch ${verb} to ${pluginId}: ${String(error)}`,
					nextAction: offline
						? "Start the runtime daemon (it hosts the plugins), then retry — the dispatch reaches the plugin over the sidecar."
						: "Is the plugin loaded + trusted (not revoked)? Check the runtime's loaded plugins.",
				});
			}
		},
		transports: { cli: {}, repl: {}, http: { method: "POST", path: `/${name}` } },
		// The default surfaces (tui/web) PLUS any the plugin declared in its manifest — so a
		// plugin's extensions.surfaces[] (a homestead panel, a new surface) reaches the open
		// axis and every projector, not just the two hardcoded here.
		renderers: foldManifestSurfaces(
			{ tui: { section: pluginKey }, web: { route: `/${name}` } },
			manifestSurfaces,
		),
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
