/**
 * WHAT THE STORED BINDING MEANS — one place, so two readers cannot disagree about it.
 *
 * `modelBindings` held ONE credential id per workspace, and that single seat is why the operator
 * had to decide the personal/corporate crossing at every refusal: a bound seat with no quota left
 * refused, and nothing else could be spent without him rebinding by hand (ISS-157).
 *
 * A workspace may now declare SEVERAL, in order. The list is a declaration of intent made ONCE, in
 * advance — which is precisely what keeps the resolver's doctrine intact: it still spends nothing
 * the operator did not name, and it still never reorders what he ranked.
 *
 * BACKWARD COMPATIBLE BY SHAPE, not by migration. A string is a list of one, so every node that
 * exists today reads identically and nothing has to be rewritten before it works.
 *
 * PURE, and it drops what it cannot read rather than inventing a binding. A binding is an
 * instruction about which account pays; a fabricated one spends money on a guess.
 */
import type { ModelAccountBinding } from "./types.js";

/** The stored shape: one id, or an ordered list of them. */
export type StoredModelBindings = Record<string, string | readonly string[]>;

const idsOf = (value: unknown): string[] => {
	if (typeof value === "string") return [value];
	if (!Array.isArray(value)) return [];
	return value.filter((entry): entry is string => typeof entry === "string");
};

export function bindingsFromConfig(
	stored: StoredModelBindings | null | undefined,
): ModelAccountBinding[] {
	if (!stored || typeof stored !== "object" || Array.isArray(stored)) return [];
	const bindings: ModelAccountBinding[] = [];
	for (const [workspaceId, value] of Object.entries(stored)) {
		if (!workspaceId.trim()) continue;
		for (const raw of idsOf(value)) {
			const credentialId = raw.trim();
			// A repeated id is NOT collapsed: the operator wrote it twice and that is his list.
			// Deduping here would be a silent edit of a declaration — the surface that WRITES the
			// list is where it should be questioned, with him watching.
			if (credentialId) bindings.push({ workspaceId, credentialId });
		}
	}
	return bindings;
}
