import type {
	JsonErrorEnvelope,
	JsonSuccessEnvelope,
} from "../json-output.js";

/** What a capability's run() returns: a success or error JSON envelope. */
export type CapabilityEnvelope = JsonSuccessEnvelope | JsonErrorEnvelope;

/**
 * A capability declared ONCE and exposed on every surface — the CLI (a commander
 * subcommand), the REPL (a `/slash` that runs deterministically, never calling
 * the model), and optionally a direct top-level verb. Core capabilities and
 * plugin-contributed capabilities share this shape, so the three surfaces are
 * always derived from one declaration, never wired three times by hand.
 *
 * `run()` is pure and host-agnostic: it takes already-parsed input and RETURNS a
 * JSON envelope. It must not read argv, the readline handle, or `process.*`, and
 * it must never build an Effort / call the model — that is the invariant that
 * keeps a `/slash` deterministic. Output is emitted by the surface adapter, not
 * by `run()`, so the envelope stays the single source of behavior.
 */
export interface CapabilityDescriptor {
	/** Canonical verb, lowercase (REPL slash keys are lowercased). e.g. "review". */
	name: string;
	/** Parent commander group, e.g. "extension". Omit for a top-level CLI verb. */
	group?: string;
	/** One line for `--help` and `/help`. */
	summary: string;
	/** Ordered positionals. */
	args?: CapabilityArgSpec[];
	/** Flags. */
	options?: CapabilityOptionSpec[];
	/** Extra REPL slash names; the canonical `name` is always registered. */
	slashAliases?: string[];
	/** If true and `group` is set, also mint a top-level `<bin> <name>` forwarder. */
	directAlias?: boolean;
	run(input: CapabilityInput): Promise<CapabilityEnvelope> | CapabilityEnvelope;
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
