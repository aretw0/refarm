import type { WebSourceSessionEvidence } from "./types.js";

/**
 * The LOGIN-GARANTIDO seam — "authenticate before you scrape". A real requirements analyst
 * must log in to their ALM before pulling anything; the source snapshot already MODELS the
 * session (principal, credentialRef, authenticated, expiry) but nothing PRODUCED it or
 * gated on it. This closes that: ensureAuthenticatedSession returns a valid session for a
 * target, reusing a cached one or running an interactive login when none is valid.
 *
 * The interactive LOGIN itself is injected — the substrate ships the lifecycle (is there a
 * valid session? if not, log in; is it expired? re-login), a consumer brings the driver.
 * Today a fixture login returns instantly (offline, testable); a real light browser driver
 * (a CDP/WebDriver client — chosen later) would open the ALM, wait for the human to sign in,
 * and hand back the session + credentialRef. The gate and its contract don't change when the
 * real driver arrives — only the injected `login` does.
 */

export interface SessionTarget {
	/** The system identity the session is for (e.g. "efd"). */
	identity: string;
	/** Where the session's credential is / would be stored (e.g. "silo://analyst/alm"). */
	credentialRef?: string;
}

/** Runs the actual sign-in for a target and returns fresh session evidence. Injected: a
 * fixture returns instantly; a real driver awaits a human login. May reject (login failed /
 * cancelled). */
export type InteractiveLogin = (target: SessionTarget) => Promise<WebSourceSessionEvidence>;

export interface EnsureSessionOptions {
	target: SessionTarget;
	/** How to obtain a fresh session when none is valid (the injected driver). */
	login: InteractiveLogin;
	/** An already-known session (e.g. read from a cache/ledger) to reuse if still valid. */
	existing?: WebSourceSessionEvidence;
	/** The current time, for expiry checks. Defaults to Date-free callers passing a stamp. */
	now?: () => number;
}

export interface EnsureSessionResult {
	session: WebSourceSessionEvidence;
	/** true if `login` ran (a fresh sign-in), false if an existing session was reused. */
	loggedIn: boolean;
}

/** Is this session valid right now — authenticated and not past its `expiresAt`? A `fixture`
 * session counts as valid (that's the offline stand-in for "logged in"); the REUSE policy
 * below is what decides a fixture doesn't prove a real login happened. */
export function isSessionValid(
	session: WebSourceSessionEvidence | undefined,
	nowMs: number,
): session is WebSourceSessionEvidence {
	if (!session || !session.authenticated) return false;
	if (session.expiresAt) {
		const expiry = Date.parse(session.expiresAt);
		if (Number.isFinite(expiry) && expiry <= nowMs) return false;
	}
	return true;
}

/** May we REUSE this existing session and skip login? Only a REAL authenticated session
 * counts — a `fixture` session is what the loader synthesizes for a target with no declared
 * session (an offline body-holder), so reusing it would silently bypass login-garantido. A
 * declared `authenticated` session (the analyst's cached ALM session) is honored. */
function isReusableSession(
	session: WebSourceSessionEvidence | undefined,
	nowMs: number,
): session is WebSourceSessionEvidence {
	return isSessionValid(session, nowMs) && session.kind === "authenticated";
}

/**
 * Ensure a valid authenticated session for a target: reuse `existing` if still valid, else
 * run the injected `login`. Returns the session + whether a fresh login happened. This is
 * the gate a pull runs first — "you're logged in, now I can scrape".
 */
export async function ensureAuthenticatedSession(
	options: EnsureSessionOptions,
): Promise<EnsureSessionResult> {
	const nowMs = options.now ? options.now() : sessionNow();
	if (isReusableSession(options.existing, nowMs)) {
		return { session: options.existing, loggedIn: false };
	}
	const session = await options.login(options.target);
	return { session, loggedIn: true };
}

/** A fixture login — returns an already-authenticated session immediately (offline path).
 * The stand-in for a real interactive driver; hands back a session tagged `fixture`. */
export function fixtureLogin(overrides: Partial<WebSourceSessionEvidence> = {}): InteractiveLogin {
	return async (target) => ({
		kind: "fixture",
		authenticated: true,
		principal: overrides.principal ?? "fixture-operator",
		startedAt: overrides.startedAt,
		expiresAt: overrides.expiresAt,
		credentialRef:
			overrides.credentialRef ?? target.credentialRef ?? `silo://fixture/${target.identity}`,
		...overrides,
	});
}

/** `Date.now()` is unavailable in some substrate contexts; keep the fallback local so a
 * caller can always inject `now`. Uses a fixed epoch when the global clock is absent. */
function sessionNow(): number {
	try {
		return Date.now();
	} catch {
		return 0;
	}
}
