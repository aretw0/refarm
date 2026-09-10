/**
 * WHAT THIS NODE IS AUTHORISED TO SPEND — declared by its operator, never inferred.
 *
 * ISS-131 tier 3, on the operator's ruling of 2026-08-17: a workspace-scoped run is decided by
 * that workspace's binding; a node-level run by whatever the node is associated with; and a node
 * with nothing associated must DECLARE that — either "approved to use everything this node holds"
 * or "approved only for these".
 *
 * ## Undeclared is its own state, and that is the entire point
 *
 * Blanket approval is a legitimate answer and a cheap one to give. It just has to BE GIVEN. A node
 * that never chose must stay distinguishable from one that chose everything, because here silence
 * spends money — and every other absence in this contract already follows that rule (a legacy blob
 * with no subject, a provider that declines to state a quota, a meter nobody could read).
 *
 * `undeclared` therefore authorises NOTHING, which is also what makes adopting this safe: today's
 * host resolves a primary route from its own configuration and treats the authorised set as an
 * ADDITION to it. An undeclared node keeps behaving exactly as it does now and is told what it has
 * not said.
 *
 * ## Why a declaration rather than a credential
 *
 * The industry answer to "which account may this workload spend" is a per-tenant VIRTUAL KEY: one
 * revocable, budgeted credential, so a leak costs a budget rather than the account. That answer is
 * unavailable here — a Copilot seat and a ChatGPT subscription issue no sub-credentials, so there
 * is nothing to hand out per workspace. Where a gateway expresses the boundary as a key, this node
 * can only express it as a declaration, and the declaration is what the host's egress allowlist is
 * then derived from.
 *
 * PURE. Takes a parsed config and a set of accounts; performs no I/O and reads no environment.
 */
import type { ModelAccountDescriptor } from "./types.js";

export const MODEL_AUTHORIZATION_KEY = "modelAuthorization";

export type ModelAuthorization =
	/** Nobody has said. Authorises nothing, and is NOT the same as authorising nothing on purpose. */
	| { readonly scope: "undeclared" }
	/** Everything this node holds, said out loud. A legitimate answer, and a given one. */
	| { readonly scope: "all"; readonly declaredAt?: string }
	/** Exactly these accounts, by OPAQUE id — never by alias, which may be renamed (D2). */
	| { readonly scope: "declared"; readonly accounts: readonly string[]; readonly declaredAt?: string };

export interface AuthorizedAccounts {
	/** Held by this node, healthy, and authorised. The only accounts anything may spend. */
	readonly authorized: readonly ModelAccountDescriptor[];
	/** Declared and NOT held by this node. Reported rather than dropped — a declaration naming an
	 *  account that is gone is a stale authorization, and silence would make it look satisfied. */
	readonly unknown: readonly string[];
	/** Declared, held, and not usable. Distinct from `unknown`: this one is repairable. */
	readonly unusable: readonly string[];
}

const str = (value: unknown): string | undefined =>
	typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;

/**
 * PURE. The declaration inside a parsed config, or `undeclared`.
 *
 * A MALFORMED DECLARATION READS AS UNDECLARED rather than as `all`. Every failure of this parser
 * must land on the state that authorises nothing; the alternative is a typo widening what a node
 * may spend.
 */
export function readModelAuthorization(config: unknown): ModelAuthorization {
	if (!config || typeof config !== "object" || Array.isArray(config)) return { scope: "undeclared" };
	const raw = (config as Record<string, unknown>)[MODEL_AUTHORIZATION_KEY];
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { scope: "undeclared" };
	const record = raw as Record<string, unknown>;
	const declaredAt = str(record.declaredAt);
	const scope = str(record.scope);
	if (scope === "all") return { scope: "all", ...(declaredAt ? { declaredAt } : {}) };
	if (scope !== "declared") return { scope: "undeclared" };
	const accounts = Array.isArray(record.accounts)
		? record.accounts.flatMap((entry) => {
				const id = str(entry);
				return id ? [id] : [];
			})
		: [];
	// An EMPTY declared list is still a declaration: the operator said "these", and named none. It
	// authorises nothing and it is not silence — anything reading this can tell the two apart, and
	// the surface that renders it can say so.
	return { scope: "declared", accounts, ...(declaredAt ? { declaredAt } : {}) };
}

