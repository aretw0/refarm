/**
 * GITHUB COPILOT AS A MODEL PROVIDER — refarm's own adapter, under refarm's own identity.
 *
 * DEVICE FLOW, NOT A BROWSER CALLBACK. The operator reads a code and types it somewhere else, so
 * this login works on a headless node and from a phone. That is a real advantage over the codex
 * flow, which needs a browser on the machine that is authenticating.
 *
 * THE ONE UNKNOWN, ON PURPOSE. `copilot_internal/v2/token` is undocumented (see
 * `github-copilot-wire.ts` for the evidence), and whether GitHub honours a self-registered client
 * id there cannot be established from any document. This adapter is built so that the operator's
 * first login is the ONLY thing that can fail for a reason we have not already tested — and so that
 * when it does fail, it says which of the three steps refused.
 *
 * IT DOES NOT IMPERSONATE. pi reaches this wire as `vscode-chat` with the editor plugin's client
 * id; refarm sends its own identity and its own user agent. If GitHub declines that, the honest
 * outcome is a measured refusal and a decision for the operator, not a costume.
 */
import { resolveRefarmVersion } from "../../commands/runtime-metadata.js";
import {
	copilotRequestIdentity,
	type CopilotIdentity,
} from "./copilot-identity.js";
import {
	COPILOT_SCOPE,
	copilotApiBaseUrl,
	copilotRefreshMargin,
	copilotTokenExchangeUrl,
	GITHUB_ACCESS_TOKEN_URL,
	GITHUB_DEVICE_CODE_URL,
} from "./github-copilot-wire.js";
import type { OAuthCredentials, OAuthLoginCallbacks, OAuthProviderInterface } from "./types.js";

const GRANT_TYPE = "urn:ietf:params:oauth:grant-type:device_code";

export interface GitHubCopilotProviderOptions {
	/** Refarm's own OAuth App id. Used unless the profile says to present another. */
	readonly clientId: string;
	readonly fetch: typeof fetch;
	/**
	 * WHO REFARM SAYS IT IS at the exchange. Defaults to its own identity, which is the honest one
	 * and the one measured at HTTP 403 — imitation must never be reached by omission.
	 */
	readonly identity?: CopilotIdentity;
	/** A GitHub Enterprise host, when the operator has one. Absent means github.com. */
	readonly enterpriseDomain?: string;
	readonly sleep?: (ms: number) => Promise<void>;
}

interface DeviceCode {
	device_code: string;
	user_code: string;
	verification_uri: string;
	interval: number;
	expires_in: number;
}

export function createGitHubCopilotProvider(
	options: GitHubCopilotProviderOptions,
): OAuthProviderInterface {
	const doFetch = options.fetch;
	const sleep = options.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
	const domain = options.enterpriseDomain ?? "github.com";
	// ONE PLACE decides the client id and the headers, for all three profiles. Nothing below this
	// line knows which identity is in use, which is what keeps a granted integration id an edit
	// rather than a migration.
	const presented = copilotRequestIdentity(
		options.identity ?? { kind: "refarm" },
		options.clientId,
		resolveRefarmVersion(),
	);

	/** The undocumented step, isolated so a failure names itself. */
	async function exchangeForCopilotToken(githubToken: string): Promise<OAuthCredentials> {
		const response = await doFetch(copilotTokenExchangeUrl(domain), {
			headers: { ...presented.headers, Authorization: `Bearer ${githubToken}` },
		});
		if (!response.ok) {
			throw new Error(
				`GitHub did not accept this identity at copilot_internal/v2/token (HTTP ${response.status}). ` +
					"The endpoint is undocumented and may only honour known integration ids; refarm does not " +
					"impersonate one. See docs/GITHUB_IDENTITY_SETUP.md.",
			);
		}
		const body = (await response.json()) as { token?: unknown; expires_at?: unknown };
		if (typeof body.token !== "string" || typeof body.expires_at !== "number") {
			throw new Error("the Copilot token exchange returned a shape refarm does not recognise");
		}
		const endpoint = copilotApiBaseUrl(body.token, options.enterpriseDomain);
		return {
			access: body.token,
			// THE DURABLE TOKEN IS THE REFRESH MATERIAL. The Copilot token is short-lived; storing it
			// as `refresh` would make every renewal fail once the first one expired.
			refresh: githubToken,
			expires: copilotRefreshMargin(body.expires_at),
			baseUrl: endpoint.baseUrl,
			// Recorded because the endpoint is undocumented: when a request goes somewhere surprising,
			// this says whether the token routed it or refarm assumed it.
			baseUrlSource: endpoint.kind,
		};
	}

	return {
		id: "github-copilot",
		name: "GitHub Copilot",
		usesCallbackServer: false,

		async login(callbacks: OAuthLoginCallbacks): Promise<OAuthCredentials> {
			const deviceResponse = await doFetch(GITHUB_DEVICE_CODE_URL, {
				method: "POST",
				headers: presented.headers,
				body: JSON.stringify({ client_id: presented.clientId, scope: COPILOT_SCOPE }),
			});
			const device = (await deviceResponse.json()) as Partial<DeviceCode>;
			if (!device.device_code || !device.user_code || !device.verification_uri) {
				throw new Error("GitHub returned a device-code response refarm does not recognise");
			}
			callbacks.onAuth({
				url: device.verification_uri,
				instructions: `Enter the code ${device.user_code} — this page can be opened on any device.`,
			});

			const intervalMs = Math.max(0, (device.interval ?? 5) * 1000);
			const deadline = Date.now() + (device.expires_in ?? 900) * 1000;
			let githubToken: string | undefined;
			while (!githubToken) {
				if (Date.now() > deadline) throw new Error("the device code expired before it was entered");
				await sleep(intervalMs);
				const tokenResponse = await doFetch(GITHUB_ACCESS_TOKEN_URL, {
					method: "POST",
					headers: presented.headers,
					body: JSON.stringify({
						client_id: presented.clientId,
						device_code: device.device_code,
						grant_type: GRANT_TYPE,
					}),
				});
				const body = (await tokenResponse.json()) as { access_token?: string; error?: string };
				if (typeof body.access_token === "string") githubToken = body.access_token;
				else if (body.error && body.error !== "authorization_pending" && body.error !== "slow_down") {
					throw new Error(`GitHub refused the device authorization: ${body.error}`);
				}
			}

			callbacks.onProgress?.("Exchanging the GitHub token for a Copilot token…");
			return exchangeForCopilotToken(githubToken);
		},

		async refreshToken(credentials: OAuthCredentials): Promise<OAuthCredentials> {
			// The durable GitHub token is exchanged again. No re-authentication, and no second copy of
			// anything: the same material produces a new short-lived token.
			return exchangeForCopilotToken(credentials.refresh);
		},

		getApiKey(credentials: OAuthCredentials): string {
			return credentials.access;
		},
	};
}
