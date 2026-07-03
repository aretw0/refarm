import type {
	JsonErrorEnvelope,
	JsonSuccessEnvelope,
} from "../json-output.js";

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
 * How a capability is INVOKED. Open by design: a downstream/plugin transport is
 * additive. `[key: string]` keeps it open without losing the known-key typing.
 */
export interface CapabilityTransports {
	cli?: CapabilityCliTransport;
	repl?: CapabilityReplTransport;
	http?: CapabilityHttpTransport;
	[key: string]: unknown;
}

/** Web renderer hints. Read only by a web projector. */
export interface CapabilityWebRenderer {
	/** Route the verb mounts at, e.g. "/settings/model". Host-relative. */
	route?: string;
	/** Icon token (a ds/theme token or icon name — never an inline asset path). */
	icon?: string;
}

/** TUI renderer hints. Read only by a TUI projector. */
export interface CapabilityTuiRenderer {
	/** Palette/menu section this verb groups under in a full-screen TUI. */
	section?: string;
	/** Icon token, resolved by the TUI theme (parallels web.icon). */
	icon?: string;
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

export interface CapabilityArgSpec {
	name: string;
	required?: boolean;
	/** Collects the rest of the positionals into a string[]. */
	variadic?: boolean;
}

export type CapabilityOptionKind = "boolean" | "string" | "string[]";

export interface CapabilityOptionSpec {
	/** Long name without dashes, e.g. "policy" (flag becomes `--policy`). */
	name: string;
	kind: CapabilityOptionKind;
	summary: string;
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
