/**
 * THE CREDENTIAL THE RUNNING NODE IS HOLDING, AND WHEN IT WENT STALE.
 *
 * MEASURED 2026-08-18: every `refarm ask` failed with `HTTP 401: IDE token expired`, and a runtime
 * restart fixed it. The cause is structural rather than a bad token — the host reads
 * `MODEL_ACCOUNT_CREDENTIALS` from its OWN PROCESS ENVIRONMENT (`std::env::var`, wasi_bridge/core.rs),
 * which is fixed at spawn. Renewal runs when the model capability is provisioned. So:
 *
 *   a credential with a finite life  +  a process handed it once  =  a node that expires
 *
 * Nothing renews in place, and no endpoint re-provisions a live runtime. The token outlives about a
 * day, which is exactly long enough for the failure to look random.
 *
 * This does not fix that. It stops the node from reporting it as a provider refusal: a 401 that
 * says "unauthorized" reads like a revoked credential or a network fault, and sends the operator
 * to re-authenticate something that is fine.
 */

/** PURE. The moment a stored credential says it stops being accepted, or nothing. */
export function credentialExpiry(credential: unknown): number | null {
	if (!credential || typeof credential !== "object") return null;
	const expires = (credential as { expires?: unknown }).expires;
	return typeof expires === "number" && Number.isFinite(expires) ? expires : null;
}

export type StalenessVerdict =
	/** No expiry is stated. Not the same as fresh — nothing measured it. */
	| { readonly state: "unknown" }
	| { readonly state: "fresh"; readonly minutesLeft: number }
	| { readonly state: "expired"; readonly minutesAgo: number; readonly because: string };

/**
 * PURE. Whether the credential this node would spend has already lapsed.
 *
 * `nowMs` is injected so a test pins the clock rather than inheriting the moment it runs.
 */
export function credentialStaleness(credential: unknown, nowMs: number): StalenessVerdict {
	const expires = credentialExpiry(credential);
	if (expires === null) return { state: "unknown" };
	// MILLISECONDS. Measured 2026-08-19 on a real stored credential: `expires` is 1787193667000,
	// which is a day out in ms and the year 58603 in seconds. The seconds reading was written
	// first and would have made this check INERT — every credential fresh for fifty thousand
	// years, a guard that can never fire being worse than no guard, because it reads as covered.
	const expiresMs = expires;
	if (nowMs < expiresMs) {
		return { state: "fresh", minutesLeft: Math.round((expiresMs - nowMs) / 60_000) };
	}
	return {
		state: "expired",
		minutesAgo: Math.round((nowMs - expiresMs) / 60_000),
		because:
			"the model credential this node holds expired, and the running runtime was handed it at " +
			"boot — it cannot pick up a renewed one on its own. Restart the runtime to re-provision: " +
			"`refarm runtime restart --wait`. This is not the provider refusing you.",
	};
}
