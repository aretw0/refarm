import { parseCapabilityArgv } from "./parse-argv.js";
import type { CapabilityDescriptor, CapabilityGroup, CapabilityInput } from "./types.js";

/**
 * Resolve a group invocation to the sub-action to run + its parsed input, from
 * ONE token list — the same resolution both the CLI group projector and the
 * REPL group dispatcher use, so the CLI `model current` form and the `/model
 * current` slash form can never drift on how they pick and parse a sub-action.
 *
 * Rules (matching the existing UX, see the design spec):
 * - A group's custom token grammar (`group.resolve`) wins first, if it returns a
 *   resolution — for verbs whose form is richer than sub-verb dispatch (e.g.
 *   `model <ref>` → `set default <ref>`). Surface-neutral: the same grammar
 *   applies whether the tokens came from a slash, an argv, or a path. It maps
 *   tokens → a `{key, tokens}`; we parse those into the chosen child's input.
 * - `[]` → the group's `defaultAction` (e.g. `model` / `/model` → `current`).
 * - `[<sub>, …rest]` where `<sub>` is a known action key → that child, parsed
 *   from `…rest`.
 * - `[<token>, …]` where `<token>` is NOT an action key → the `defaultAction`
 *   parsed from the WHOLE token list (this is the group-default-with-args form,
 *   e.g. `model <ref>` sugar for the default action's positional).
 *
 * Returns null only when there is no matching action and no default — the caller
 * renders the group help. `run()` is never called here; this is pure resolution.
 */
export interface ResolvedGroupAction {
	action: CapabilityDescriptor;
	/** The sub-verb key chosen (the default action's key when defaulted). */
	key: string;
	input: CapabilityInput;
}

export function resolveGroupAction(
	group: CapabilityGroup,
	tokens: string[],
): ResolvedGroupAction | null {
	// A group's own token grammar takes precedence — but only for a resolution
	// whose key names a real action. An unknown key falls through to the generic
	// rules rather than dispatching nowhere.
	const custom = group.resolve?.(tokens);
	if (custom && custom.key in group.actions) {
		const action = group.actions[custom.key]!;
		return { action, key: custom.key, input: parseCapabilityArgv(action, custom.tokens) };
	}

	const [first, ...rest] = tokens;

	// Explicit known sub-action.
	if (first !== undefined && first.toLowerCase() in normalizeKeys(group)) {
		const key = resolveKey(group, first);
		const action = group.actions[key]!;
		return { action, key, input: parseCapabilityArgv(action, rest) };
	}

	// Fall back to the default action; feed it the WHOLE token list so a
	// group-default-with-args form (`model <ref>`) reaches the default's args.
	if (group.defaultAction) {
		const action = group.actions[group.defaultAction];
		if (action) {
			return {
				action,
				key: group.defaultAction,
				input: parseCapabilityArgv(action, tokens),
			};
		}
	}

	return null;
}

/** Lowercased action keys → canonical key, for case-insensitive sub-verb lookup. */
function normalizeKeys(group: CapabilityGroup): Record<string, string> {
	const map: Record<string, string> = {};
	for (const key of Object.keys(group.actions)) {
		map[key.toLowerCase()] = key;
	}
	return map;
}

function resolveKey(group: CapabilityGroup, sub: string): string {
	return normalizeKeys(group)[sub.toLowerCase()]!;
}
