// The ONE capability dispatch every actuated surface (CLI, TUI, REPL) routes through — so "resolve a
// group-or-flat verb from tokens → validate its input → run" is defined once, not re-implemented per
// surface (where it drifted: some surfaces ran a flat verb with EMPTY input, ignoring its argv, and none
// validated). resolveCapabilityInvocation is the pure resolution; dispatchCapability adds validate + run
// and returns one outcome shape each surface renders its own way.

import { validateCapabilityArgs, type CapabilityArgValidation } from "./arg-validator.js";
import { resolveGroupAction } from "./group-dispatch.js";
import { parseCapabilityArgv } from "./parse-argv.js";
import { isCapabilityGroup } from "./types.js";
import type { CapabilityDescriptor, CapabilityEntry, CapabilityInput } from "./types.js";

/** A resolved invocation: the concrete action to run, its parsed input, and the chosen key (a group's
 * sub-verb key, or the flat verb's own name). */
export interface CapabilityInvocation {
	descriptor: CapabilityDescriptor;
	key: string;
	input: CapabilityInput;
}

/**
 * Resolve a group OR a flat verb from a token list to the action + parsed input to run — the shared
 * resolution every surface uses, so a flat verb's argv is parsed the same everywhere (surfaces that ran
 * flat verbs with empty input are fixed) and a group's sub-action dispatch can't drift. Returns null when
 * a group has no matching action and no default (the caller shows help).
 */
export function resolveCapabilityInvocation(
	entry: CapabilityEntry,
	tokens: string[],
): CapabilityInvocation | null {
	if (isCapabilityGroup(entry)) {
		const resolved = resolveGroupAction(entry, tokens);
		return resolved ? { descriptor: resolved.action, key: resolved.key, input: resolved.input } : null;
	}
	return { descriptor: entry, key: entry.name, input: parseCapabilityArgv(entry, tokens) };
}

/** The outcome of dispatching a capability from tokens: `unresolved` (show help), `invalid` (show the
 * field-scoped errors, nothing ran), or `ran` (the run envelope). One shape every surface renders. */
export interface CapabilityDispatchOutcome {
	status: "unresolved" | "invalid" | "ran";
	invocation?: CapabilityInvocation;
	validation?: CapabilityArgValidation;
	envelope?: unknown;
}

/**
 * Resolve → validate → run a capability from a token list. Unresolved input yields `unresolved`; input
 * that fails the verb's DERIVED JSON Schema yields `invalid` (field-scoped errors, no run — the same
 * contract the web form and HTTP surface enforce); otherwise the verb runs and its envelope is returned.
 * Each surface renders the outcome its own way (a CLI prints, a TUI returns text, a chat replies).
 */
export async function dispatchCapability(
	entry: CapabilityEntry,
	tokens: string[],
): Promise<CapabilityDispatchOutcome> {
	let invocation: CapabilityInvocation | null;
	try {
		invocation = resolveCapabilityInvocation(entry, tokens);
	} catch (error) {
		// parseCapabilityArgv throws on a malformed argv (e.g. a missing required positional). Surface it
		// as one `invalid` outcome with the message, so every surface reports a bad argv the same way
		// instead of each catching the throw differently.
		const message = error instanceof Error ? error.message : String(error);
		return { status: "invalid", validation: { valid: false, errors: [{ field: "", message }] } };
	}
	if (!invocation) return { status: "unresolved" };
	// Beyond the parse-level required check, Ajv enforces the schema's types/enums (and coerces string
	// argv values) — the same contract the web form and HTTP surface apply.
	const validation = validateCapabilityArgs(invocation.descriptor, {
		...invocation.input.args,
		...invocation.input.options,
	});
	if (!validation.valid) return { status: "invalid", invocation, validation };
	const envelope = await invocation.descriptor.run(invocation.input);
	return { status: "ran", invocation, validation, envelope };
}
