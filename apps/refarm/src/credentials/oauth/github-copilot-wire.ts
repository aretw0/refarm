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

/** The moment to renew at, from the exchange's `expires_at` (seconds). */
export function copilotRefreshMargin(expiresAtSeconds: number): number {
	return expiresAtSeconds * 1000 - REFRESH_MARGIN_MS;
}
