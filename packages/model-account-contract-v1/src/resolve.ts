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
	/**
	 * Seats ALREADY TRIED in this dispatch, never handed back.
	 *
	 * The reactive half of the ordered declaration (ISS-157). A provider refusing a seat for quota
	 * is a FACT; falling to the next seat the operator NAMED needs no prediction about which meter
	 * a model consumes — and predicting it would skip a seat whose `chat` meter is unlimited and
	 * cross the operator's personal/corporate frontier for no reason.
	 *
	 * ONE MEANING EVERYWHERE, including the override and the node default. Handing back a seat the
	 * caller has just learned does not work reads as "try this" and invites a loop.
	 *
	 * IT IS NOT A LICENCE. Excluding the last DECLARED seat refuses; it never falls through to an
	 * account the operator did not name. That property is what keeps the doctrine below intact.
	 */
	readonly excludeCredentialIds?: readonly string[];
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
	const tried = new Set(input.excludeCredentialIds ?? []);
	const untried = (a: ModelAccountDescriptor) => !tried.has(a.credentialId);
	const ofProvider = input.accounts.filter((a) => a.provider === input.provider);
	const eligible = ofProvider.filter((a) => a.health === "healthy" && untried(a));

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
		// EVERY binding for this workspace, IN DECLARED ORDER — a workspace may name more than one
		// seat (ISS-157). One binding meant the operator decided the personal/corporate crossing at
		// every refusal; an ordered list is that same decision made ONCE, in advance. Walking it
		// therefore spends nothing he did not name, which is what keeps the doctrine below intact.
		//
		// THE ORDER IS AN INSTRUCTION ABOUT COST, not a hint: a healthy seat ranked second is never
		// preferred over a healthy seat ranked first, and nothing here sorts.
		const declared = input.bindings.filter((b) => b.workspaceId === input.workspaceId);
		const held = declared
			.map((b) => input.accounts.find((a) => a.credentialId === b.credentialId))
			// A binding naming a credential this node does not hold names nothing to act on, so it
			// is skipped rather than refused on. `credential bind` refuses unknown ids and `forget`
			// refuses while bound, which makes this an anomaly rather than a choice worth honouring.
			.filter((a): a is ModelAccountDescriptor => a !== undefined);

		const usable = held.find((a) => a.health === "healthy" && untried(a));
		if (usable) return snapshot(usable, input.workspaceId, "workspace-binding");

		if (held.length > 0) {
			// NAMED AND UNUSABLE IS A QUESTION, NOT A LICENCE. Falling through here would spend a
			// different account than the one the operator named, silently, and report it as a node
			// default. A binding is an instruction about cost.
			//
			// The code is the FIRST seat's. A refusal carries one code and the seats can fail
			// differently; the one ranked first is the one the operator most wants working, so its
			// repair is the primary one. Every seat is named in the message regardless, because a
			// list that reports only its head hides the work.
			// A SEAT THAT WAS TRIED IS NOT A BROKEN SEAT. Reporting `incomplete` for a healthy
			// account the dispatch already spent sends the operator to repair something that is not
			// wrong; the code therefore comes from the first seat still UNTRIED, and only when every
			// one has been tried does it become "none left".
			const stillUntried = held.filter(untried);
			const first = stillUntried[0];
			const codeOf = (a: ModelAccountDescriptor) =>
				a.health === "unclaimed" ? REFUSAL_CODES.unclaimed : REFUSAL_CODES.incomplete;
			const stateOf = (a: ModelAccountDescriptor) =>
				untried(a) ? a.health : `${a.health}, already tried`;
			// THE SEAT IS NAMED. "a github-copilot account that is healthy" is unreadable on a node
			// holding two Copilot seats, which is the node this exists for.
			const one = held[0]!;
			const listed = held.map((a) => `${a.alias} (${a.provider}, ${stateOf(a)})`).join(", ");
			const message =
				held.length === 1
					? untried(one)
						? `${input.workspaceId} is bound to ${one.alias} (${one.provider}), which is ` +
							`${one.health}. Repair it or bind this workspace elsewhere; nothing else was ` +
							"chosen for it."
						: // Nothing to repair — the seat works and was spent. The repair is a DECLARATION.
							`${input.workspaceId} is bound to ${one.alias} (${one.provider}) and nothing ` +
							"else. It was already tried, so there is no second seat to fall to — declare " +
							"one with `credential bind`, in the order you want them spent."
					: `${input.workspaceId} declared ${held.length} seats and none is usable: ${listed}. ` +
						"Repair one or declare another; nothing outside that list was chosen.";
			return { code: first ? codeOf(first) : REFUSAL_CODES.none, message, candidates: safeCandidates(held) };
		}
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
