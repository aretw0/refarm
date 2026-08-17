/**
 * D3 — RESOLUTION IS EXPLICIT, SURFACE-NEUTRAL AND FAIL-CLOSED.
 *
 * Precedence, and there is no fifth option:
 *   1. an explicit, authorised dispatch override
 *   2. the node-owned workspace binding — WHICH DECIDES THE PROVIDER TOO (ISS-131)
 *   3. a node default ONLY when exactly one eligible credential exists
 *   4. refusal
 *
 * `provider` is therefore the route's provider: what this node would use if no binding spoke. A
 * workspace-scoped run whose workspace is bound resolves to that account whatever the route says,
 * because the binding is the operator's instruction about which account his work spends.
 *
 * WHAT IS NOT A SELECTOR, listed because each one has been a selector in some tool: the current
 * working directory, the last login, the last used account, the provider's model default, and any
 * ambient environment variable. This function takes no `cwd`, no clock and no `process.env` — the
 * guarantee is kept by the signature, not by discipline.
 *
 * PURE. Every input is passed in, so a surface cannot resolve differently from the runtime, and the
 * ambiguity refusal can be tested against a node that does not exist.
 */
import {
	REFUSAL_CODES,
	type DispatchSnapshot,
	type ModelAccountBinding,
	type ModelAccountDescriptor,
	type ModelAccountRefusal,
} from "./types.js";

export interface ResolveInput {
	readonly provider: string;
	readonly accounts: readonly ModelAccountDescriptor[];
	readonly bindings: readonly ModelAccountBinding[];
	/** `null` when the dispatch has no workspace — a node-level ask. */
	readonly workspaceId: string | null;
	readonly overrideCredentialId?: string;
}

export function isRefusal(value: unknown): value is ModelAccountRefusal {
	return typeof value === "object" && value !== null && "code" in value;
}

/** SAFE by construction: id and alias only, never identity, never the secret reference. */
const safeCandidates = (accounts: readonly ModelAccountDescriptor[]) =>
	accounts.map((a) => ({ credentialId: a.credentialId, alias: a.alias }));

const snapshot = (
	account: ModelAccountDescriptor,
	workspaceId: string | null,
	source: DispatchSnapshot["source"],
): DispatchSnapshot => ({
	workspaceId,
	provider: account.provider,
	credentialId: account.credentialId,
	credentialAlias: account.alias,
	credentialRevision: account.revision,
	source,
});

export function resolveModelAccount(input: ResolveInput): DispatchSnapshot | ModelAccountRefusal {
	const ofProvider = input.accounts.filter((a) => a.provider === input.provider);
	const eligible = ofProvider.filter((a) => a.health === "healthy");

	if (input.overrideCredentialId) {
		const chosen = eligible.find((a) => a.credentialId === input.overrideCredentialId);
		if (chosen) return snapshot(chosen, input.workspaceId, "dispatch-override");
		return {
			code: REFUSAL_CODES.none,
			message: `the requested credential is not an eligible ${input.provider} account on this node`,
			candidates: safeCandidates(eligible),
		};
	}

	// THE BINDING OUTRANKS THE ROUTE, on the operator's ruling of 2026-08-17 (ISS-131): a
	// workspace-scoped run is decided by that workspace's binding; a node-level run by whatever the
	// node is associated with. So `input.provider` is what this node would use ABSENT a binding, and
	// the search below is over EVERY account rather than `ofProvider`.
	//
	// It used to be inside the provider filter, justified as "a workspace may be bound per provider"
	// — a shape the store cannot express, since `modelBindings` holds one credential per workspace.
	// Measured on the operator's node with both his bindings pointing at Copilot accounts and the
	// route naming openai-codex: BOTH were inert. Not overridden — never consulted, because a
	// binding to another provider's account had no way to be reached.
	if (input.workspaceId) {
		const bound = input.bindings.find((b) => b.workspaceId === input.workspaceId);
		const held = bound && input.accounts.find((a) => a.credentialId === bound.credentialId);
		if (held?.health === "healthy") return snapshot(held, input.workspaceId, "workspace-binding");
		if (held) {
			// NAMED AND UNUSABLE IS A QUESTION, NOT A LICENCE. Falling through here would spend a
			// different account than the one the operator named, silently, and report it as a node
			// default. A binding is an instruction about cost.
			return {
				code: held.health === "unclaimed" ? REFUSAL_CODES.unclaimed : REFUSAL_CODES.incomplete,
				message:
					`${input.workspaceId} is bound to a ${held.provider} account that is ${held.health}. ` +
					"Repair it or bind this workspace elsewhere; nothing else was chosen for it.",
				candidates: safeCandidates([held]),
			};
		}
		// A binding naming a credential this node does not hold names nothing to act on, so the
		// resolution continues. `credential bind` refuses unknown ids and `forget` refuses while
		// bound, which makes this an anomaly rather than a choice worth honouring.
	}

	if (eligible.length === 1) return snapshot(eligible[0]!, input.workspaceId, "node-default");

	if (eligible.length > 1) {
		return {
			code: REFUSAL_CODES.ambiguous,
			message:
				`${eligible.length} ${input.provider} accounts are eligible and nothing said which to use. ` +
				`Bind one to this workspace, or name one explicitly.`,
			candidates: safeCandidates(eligible),
		};
	}

	// Zero eligible. WHY it is zero is three different sentences, and an operator repairs each one
	// differently: nothing is registered, a secret is missing, or a secret has no descriptor.
	const incomplete = ofProvider.filter((a) => a.health === "incomplete");
	if (incomplete.length > 0) {
		return {
			code: REFUSAL_CODES.incomplete,
			message: `every ${input.provider} account on this node is missing its secret`,
			candidates: safeCandidates(incomplete),
		};
	}
	const unclaimed = ofProvider.filter((a) => a.health === "unclaimed");
	if (unclaimed.length > 0) {
		return {
			code: REFUSAL_CODES.unclaimed,
			message: `a ${input.provider} secret exists with no descriptor — repair or remove it`,
			candidates: safeCandidates(unclaimed),
		};
	}
	return {
		code: REFUSAL_CODES.none,
		message: `no ${input.provider} account is registered on this node`,
		candidates: [],
	};
}
