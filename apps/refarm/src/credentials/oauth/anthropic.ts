import { generatePKCE } from "./pkce.js";
import { startCallbackServer } from "./callback-server.js";
import type { OAuthCredentials, OAuthLoginCallbacks, OAuthProviderInterface } from "./types.js";

// Authorization Code + PKCE for Claude Pro/Max subscribers.
// Client ID is the Pi-validated OAuth App registered with Anthropic.
const CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";
const AUTHORIZE_URL = "https://claude.ai/oauth/authorize";
const TOKEN_URL = "https://platform.claude.com/v1/oauth/token";
const CALLBACK_PORT = 53692;
const CALLBACK_PATH = "/callback";
const REDIRECT_URI = `http://localhost:${CALLBACK_PORT}${CALLBACK_PATH}`;
const SCOPES = "org:create_api_key user:profile user:inference user:sessions:claude_code";

async function waitForCallback(
	server: { waitForCode(): Promise<{ code: string; state: string } | null>; cancelWait(): void },
	timeoutMs?: number,
): Promise<{ code: string; state: string } | null> {
	if (!timeoutMs || timeoutMs <= 0) return server.waitForCode();

	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		return await Promise.race([
			server.waitForCode(),
			new Promise<null>((resolve) => {
				timer = setTimeout(() => {
					server.cancelWait();
					resolve(null);
				}, timeoutMs);
			}),
		]);
	} finally {
		if (timer) clearTimeout(timer);
	}
}

function parseCodeFromInput(input: string): { code?: string; state?: string } {
	const v = input.trim();
	if (!v) return {};
	try {
		const url = new URL(v);
		return { code: url.searchParams.get("code") ?? undefined, state: url.searchParams.get("state") ?? undefined };
	} catch { /* not a URL */ }
	if (v.includes("code=")) {
		const p = new URLSearchParams(v);
		return { code: p.get("code") ?? undefined, state: p.get("state") ?? undefined };
	}
	return { code: v };
}

async function postJson(url: string, body: Record<string, string>): Promise<string> {
	const res = await fetch(url, {
		method: "POST",
		headers: { "content-type": "application/json", accept: "application/json" },
		body: JSON.stringify(body),
		signal: AbortSignal.timeout(30_000),
	});
	const text = await res.text();
	if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}: ${text}`);
	return text;
}

async function exchangeCode(
	code: string,
	verifier: string,
	redirectUri: string,
): Promise<OAuthCredentials> {
	const body = await postJson(TOKEN_URL, {
		grant_type: "authorization_code",
		client_id: CLIENT_ID,
		code,
		redirect_uri: redirectUri,
		code_verifier: verifier,
	});
	const d = JSON.parse(body) as { access_token: string; refresh_token: string; expires_in: number };
	return { access: d.access_token, refresh: d.refresh_token, expires: Date.now() + d.expires_in * 1000 - 300_000 };
}

export async function loginAnthropic(callbacks: OAuthLoginCallbacks): Promise<OAuthCredentials> {
	const { verifier, challenge } = await generatePKCE();
	const server = callbacks.skipCallbackServer
		? { waitForCode: () => Promise.resolve(null), cancelWait: () => {}, close: () => {} }
		: await startCallbackServer({ port: CALLBACK_PORT, path: CALLBACK_PATH, expectedState: verifier });

	const authParams = new URLSearchParams({
		code: "true",
		client_id: CLIENT_ID,
		response_type: "code",
		redirect_uri: REDIRECT_URI,
		scope: SCOPES,
		code_challenge: challenge,
		code_challenge_method: "S256",
		state: verifier,
	});

	callbacks.onAuth({
		url: `${AUTHORIZE_URL}?${authParams}`,
		instructions: "Complete login in your browser. On a remote machine, paste the redirect URL here.",
	});

	let code: string | undefined;
	let redirectUriForExchange = REDIRECT_URI;

	try {
		if (callbacks.onManualCodeInput) {
			let manualInput: string | undefined;
			const manualPromise = callbacks.onManualCodeInput().then((v) => {
				manualInput = v;
				server.cancelWait();
			}).catch((err: unknown) => { server.cancelWait(); throw err; });

			const result = await waitForCallback(server, callbacks.callbackTimeoutMs);
			if (result?.code) {
				code = result.code;
			} else if (manualInput) {
				const parsed = parseCodeFromInput(manualInput);
				if (parsed.state && parsed.state !== verifier) throw new Error("OAuth state mismatch");
				code = parsed.code;
			}
			if (!code) {
				await manualPromise;
				if (manualInput) {
					const parsed = parseCodeFromInput(manualInput);
					code = parsed.code;
				}
			}
		} else {
			const result = await waitForCallback(server, callbacks.callbackTimeoutMs);
			if (result?.code) code = result.code;
		}

		if (!code) {
			const input = await callbacks.onPrompt({ message: "Paste the authorization code or full redirect URL:", placeholder: REDIRECT_URI });
			const parsed = parseCodeFromInput(input);
			if (parsed.state && parsed.state !== verifier) throw new Error("OAuth state mismatch");
			code = parsed.code;
			redirectUriForExchange = REDIRECT_URI;
		}

		if (!code) throw new Error("Missing authorization code");

		callbacks.onProgress?.("Exchanging code for tokens…");
		return exchangeCode(code, verifier, redirectUriForExchange);
	} finally {
		server.close();
	}
}

async function refreshAnthropicToken(refreshToken: string): Promise<OAuthCredentials> {
	const body = await postJson(TOKEN_URL, {
		grant_type: "refresh_token",
		client_id: CLIENT_ID,
		refresh_token: refreshToken,
	});
	const d = JSON.parse(body) as { access_token: string; refresh_token: string; expires_in: number };
	return { access: d.access_token, refresh: d.refresh_token, expires: Date.now() + d.expires_in * 1000 - 300_000 };
}

export const anthropicOAuthProvider: OAuthProviderInterface = {
	id: "anthropic",
	name: "Anthropic Claude (Pro/Max)",
	usesCallbackServer: true,
	login: (callbacks) => loginAnthropic(callbacks),
	refreshToken: (creds) => refreshAnthropicToken(creds.refresh),
	getApiKey: (creds) => creds.access,
};
