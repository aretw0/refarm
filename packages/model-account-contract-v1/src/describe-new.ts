/**
 * A COMPLETED LOGIN, TURNED INTO A DESCRIPTOR — the writer's pure half.
 *
 * This is where a second account of one provider stops being impossible. The old writer keyed the
 * credential by provider and held one slot; this keys it by an opaque id derived from the ACCOUNT,
 * so a personal and a corporate credential of the same provider land in different places and
 * neither can overwrite the other.
 *
 * PURE. It computes; it stores nothing. The caller writes the secret to Silo's `model` namespace
 * and the descriptor to the catalog, in that order, so a failed secret write leaves an `incomplete`
 * entry rather than a descriptor pointing at nothing.
 */
import { descriptorRevision } from "./catalog.js";
import { MODEL_SECRET_NAMESPACE } from "./secret-location.js";
import { newCredentialId, type ModelAccountDescriptor } from "./types.js";

/**
 * PURE. A free alias for a new account of this provider.
 *
 * Aliases are unique per provider and MEAN NOTHING (D1), so this counts rather than describes:
 * inventing `personal` or `corporate` would be prescribing a taxonomy the design refuses, and would
 * be wrong as often as right. The operator renames it whenever he likes, without touching the id.
 */
export function nextFreeAlias(
	provider: string,
	existing: readonly ModelAccountDescriptor[],
): string {
	const taken = new Set(existing.filter((e) => e.provider === provider).map((e) => e.alias));
	if (!taken.has("default")) return "default";
	for (let n = 2; ; n += 1) {
		const candidate = `account-${n}`;
		if (!taken.has(candidate)) return candidate;
	}
}

/**
 * Refused when the provider gave no account id AND this provider already holds an account.
 *
 * The caller must be able to tell this apart from a normal write, because the alternative is what
 * it replaced: falling back to a fixed seed made "I cannot tell which account this is" produce the
 * SAME opaque id as the account already stored, and the second login silently replaced the first.
 * Measured on the operator's node 2026-08-15, after he added two GitHub Copilot accounts and found
 * one.
 */
export interface IndistinguishableAccount {
	readonly refused: true;
	readonly provider: string;
	readonly reason: string;
	readonly existingAliases: readonly string[];
}

/** PURE. Whether `describeNewCredential` refused rather than described. */
export function isIndistinguishableAccount(
	value: ModelAccountDescriptor | IndistinguishableAccount,
): value is IndistinguishableAccount {
	return (value as IndistinguishableAccount).refused === true;
}

export interface DescribeNewCredentialInput {
	readonly provider: string;
	/** The provider's own account identifier, when its token carried one. */
	readonly accountId?: string;
	/** The operator's chosen name. Absent means "pick a free one". */
	readonly alias?: string;
	readonly existing: readonly ModelAccountDescriptor[];
	/** A digest of the secret about to be written, so the revision moves when the secret does. */
	readonly secretDigest: string;
}

/**
 * PURE. The catalog entry for a credential that has just been obtained, or a refusal.
 *
 * ABSENCE OF AN ACCOUNT ID IS NOT SAMENESS. A first credential for a provider may be stored without
 * one — nothing is at risk, there is nothing to collide with. A SECOND cannot: without an id there
 * is no way to tell a re-login of the stored account from a different account, and both answers are
 * destructive if guessed. Guessing "same" replaces a working credential; guessing "different" would
 * need an id this function does not have.
 *
 * The alias is not a substitute. It is operator-chosen and renameable, and seeding the opaque id
 * from it would break the one guarantee the id exists for: that a rename leaves every binding
 * pointing where it did.
 */
export function describeNewCredential(
	input: DescribeNewCredentialInput,
): ModelAccountDescriptor | IndistinguishableAccount {
	const siblings = input.existing.filter((entry) => entry.provider === input.provider);
	if (!input.accountId && siblings.length > 0) {
		return {
			refused: true,
			provider: input.provider,
			reason:
				`${input.provider} did not say which account this credential belongs to, and this node already ` +
				`holds ${siblings.length} for it. Storing it would either replace one of them or duplicate it, ` +
				`and nothing here can tell which.`,
			existingAliases: siblings.map((entry) => entry.alias),
		};
	}
	// SEEDED BY THE ACCOUNT, never by the alias or the moment. A re-login of the same account must
	// produce the same id so it replaces its own entry instead of accumulating one per login, and a
	// rename must not move it or every binding pointing at it breaks.
	const credentialId = newCredentialId(`${input.provider}:${input.accountId ?? "default"}`);
	const alias = input.alias ?? nextFreeAlias(input.provider, input.existing);
	return {
		credentialId,
		provider: input.provider,
		alias,
		// VERIFIED ONLY WITH AN ACCOUNT ID. One extracted from the provider's own token is the
		// provider saying who this is. Without one nothing was confirmed, and a false `verified`
		// would travel into budget and status output where identity claims are believed.
		identity: input.accountId
			? { status: "verified", subject: input.accountId }
			: { status: "unverified" },
		secretRef: `${MODEL_SECRET_NAMESPACE}/${credentialId}`,
		// Claimed here, CONFIRMED by `reconcileCatalog` against the secrets that exist. This function
		// cannot see the store, so it must not pretend to have checked.
		health: "healthy",
		revision: descriptorRevision({
			secretDigest: input.secretDigest,
			provider: input.provider,
			alias,
			...(input.accountId ? { identitySubject: input.accountId } : {}),
		}),
	};
}
