import type { JsonErrorEnvelope, JsonSuccessEnvelope } from "./envelope.js";

/** What a capability's run() returns: a success or error JSON envelope. */
export type CapabilityEnvelope = JsonSuccessEnvelope | JsonErrorEnvelope;

/**
 * A capability declared ONCE and projected onto every surface. The neutral core
 * (name/summary/args/options/run) carries ZERO surface vocabulary; each surface
 * hint lives in a per-surface bucket that only that surface's projector reads —
 * mirroring the DsTheme pattern (a neutral token contract + per-surface
 * projectors). Core and plugin-contributed capabilities share this shape, so
 * every surface derives from one declaration, never wired per surface by hand.
 *
 * Surfaces are TWO ORTHOGONAL axes, matching the two contracts the repo already
 * has:
 *   - TRANSPORTS — how the verb is INVOKED (dispatch-surface: cli, repl, http).
 *     `http` is the API axis: because run() returns a JSON envelope, an HTTP
 *     endpoint is nearly free — the envelope IS the response.
 *   - RENDERERS — how the envelope is SHOWN (homestead host-renderer: web, tui,
 *     and vr in the future).
 * Both maps are OPEN: a new transport or renderer is additive, never breaking,
 * because the core never enumerates them and every projector reads its bucket
 * optionally.
 *
 * `run()` is pure and host-agnostic: it takes already-parsed input and RETURNS a
 * JSON envelope. It must not read argv, the readline handle, or `process.*`, and
 * it must never build an Effort / call the model — the invariant that keeps a
 * `/slash` deterministic and an HTTP call side-effect-honest. Output is emitted
 * by the surface adapter, not by run(), so the envelope stays the single source
 * of behavior across CLI, REPL, API, Web, TUI, and VR alike.
 */
export interface CapabilityDescriptor {
	/** Canonical verb, lowercase (REPL slash keys are lowercased). e.g. "review". */
	name: string;
	/** One line for `--help` and `/help`. */
	summary: string;
	/** Ordered positionals. */
	args?: CapabilityArgSpec[];
	/** Flags. */
	options?: CapabilityOptionSpec[];
	/** How the verb is INVOKED. Read only by transport projectors. */
	transports?: CapabilityTransports;
	/** How the envelope is SHOWN. Read only by renderer projectors. */
	renderers?: CapabilityRenderers;
	run(input: CapabilityInput): Promise<CapabilityEnvelope> | CapabilityEnvelope;
}

/** CLI (commander) transport hints. Read only by the commander projector. */
export interface CapabilityCliTransport {
	/** Parent commander group, e.g. "extension". Omit for a top-level verb. */
	group?: string;
	/** If true and `group` is set, also mint a top-level `<bin> <name>` forwarder. */
	directAlias?: boolean;
}

/**
 * The outcome of a group's custom token grammar: which sub-action to run and the
 * token slice to parse into its input. Pure — no parse machinery, so the grammar
 * stays dependency-free and testable. `resolveGroupAction` turns `tokens` into a
 * {@link CapabilityInput} via the child's own arg/option specs.
 */
export interface CapabilityGroupResolution {
	/** A key of the group's `actions`. */
	key: string;
	/** Tokens to parse into the chosen sub-action's input (positionals + flags). */
	tokens: string[];
}

/**
 * A group's custom token grammar: `(tokens) → {key, tokens}` or null. Surface-
 * neutral by design — it lives on the group, NOT on a transport, so EVERY
 * surface that hands the group a raw token list (the REPL slash today; a CLI
 * argv, an HTTP path segment, a TUI/VR command bar tomorrow) resolves it the
 * same way. A surface uses it if it can; one that doesn't falls back to the
 * generic sub-verb dispatch. Reusable across rich verbs (`model`, a future
 * `thinking`/`effort`/`session`) with no verb-specific branches in the dispatcher.
 */
export type CapabilityGroupResolver = (tokens: string[]) => CapabilityGroupResolution | null;

/** REPL (/slash) transport hints. Read only by the REPL projector. */
export interface CapabilityReplTransport {
	/** Extra slash names; the canonical `name` is always registered. */
	slashAliases?: string[];
}

