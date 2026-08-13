/**
 * WHOSE ACCOUNT IS THIS? — the question that makes ISS-122's destruction avoidable.
 *
 * `tokens.oauthCredentials` holds ONE slot per provider. Authenticating a second account of the
 * same provider overwrites the first with no copy kept and no warning. Measured against a real
 * silo on 2026-08-12: after a corporate login the personal credential was simply gone.
 *
 * THIS DOES NOT FIX THE SHAPE. Whether an account becomes a dimension of the credential key, or
 * credentials are scoped by workspace and the workspace carries the account, is the operator's
 * decision — it reaches how he picks which quota a piece of work spends. What is safe to do before
 * that decision, and what this file does, is refuse to perform the irreversible write in silence.
 *
 * The prior art for the key itself is `agents-lab`'s pi-stack, which models identity as
 * `buildProviderAccountKey(provider, account)` and returns the bare provider when there is no
 * account — a shape whose migration costs nothing, since every existing single-account entry keeps
 * the key it already has.
 */

/** A stored or incoming OAuth credential, as far as this question needs to see it. */
interface AccountBearing {
	readonly accountId?: unknown;
}

/**
 * THREE STATES AND A FOURTH THAT IS NOT A FAILURE.
 *
 * `unknown` is the one that carries the discipline: `accountId` is OPTIONAL — `openai-codex.ts`
 * sets it only when it can extract one from the token — so absence must not be read as agreement.
 * Reading it as `same-account` restores the silent overwrite; reading it as `different-account`
 * would block a legitimate re-authentication of a credential stored before accounts were recorded.
 */
export type AccountVerdict =
	| { readonly kind: "first" }
	| { readonly kind: "same-account"; readonly account: string }
	| { readonly kind: "different-account"; readonly stored: string; readonly incoming: string }
	| { readonly kind: "unknown"; readonly reason: string };

function accountOf(value: unknown): string | null {
	if (!value || typeof value !== "object") return null;
	const id = (value as AccountBearing).accountId;
	return typeof id === "string" && id.length > 0 ? id : null;
}

/** PURE. Whether writing `incoming` over `stored` would replace a DIFFERENT account. */
export function compareStoredAccount(stored: unknown, incoming: unknown): AccountVerdict {
	if (stored === undefined || stored === null) return { kind: "first" };
	if (typeof stored !== "object") {
		// Something is in the slot and it is not a credential this code understands. That is not an
		// empty slot, and treating it as one would overwrite it.
		return { kind: "unknown", reason: "the stored value is not a credential this build can read" };
	}
	const storedAccount = accountOf(stored);
	const incomingAccount = accountOf(incoming);
	if (!storedAccount || !incomingAccount) {
		return {
			kind: "unknown",
			reason: !storedAccount
				? "the stored credential does not record which account it belongs to"
				: "the new credential does not record which account it belongs to",
		};
	}
	if (storedAccount === incomingAccount) return { kind: "same-account", account: storedAccount };
	return { kind: "different-account", stored: storedAccount, incoming: incomingAccount };
}

/** The flag that makes the destructive write a choice rather than an accident. */
export const REPLACE_ACCOUNT_FLAG = "--replace-account";

/**
 * PURE. What to tell the operator, or `null` when there is nothing worth saying.
 *
 * A normal login — a first one, or a re-authentication of the same account — stays quiet. Warning
 * on every login is how a warning stops being read.
 */
export function describeAccountVerdict(verdict: AccountVerdict, provider: string): string | null {
	switch (verdict.kind) {
		case "first":
		case "same-account":
			return null;
		case "different-account":
			return (
				`this ${provider} login is a DIFFERENT account than the one already stored ` +
				`(stored: ${verdict.stored}, new: ${verdict.incoming}). There is one slot per provider, ` +
				`so writing it would destroy the stored credential with no copy kept. ` +
				`Pass ${REPLACE_ACCOUNT_FLAG} if that is what you want.`
			);
		case "unknown":
			return (
				`cannot tell whether this ${provider} login is the same account as the one already ` +
				`stored — ${verdict.reason}. There is one slot per provider, so if it is a different ` +
				`account the stored credential is being replaced.`
			);
	}
}
