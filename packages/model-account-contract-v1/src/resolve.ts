/**
 * D3 — RESOLUTION IS EXPLICIT, SURFACE-NEUTRAL AND FAIL-CLOSED.
 *
 * Precedence, and there is no fifth option:
 *   1. an explicit, authorised dispatch override
 *   2. the node-owned workspace binding
 *   3. a node default ONLY when exactly one eligible credential exists
 *   4. refusal
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

	if (input.workspaceId) {
		const bound = input.bindings.find((b) => b.workspaceId === input.workspaceId);
		const chosen = bound && eligible.find((a) => a.credentialId === bound.credentialId);
		// A binding naming a credential that is not this provider's simply does not match, and the
		// resolution continues rather than refusing: a workspace may be bound per provider.
		if (chosen) return snapshot(chosen, input.workspaceId, "workspace-binding");
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
