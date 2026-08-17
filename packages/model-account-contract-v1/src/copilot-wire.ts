/**
 * THE GITHUB COPILOT WIRE — read from behaviour, stated explicitly, and pinned by tests.
 *
 * GitHub publishes no model API billed against a Copilot subscription. Its own community forum says
 * there is no supported public endpoint and that the editor reaches internal ones (discussion
 * #185848, checked 2026-08-14). So this shape cannot be cited from a contract. The only honest way
 * to depend on it is to write it down in one place and let a test fail the day it moves, rather than
 * scatter the assumptions through a provider and discover them during an outage.
 *
 * WHAT REFARM REFUSES TO COPY. `@earendil-works/pi-ai` reaches the same wire with
 * `Iv1.b507a08c87ecfe98` — the Copilot editor-plugin family's client id, base64-obfuscated — plus
 * `User-Agent: GitHubCopilotChat/0.35.0` and `Copilot-Integration-Id: vscode-chat`. It works by
 * presenting itself as VS Code. Refarm uses its own OAuth App and says who it is, because access
 * that depends on impersonating a specific client can be fenced without warning and is not ours to
 * claim (2026-08-06 design, D6a).
 *
 * Whether GitHub honours a self-registered identity here is UNMEASURED, and one real login is the
 * only thing that can measure it. This module exists so that login is the only unknown left.
 *
 * PURE. No network, no credential, no login.
 *
 * ## Why it lives in the contract package
 *
 * It was in `apps/refarm` and the DAEMON needs it too: a Copilot token lasts minutes, and renewing
 * it is a re-exchange of the durable `ghu_` rather than an OAuth `refresh_token` grant, so the
 * renewal path could not reach the module that already knew the shape. The alternative was a second
 * implementation of an UNDOCUMENTED wire — two places to be wrong about an endpoint nobody
 * publishes, which is the exact failure the file's own opening paragraph exists to prevent.
 */

/** GitHub's device-code endpoints, which ARE documented. Only the exchange below is not. */
export const GITHUB_DEVICE_CODE_URL = "https://github.com/login/device/code";
export const GITHUB_ACCESS_TOKEN_URL = "https://github.com/login/oauth/access_token";

/** The scope a Copilot credential needs, and deliberately nothing more: it cannot read a repository. */
export const COPILOT_SCOPE = "read:user";

/** The undocumented exchange: a GitHub user token in, a short-lived Copilot token out. */
export const copilotTokenExchangeUrl = (domain = "github.com") =>
	`https://api.${domain}/copilot_internal/v2/token`;

/** Renew this far before the stated expiry, so an in-flight request does not race the clock. */
export const REFRESH_MARGIN_MS = 5 * 60 * 1000;

/**
 * A Copilot token is a semicolon-delimited list of `key=value` pairs, and it carries its own
 * routing. An EMPTY map means "this is not in that shape", which a caller must be able to tell
 * apart from "no endpoint was advertised".
 */
export function parseCopilotTokenFields(token: string): Map<string, string> {
	const fields = new Map<string, string>();
	for (const part of token.split(";")) {
		const eq = part.indexOf("=");
		if (eq <= 0) continue;
		fields.set(part.slice(0, eq).trim(), part.slice(eq + 1).trim());
	}
	return fields;
}

/**
 * THREE STATES, because this endpoint is undocumented and the day a guess is wrong is a day someone
 * has to debug it. A caller that cannot tell a token-advertised endpoint from an assumed one cannot
 * report why a request went where it went.
 */
export type CopilotApiBaseUrl =
	| { readonly kind: "from-token"; readonly baseUrl: string }
	| { readonly kind: "from-enterprise-domain"; readonly baseUrl: string }
	| { readonly kind: "assumed-individual"; readonly baseUrl: string };

export function copilotApiBaseUrl(
	token: string,
	enterpriseDomain: string | undefined,
): CopilotApiBaseUrl {
	const proxy = parseCopilotTokenFields(token).get("proxy-ep");
	if (proxy) {
		// The token routes itself: `proxy.<host>` is served by `api.<host>`. Hardcoding a host would
		// send an enterprise operator's traffic to the individual endpoint, or the reverse.
		return { kind: "from-token", baseUrl: `https://${proxy.replace(/^proxy\./u, "api.")}` };
	}
	if (enterpriseDomain) {
		return { kind: "from-enterprise-domain", baseUrl: `https://copilot-api.${enterpriseDomain}` };
	}
	return { kind: "assumed-individual", baseUrl: "https://api.individual.githubcopilot.com" };
}

/**
 * WHICH ACCOUNT THIS TOKEN BELONGS TO, from the token itself.
 *
 * Measured on the operator's node 2026-08-15: a Copilot token carries `tid=` — 32 characters that
 * differ per account — alongside `sku`, `exp`, `proxy-ep` and the feature flags. Without reading it,
 * every Copilot credential looked like the same account, and his second login replaced his first.
 *
 * `null` means the token did not carry one, which is NOT "the same account as before". The contract
 * refuses to store a second indistinguishable credential rather than guess.
 */
export function copilotAccountId(token: string): string | null {
	return parseCopilotTokenFields(token).get("tid") ?? null;
}

/**
 * The headers the exchange is called with, in ONE place.
 *
 * Two callers perform this exchange — the CLI, which provisions the runtime at start, and the
 * daemon, which renews mid-run — and they must present the SAME client. Diverging here would mean
 * a credential that renews from one process and is refused from the other, against an endpoint
 * nobody documents, which is the failure mode this whole module exists to make impossible.
 */
export const COPILOT_EXCHANGE_HEADERS: Readonly<Record<string, string>> = {
	accept: "application/json",
	"user-agent": "GitHubCopilotChat/0.26.0",
	"editor-version": "vscode/1.99.0",
	"editor-plugin-version": "copilot-chat/0.26.0",
};

/**
 * PURE. A renewed Copilot credential from the exchange body, or `null` when the body is a shape
 * this build does not recognise.
 *
 * THE DURABLE TOKEN IS CARRIED THROUGH UNCHANGED. `refresh` holds the `ghu_` that mints these;
 * storing the freshly minted short-lived token there would make the NEXT renewal fail, which is a
 * failure that only appears once the first renewal has already succeeded.
 *
 * THE ENDPOINT MOVES WITH THE TOKEN, because each exchange announces where that seat talks. A
 * renewal that kept the previous `baseUrl` would be a live token pointed at a stale host.
 */
export function renewedCopilotCredential(
	body: unknown,
	durableToken: string,
	enterpriseDomain?: string,
): {
	access: string;
	refresh: string;
	expires: number;
	accountId?: string;
	baseUrl: string;
	baseUrlSource: CopilotApiBaseUrl["kind"];
} | null {
	if (!body || typeof body !== "object" || Array.isArray(body)) return null;
	const { token, expires_at: expiresAt } = body as { token?: unknown; expires_at?: unknown };
	if (typeof token !== "string" || typeof expiresAt !== "number") return null;
	const endpoint = copilotApiBaseUrl(token, enterpriseDomain);
	const accountId = copilotAccountId(token);
	return {
		access: token,
		refresh: durableToken,
		expires: copilotRefreshMargin(expiresAt),
		...(accountId ? { accountId } : {}),
		baseUrl: endpoint.baseUrl,
		baseUrlSource: endpoint.kind,
	};
}

/** The moment to renew at, from the exchange's `expires_at` (seconds). */
export function copilotRefreshMargin(expiresAtSeconds: number): number {
	return expiresAtSeconds * 1000 - REFRESH_MARGIN_MS;
}
