/**
 * ASKING GITHUB WHAT A COPILOT ACCOUNT HAS LEFT.
 *
 * ISS-064 step 1, second pass. The first (ISS-129) asked `copilot_internal/v2/token`, found
 * `limited_user_quotas: null` and concluded github-copilot CANNOT SAY. That reading was correct
 * about the endpoint and wrong about the provider: `copilot_internal/user` answers with
 * `quota_snapshots`, measured 2026-08-17 against both of the operator's real accounts.
 *
 * THE TOKEN IS THE `ghu_`, and this is the single most expensive detail here. A stored Copilot
 * credential holds a SHORT-LIVED copilot token in `access` (a `tid=`-prefixed string) and the
 * GitHub user token in `refresh`. ISS-129 recorded presenting the former and reading the 401 as
 * the provider refusing us — twice. Presenting the wrong credential and reporting the provider's
 * answer is how a node comes to believe a healthy account is dead.
 *
 * FIVE OUTCOMES, because an operator repairs each differently and a boolean would erase four of
 * them. "The provider was unavailable" is not "the credential is rejected" is not "this account
 * has no quota left".
 */
import { readAccountQuota } from "@refarm.dev/github-copilot-wire";
import type { AccountQuota } from "@refarm.dev/model-account-contract-v1";

export const COPILOT_QUOTA_URL = "https://api.github.com/copilot_internal/user";

/** Declared, not accidental: the same editor imitation `credential list` already announces via
 *  `providers.githubCopilot.identity`. This endpoint answers without them too — measured — so they
 *  are sent for consistency with the rest of this node's Copilot traffic, not to gain access. */
const EDITOR_HEADERS: Readonly<Record<string, string>> = {
	"editor-version": "vscode/1.99.0",
	"editor-plugin-version": "copilot-chat/0.26.0",
	"user-agent": "GitHubCopilotChat/0.26.0",
	accept: "application/json",
};

export type QuotaOutcome =
	| { readonly kind: "read"; readonly quota: AccountQuota }
	/** This node holds no token that can ask — not a provider answer at all. */
	| { readonly kind: "cannot-ask"; readonly reason: string }
	/** The provider rejected the credential. A repair, not a quota fact. */
	| { readonly kind: "rejected"; readonly status: number }
	/** The provider was reachable and would not answer now. Says nothing about quota. */
	| { readonly kind: "unavailable"; readonly status: number }
	/** The request never completed. Offline, blocked, timed out. */
	| { readonly kind: "unreachable"; readonly reason: string };

/**
 * PURE. The GitHub USER token inside a stored Copilot credential, or nothing.
 *
 * Keyed on the `ghu_` PREFIX rather than on the field name, because the field that carries it is
 * the one this node happens to store it under and the prefix is what GitHub actually issues. A
 * reader keyed on `refresh` alone would break the day the shape moves and would break silently.
 */
export function githubUserTokenOf(credential: unknown): string | undefined {
	if (!credential || typeof credential !== "object" || Array.isArray(credential)) return undefined;
	for (const value of Object.values(credential as Record<string, unknown>)) {
		if (typeof value === "string" && value.startsWith("ghu_")) return value;
	}
	return undefined;
}

/** PURE. What an HTTP status means for a quota question, which is not what it means generally. */
export function outcomeForStatus(status: number): Extract<QuotaOutcome, { kind: "rejected" | "unavailable" }> {
	// 401/403 is the CREDENTIAL, and conflating it with quota is the whole trap: an expired token
	// nobody renewed reads exactly like an exhausted account, and the operator's two Copilot
	// credentials were both expired with a usable refresh beside them when ISS-129 measured.
	if (status === 401 || status === 403) return { kind: "rejected", status };
	return { kind: "unavailable", status };
}

export interface CopilotQuotaDeps {
	/** Injected so tests never reach the network and so a probe can be replayed. */
	readonly fetch: typeof globalThis.fetch;
	/** Injected so a retry costs a test nothing. Default is a real wait. */
	readonly sleep?: (ms: number) => Promise<void>;
	/** Total attempts, including the first. Default 4. */
	readonly attempts?: number;
}

const DEFAULT_ATTEMPTS = 4;
const RETRY_DELAY_MS = 600;

/** PURE. Exponential, because the failure measured here is transport-level and bursty rather than
 *  a rate limit: probing at 0ms, 1s, 3s and 6s gaps produced 503s with no relation to the gap, and
 *  the 503 arrives WITHOUT GitHub's own `server` header while every 200 carries it — an
 *  intermediary on the operator's corporate network, not the provider. Fixed delays just sample
 *  the same bad moment repeatedly. */
export const retryDelayMs = (attempt: number): number => RETRY_DELAY_MS * 2 ** (attempt - 1);

/** PURE. Whether an outcome is worth asking again for.
 *
 * ONLY `unavailable`, and only because 5xx is the provider explicitly saying "not now" — measured
 * repeatedly against this endpoint, which answers 502/503 intermittently and 200 moments later. A
 * rejected credential is not retried: it would be the same rejection three times, and retrying an
 * auth failure is how a node turns one clear answer into a slow ambiguous one. */
export function isRetryable(outcome: QuotaOutcome): boolean {
	return outcome.kind === "unavailable";
}

async function askOnce(token: string, deps: CopilotQuotaDeps): Promise<QuotaOutcome> {
	let response: Response;
	try {
		response = await deps.fetch(COPILOT_QUOTA_URL, {
			headers: { authorization: `token ${token}`, ...EDITOR_HEADERS },
		});
	} catch (error) {
		return { kind: "unreachable", reason: error instanceof Error ? error.message : String(error) };
	}
	if (!response.ok) return outcomeForStatus(response.status);
	try {
		return { kind: "read", quota: readAccountQuota(await response.json()) };
	} catch {
		// A 200 whose body this build cannot parse is the provider answering in a shape we do not
		// know — reported as unavailable rather than as an empty quota, which would read as measured.
		return { kind: "unavailable", status: response.status };
	}
}

export async function readCopilotQuota(
	credential: unknown,
	deps: CopilotQuotaDeps,
): Promise<QuotaOutcome> {
	const token = githubUserTokenOf(credential);
	if (!token) {
		return {
			kind: "cannot-ask",
			reason:
				"this stored credential carries no GitHub user token (ghu_), so nothing here can ask " +
				"GitHub as this account. Re-authenticate with `refarm sow`.",
		};
	}
	const attempts = Math.max(1, deps.attempts ?? DEFAULT_ATTEMPTS);
	const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
	let outcome = await askOnce(token, deps);
	for (let attempt = 2; attempt <= attempts && isRetryable(outcome); attempt += 1) {
		await sleep(retryDelayMs(attempt - 1));
		outcome = await askOnce(token, deps);
	}
	return outcome;
}
