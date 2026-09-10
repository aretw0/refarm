/**
 * RENEWING A CODEX CREDENTIAL BEFORE THE RUNTIME IS HANDED IT.
 *
 * ISS-081, and the half of it that was never built. Measured on the operator's node 2026-08-23:
 * both Copilot seats lapsed at 23:35 and were re-exchanged without anyone typing anything, while
 * the codex seat carried `expires` 2026-08-27T17:06:18Z with nothing in this repository able to
 * touch it. `refreshLiveCredentials` filtered on `provider === "github-copilot"` before asking
 * whether anything had expired, so `refarm credential renew` — whose help reads "Renew what has
 * lapsed" — would answer "Nothing had lapsed" on the day it did.
 *
 * ## Why this is not `openaiCodexOAuthProvider.refreshToken`
 *
 * That method exists, is correct, and drives the GLOBAL `fetch`. This module runs on the dispatch
 * path, where every other network call is injected so the suite can drive it without a round trip
 * — `copilot-renew` takes `deps.fetch` for exactly that reason. Reaching through the provider
 * interface would have put an untestable call in the middle of a tested path. The endpoint and
 * client id are IMPORTED from the login rather than restated, so the two cannot drift.
 *
 * ## The refresh token rotates, and losing it is unrecoverable
 *
 * OpenAI's refresh grant returns a NEW `refresh_token` and may retire the one presented. A renewal
 * that persists the access token and drops the rotation leaves this node holding a credential the
 * provider has already retired — the next renewal fails, and the only way back is a manual
 * `refarm sow`. The whole credential is saved, never a field of it.
 *
 * ONLY WHEN EXPIRED, and a refusal RETURNS THE ORIGINAL: the rules `copilot-renew` already states.
 * A failed renewal must not remove a credential the provider might still accept.
 */
import { CODEX_CLIENT_ID, CODEX_TOKEN_URL } from "./oauth/openai-codex.js";

const RENEW_HTTP_TIMEOUT_MS = 30_000;

export interface CodexRenewDeps {
	readonly fetch: typeof globalThis.fetch;
	/** Persists the renewed credential where the descriptor says it lives. */
	readonly save: (credentialId: string, credential: Record<string, unknown>) => Promise<void>;
	/**
	 * The clock the CALLER is using, so one renewal cycle has one `now`.
	 *
	 * The grant returns `expires_in`, a duration, and the absolute moment it becomes must be
	 * computed against the same clock the caller judged expiry with. Reading `Date.now()` here
	 * instead put a second clock in one cycle and left the written expiry unassertable.
	 */
	readonly now?: () => number;
}

/**
 * Renew one codex credential if it is expired, returning what the runtime should be handed.
 *
 * The caller decides expiry (`isExpired` in `copilot-renew`), so this module holds no clock: one
 * definition of "expired" for both providers, and no second place for it to drift.
 */
export async function renewCodex(
	credentialId: string,
	credential: unknown,
	deps: CodexRenewDeps,
): Promise<unknown> {
	const durable = (credential as { refresh?: unknown })?.refresh;
	// ABSENT IS NOT EXPIRED, and a blob with no durable token cannot be renewed by anything here.
	if (typeof durable !== "string" || durable.trim().length === 0) return credential;
	try {
		const response = await deps.fetch(CODEX_TOKEN_URL, {
			method: "POST",
			headers: { "content-type": "application/x-www-form-urlencoded" },
			body: new URLSearchParams({
				grant_type: "refresh_token",
				client_id: CODEX_CLIENT_ID,
				refresh_token: durable,
			}),
			signal: AbortSignal.timeout(RENEW_HTTP_TIMEOUT_MS),
		});
		if (!response.ok) return credential;
		const body = (await response.json()) as {
			access_token?: unknown;
			refresh_token?: unknown;
			expires_in?: unknown;
		};
		if (typeof body.access_token !== "string" || typeof body.expires_in !== "number") {
			return credential;
		}
		const renewed = {
			...(credential as Record<string, unknown>),
			access: body.access_token,
			// THE ROTATION IS KEPT WHEN THE PROVIDER SENDS ONE, and the presented token is kept when
			// it does not. Writing `undefined` over a working refresh token would brick the seat on
			// a response shape that simply omitted the field.
			...(typeof body.refresh_token === "string" ? { refresh: body.refresh_token } : {}),
			expires: (deps.now?.() ?? Date.now()) + body.expires_in * 1000,
		};
		await deps.save(credentialId, renewed);
		return renewed;
	} catch {
		return credential;
	}
}