/**
 * HTTP/API transport hints. Read only by an HTTP projector (the tractor sidecar
 * axis). The run() JSON envelope is the response body; only the method+path
 * placement is declared here. Path is host-relative and bin-neutral.
 */
export interface CapabilityHttpTransport {
	/** e.g. "POST". Defaults to POST for verbs with side effects. */
	method?: string;
	/** Host-relative path, e.g. "/model" — never a scheme/host/bin. */
	path?: string;
}

/**
 * AGENT transport hints — model-facing opt-in for a capability, read by the
 * web-surface agent projector (agent-projector.ts).
 *
 * ⚠️ The LIVE agent leg (#6) does NOT read this bucket. The shipping path lists +
 * invokes plugin tools entirely in the Rust host + WASM guest (the host enumerates
 * every LOADED dispatchable plugin verb from the registry — see
 * packages/tractor/src/host/host_effects_bridge/capability_tools.rs). No descriptor
 * needs to set `transports.agent` for a plugin verb to reach the agent; loading the
 * plugin is enough. This bucket is the OPT-IN + model-facing hints the pure
 * web-surface projector uses (a browser/introspection endpoint that lists agent
 * tools), the same way `renderers.web` feeds a web renderer. It is a seam contract,
 * not a switch on the live guest path.
 *
 * Security still composes at the source: a plugin verb runs under ITS OWN load-time
 * grant when dispatched; surfacing to the agent widens REACH, never POWER (a revoked
 * plugin never loads → never in the registry → never listed).
 */
export interface CapabilityAgentTransport {
	/**
	 * If true, the web-surface agent projector emits a tool for this verb. Absent/
	 * false → the verb is not offered by that projector. (The live Rust guest path
	 * lists loaded plugin verbs regardless — see the interface note above.)
	 */
	tool?: boolean;
	/**
	 * Override the model-facing tool name. Defaults to the descriptor's `name`.
	 * Use to disambiguate a plugin verb (e.g. "vault_store" vs a bare "store") or
	 * to avoid colliding with a built-in agent tool.
	 */
	toolName?: string;
}

/**
 * How a capability is INVOKED. Open by design: a downstream/plugin transport is
 * additive. `[key: string]` keeps it open without losing the known-key typing.
 */
export interface CapabilityTransports {
	cli?: CapabilityCliTransport;
	repl?: CapabilityReplTransport;
	http?: CapabilityHttpTransport;
	agent?: CapabilityAgentTransport;
	[key: string]: unknown;
}

/** Web renderer hints. Read only by a web projector. */
export interface CapabilityWebRenderer {
	/** Route the verb mounts at, e.g. "/settings/model". Host-relative. */
	route?: string;
	/** Icon token (a ds/theme token or icon name — never an inline asset path). */
	icon?: string;
	/**
	 * The envelope field that holds this verb's HTML result, e.g. "resultsHtml" for a
	 * search verb. When a persona runs the verb from its web card, the dispatch loop reads
	 * `envelope[resultField]` and paints it into the surface's action-result region — so a
	 * query verb SHOWS its output instead of silently refreshing the dashboard. Omit for a
	 * verb whose only effect is on the content dashboard (the loop falls back to the
	 * envelope's `html`/`*Html` field, else a one-line ok/error status).
	 */
	resultField?: string;
}

/** TUI renderer hints. Read only by a TUI projector. */
export interface CapabilityTuiRenderer {
	/** Palette/menu section this verb groups under in a full-screen TUI. */
	section?: string;
	/** Icon token, resolved by the TUI theme (parallels web.icon). */
	icon?: string;
	/**
	 * Keybinding the TUI projector binds to this verb (standard format, e.g.
	 * "ctrl+m"), for quick-switchers like model / thinking-level. CLI/API ignore
	 * it. Parallels command-host's `shortcut`.
	 */
	shortcut?: string;
}

/**
 * How the envelope is SHOWN. Open by design: a new renderer (e.g. `vr`) is
 * additive — declare a hint before its projector exists, like a theme token.
 */
export interface CapabilityRenderers {
	web?: CapabilityWebRenderer;
	tui?: CapabilityTuiRenderer;
	[key: string]: unknown;
}

