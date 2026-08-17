/**
 * RENEWING A COPILOT CREDENTIAL BEFORE THE RUNTIME IS HANDED IT.
 *
 * A Copilot token lasts minutes. The durable material is the `ghu_` in `refresh`, and renewal is a
 * RE-EXCHANGE of it rather than an OAuth `refresh_token` grant — which is why github-copilot is in
 * neither refresh table and why an expired seat simply stayed expired. Measured 2026-08-17: a
 * dispatch that had finally reached Copilot answered `HTTP 401: IDE token expired`.
 *
 * ## Why here, and not only in the daemon
 *
 * `scripts/tractor-start.sh` provisions the Rust runtime from `refarm model env --include-secrets`.
 * On this operator's node the daemon's own injector never runs, so the CLI is the ONLY thing that
 * hands the runtime a credential — and handing it an expired one starts a runtime that cannot
 * dispatch and says nothing until the first request fails.
 *
 * ## A read that writes, deliberately
 *
 * Exporting env is read-shaped and this renews and PERSISTS. The alternative is renewing on every
 * export and never storing it: a fresh token minted per invocation, the stored one permanently
 * stale, and the daemon's own renewal path starting from expired material every time. Persisting
 * makes the renewal happen once and be true afterwards.
 *
 * ONLY WHEN EXPIRED. A live credential is returned untouched and nothing is written or fetched.
 */
import {
	copilotTokenExchangeUrl,
	renewedCopilotCredential,
} from "@refarm.dev/model-account-contract-v1";

export interface CopilotRenewDeps {
	readonly fetch: typeof globalThis.fetch;
	/**
	 * The client identity this node DECLARED it presents to Copilot, already resolved to headers.
	 *
	 * INJECTED, never assumed. The exchange only honours a coherent client: `copilotRequestIdentity`
	 * states it as "BOTH HALVES OR NEITHER — a borrowed client id without the matching headers, or
	 * the reverse, is a shape no real client sends: it impersonates and it does not work." Measured
	 * 2026-08-17: a renewal sending its own invented headers was refused by the endpoint on every
	 * attempt while `copilot_internal/user` answered normally with the same token — which reads
	 * exactly like a network fault and is not one.
	 *
	 * It also keeps the operator's posture honest: clearing `providers.githubCopilot.identity` stops
	 * the imitation everywhere, including here, rather than in the login only.
	 */
	readonly identityHeaders: Readonly<Record<string, string>>;
	/** Persists the renewed credential where the descriptor says it lives. */
	readonly save: (credentialId: string, credential: Record<string, unknown>) => Promise<void>;
	readonly now?: () => number;
}

/** PURE. Whether a stored credential is past the moment it should have been renewed at. */
export function isExpired(credential: unknown, now: number): boolean {
	if (!credential || typeof credential !== "object") return false;
	const expires = (credential as { expires?: unknown }).expires;
	// ABSENT IS NOT EXPIRED. A credential carrying no expiry has not been measured, and renewing on
	// a missing field would re-exchange every start for providers that never expire.
	return typeof expires === "number" && Number.isFinite(expires) && now >= expires;
}

/**
 * Renew one Copilot credential if it is expired, returning what the runtime should be handed.
 *
 * Returns the ORIGINAL credential when it is live, when the exchange fails, or when the stored blob
 * carries no durable token — a failed renewal must not remove a credential that might still be
 * accepted, and the request that follows will say what the provider thinks of it.
 */
export async function renewCopilotIfExpired(
	credentialId: string,
	credential: unknown,
	deps: CopilotRenewDeps,
): Promise<unknown> {
	const now = deps.now?.() ?? Date.now();
	if (!isExpired(credential, now)) return credential;
	const durable = (credential as { refresh?: unknown }).refresh;
	if (typeof durable !== "string" || !durable.startsWith("ghu_")) return credential;
	try {
		const response = await deps.fetch(copilotTokenExchangeUrl(), {
			headers: { ...deps.identityHeaders, Authorization: `Bearer ${durable}` },
		});
		if (!response.ok) return credential;
		const renewed = renewedCopilotCredential(await response.json(), durable);
		if (!renewed) return credential;
		await deps.save(credentialId, renewed as unknown as Record<string, unknown>);
		return renewed;
	} catch {
		return credential;
	}
}

/** Renew every expired Copilot credential among the ones handed in, returning the updated map. */
export async function renewExpiredCopilotCredentials(
	accounts: readonly { credentialId: string; provider: string }[],
	credentials: ReadonlyMap<string, unknown>,
	deps: CopilotRenewDeps,
): Promise<ReadonlyMap<string, unknown>> {
	const next = new Map(credentials);
	for (const account of accounts) {
		if (account.provider !== "github-copilot") continue;
		const credential = credentials.get(account.credentialId);
		if (credential === undefined) continue;
		next.set(
			account.credentialId,
			await renewCopilotIfExpired(account.credentialId, credential, deps),
		);
	}
	return next;
}