/** PURE. Which of this node's accounts the declaration actually authorises. */
export function authorizedAccounts(
	authorization: ModelAuthorization,
	accounts: readonly ModelAccountDescriptor[],
): AuthorizedAccounts {
	if (authorization.scope === "undeclared") {
		return { authorized: [], unknown: [], unusable: [] };
	}
	if (authorization.scope === "all") {
		// HEALTHY ONLY, even under blanket approval. "Everything this node holds" is about permission,
		// not about repair: an `incomplete` account has no secret to spend and offering it would send
		// a dispatch at a credential that is not there.
		return {
			authorized: accounts.filter((a) => a.health === "healthy"),
			unknown: [],
			unusable: [],
		};
	}
	const held = new Map(accounts.map((a) => [a.credentialId, a]));
	const authorized: ModelAccountDescriptor[] = [];
	const unknown: string[] = [];
	const unusable: string[] = [];
	for (const id of authorization.accounts) {
		const account = held.get(id);
		if (!account) {
			unknown.push(id);
			continue;
		}
		if (account.health !== "healthy") {
			unusable.push(id);
			continue;
		}
		authorized.push(account);
	}
	return { authorized, unknown, unusable };
}

/**
 * PURE. The providers a host may be allowed to reach, from the authorised accounts.
 *
 * De-duplicated and stable in order, because it becomes an egress allowlist and an allowlist that
 * reorders between boots is one nobody can diff. Two accounts of one provider contribute ONE
 * provider: the allowlist bounds where the host may send, and which account pays is decided above
 * it by the binding.
 */
export function authorizedProviders(authorized: AuthorizedAccounts): readonly string[] {
	const seen = new Set<string>();
	const out: string[] = [];
	for (const account of authorized.authorized) {
		if (seen.has(account.provider)) continue;
		seen.add(account.provider);
		out.push(account.provider);
	}
	return out;
}

/**
 * PURE. What an operator should be told, or `null` when there is nothing to say.
 *
 * SEPARATE FROM THE DECISION, so a reader can act on `authorizedAccounts` without printing and a
 * surface can print without re-deriving. Undeclared produces a sentence rather than a warning: it
 * is not a fault, it is a question nobody has answered yet.
 */
export function describeAuthorization(
	authorization: ModelAuthorization,
	authorized: AuthorizedAccounts,
): string | null {
	if (authorization.scope === "undeclared") {
		// THE FACT, NOT THE COMMAND. A generic contract that names one CLI's verb cannot be reused by
		// another surface, and the brand guard is right to refuse it: handoffs are the CLI's to
		// render, from `nextCommands`, where every other one already lives.
		return (
			"this node has not declared what it is authorised to spend, so only its configured route " +
			"is reachable."
		);
	}
	const notes: string[] = [];
	if (authorized.unknown.length > 0) {
		notes.push(
			`authorised accounts this node does not hold: ${authorized.unknown.join(", ")} — the ` +
				"declaration is stale, not satisfied.",
		);
	}
	if (authorized.unusable.length > 0) {
		notes.push(
			`authorised but not usable: ${authorized.unusable.join(", ")} — repair or re-authenticate.`,
		);
	}
	if (authorization.scope === "declared" && authorization.accounts.length === 0) {
		notes.push("the declaration names no account, so nothing beyond the configured route is reachable.");
	}
	return notes.length > 0 ? notes.join(" ") : null;
}

/**
 * PURE. The one account per provider this node may provision, and the providers it must refuse.
 *
 * ONE CREDENTIAL ENV VAR PER PROVIDER is the shape the host reads — `bearer_key_for_provider`
 * takes a provider and nothing else — so two authorised accounts of one provider cannot both be
 * present. Picking one silently is the confused deputy realised: the node would spend an account
 * the operator did not choose and report the other as payer.
 *
 * SO IT REFUSES, per provider, and says which aliases collided. That is also what makes the
 * declaration useful rather than decorative: authorising exactly one account per provider is what
 * makes a node serviceable today, and authorising two of one provider is precisely the case that
 * needs per-task enforcement in the host (ISS-140).
 */
export function provisionableAccounts(input: {
	readonly catalog: readonly ModelAccountDescriptor[];
	readonly authorization: ModelAuthorization;
}): {
	readonly provision: readonly ModelAccountDescriptor[];
	readonly ambiguous: readonly { provider: string; aliases: readonly string[] }[];
} {
	const { authorized } = authorizedAccounts(input.authorization, input.catalog);
	const byProvider = new Map<string, ModelAccountDescriptor[]>();
	for (const account of authorized) {
		const list = byProvider.get(account.provider);
		if (list) list.push(account);
		else byProvider.set(account.provider, [account]);
	}
	const provision: ModelAccountDescriptor[] = [];
	const ambiguous: { provider: string; aliases: string[] }[] = [];
	for (const [provider, list] of byProvider) {
		if (list.length === 1) provision.push(list[0]!);
		else ambiguous.push({ provider, aliases: list.map((a) => a.alias) });
	}
	return { provision, ambiguous };
}