/**
 * A verb-group: a rich command (`model`, `workspace`, `task`) whose behavior is
 * a set of sub-action verbs. Each sub-action IS a full CapabilityDescriptor, so
 * a group is just a neutral container — it has no run() of its own; it dispatches
 * to a child. Every surface projects the group from this one declaration:
 * CLI `<bin> model current`, REPL `/model current`, API `POST /model/current`,
 * and a TUI section. See specs/features/2026-07-03-capability-groups-subactions.md.
 */
export interface CapabilityGroup {
	/** Group verb, lowercase. e.g. "model". */
	name: string;
	/** One line for `--help` / `/help` and the group landing. */
	summary: string;
	/**
	 * Sub-actions keyed by their sub-verb. Each value's `name` is the sub-verb
	 * ("current", "doctor"). A child MAY declare its own transports/renderers;
	 * unset falls back to the group's projection.
	 */
	actions: Record<string, CapabilityDescriptor>;
	/**
	 * Sub-action run when the group is invoked with no sub-verb (`model`,
	 * `/model`). Must be a key of `actions`. Read-only by convention — a bare
	 * group should never mutate. e.g. "current".
	 */
	defaultAction?: string;
	/**
	 * Optional custom token grammar, for a group whose form is richer than sub-
	 * verb dispatch. e.g. `model` maps `<ref>` → `set default <ref>` and `worker
	 * <ref>` → `set worker <ref>` — shapes the generic dispatcher cannot express
	 * (its default-with-args only reaches the default action's positionals).
	 * Surface-neutral: consulted first by `resolveGroupAction` regardless of which
	 * surface handed over the tokens; a resolution whose key names no real action
	 * (or a null return) falls back to the generic rules. See
	 * {@link CapabilityGroupResolver}.
	 */
	resolve?: CapabilityGroupResolver;
	/** Group-level surface hints; children inherit unless they override. */
	transports?: CapabilityTransports;
	renderers?: CapabilityRenderers;
}

/** A registry entry is either a flat verb or a verb-group. */
export type CapabilityEntry = CapabilityDescriptor | CapabilityGroup;

/** Narrow a registry entry to a group. */
export function isCapabilityGroup(entry: CapabilityEntry): entry is CapabilityGroup {
	return "actions" in entry && typeof entry.actions === "object";
}

export interface CapabilityArgSpec {
	name: string;
	required?: boolean;
	/** Collects the rest of the positionals into a string[]. */
	variadic?: boolean;
	/** JSON-Schema scalar type — feeds the derived agent-tool schema AND a typed web input (default
	 * "string"). "array" pairs with `items`; a `variadic` arg is always an array of `items`. Mirrors
	 * the plugin manifest's `PluginVerbArg`, so a verb declares its arg types ONCE and every surface
	 * (CLI, web form, agent tool) reads them. */
	type?: "string" | "number" | "integer" | "boolean" | "array";
	/** Allowed values (a string enum) → the tool schema's `enum` + a `<select>` in the web form. */
	enum?: string[];
	/** Element type when `type: "array"` (or variadic) — default "string". */
	items?: "string" | "number" | "integer" | "boolean";
	/** One-line description → the derived tool schema property's `description`. */
	description?: string;
}

export type CapabilityOptionKind = "boolean" | "string" | "string[]";

export interface CapabilityOptionSpec {
	/** Long name without dashes, e.g. "policy" (flag becomes `--policy`). */
	name: string;
	kind: CapabilityOptionKind;
	summary: string;
	/**
	 * Optional single-char short alias (without dash), e.g. "o" → `-o, --output`.
	 * CLI (commander) mints the short flag; other surfaces ignore it (they read by
	 * the long `name`). Lets a migrated command keep its historical short flags.
	 */
	short?: string;
	/** Default when the flag is absent. */
	defaultValue?: string | string[] | boolean;
}

/** Already-parsed input handed to `run()`. Never argv, never a readline handle. */
export interface CapabilityInput {
	/** Positionals by arg name; variadic args are string[]. */
	args: Record<string, string | string[]>;
	/** Options by name; shape follows each option's `kind`. */
	options: Record<string, string | string[] | boolean>;
	/** Whether the caller asked for JSON output. */
	json: boolean;
}
