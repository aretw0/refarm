import { generatePKCE } from "./pkce.js";
import { startCallbackServer } from "./callback-server.js";
import type { OAuthCredentials, OAuthLoginCallbacks, OAuthProviderInterface } from "./types.js";

const CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const AUTHORIZE_URL = "https://auth.openai.com/oauth/authorize";
const TOKEN_URL = "https://auth.openai.com/oauth/token";
const CALLBACK_PORT = 1455;
const CALLBACK_PATH = "/auth/callback";
const REDIRECT_URI = `http://localhost:${CALLBACK_PORT}${CALLBACK_PATH}`;
const SCOPE = "openid profile email offline_access";
const JWT_CLAIM = "https://api.openai.com/auth";

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

function extractAccountId(token: string): string | null {
	try {
		const payload = JSON.parse(atob(token.split(".")[1] ?? "")) as Record<string, unknown>;
		const auth = payload[JWT_CLAIM] as { chatgpt_account_id?: string } | undefined;
		const id = auth?.chatgpt_account_id;
		return typeof id === "string" && id.length > 0 ? id : null;
	} catch { return null; }
}

async function exchangeCode(code: string, verifier: string): Promise<OAuthCredentials> {
	const res = await fetch(TOKEN_URL, {
		method: "POST",
		headers: { "content-type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({ grant_type: "authorization_code", client_id: CLIENT_ID, code, code_verifier: verifier, redirect_uri: REDIRECT_URI }),
	});
	if (!res.ok) throw new Error(`OpenAI token exchange failed (${res.status}): ${await res.text()}`);
	const d = (await res.json()) as { access_token: string; refresh_token: string; expires_in: number };
	return { access: d.access_token, refresh: d.refresh_token, expires: Date.now() + d.expires_in * 1000 };
}

async function refreshCodexToken(refreshToken: string): Promise<OAuthCredentials> {
	const res = await fetch(TOKEN_URL, {
		method: "POST",
		headers: { "content-type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({ grant_type: "refresh_token", client_id: CLIENT_ID, refresh_token: refreshToken }),
	});
	if (!res.ok) throw new Error(`OpenAI token refresh failed (${res.status}): ${await res.text()}`);
	const d = (await res.json()) as { access_token: string; refresh_token: string; expires_in: number };
	const accountId = extractAccountId(d.access_token);
	return { access: d.access_token, refresh: d.refresh_token, expires: Date.now() + d.expires_in * 1000, ...(accountId ? { accountId } : {}) };
}

export async function loginOpenAICodex(callbacks: OAuthLoginCallbacks): Promise<OAuthCredentials> {
	const { verifier, challenge } = await generatePKCE();
	const state = Array.from(crypto.getRandomValues(new Uint8Array(16))).map((b) => b.toString(16).padStart(2, "0")).join("");

	const server = callbacks.skipCallbackServer
		? { waitForCode: () => Promise.resolve(null), cancelWait: () => {}, close: () => {} }
		: await startCallbackServer({ port: CALLBACK_PORT, path: CALLBACK_PATH, expectedState: state });

	const url = new URL(AUTHORIZE_URL);
	url.searchParams.set("response_type", "code");
	url.searchParams.set("client_id", CLIENT_ID);
	url.searchParams.set("redirect_uri", REDIRECT_URI);
	url.searchParams.set("scope", SCOPE);
	url.searchParams.set("code_challenge", challenge);
	url.searchParams.set("code_challenge_method", "S256");
	url.searchParams.set("state", state);
	url.searchParams.set("codex_cli_simplified_flow", "true");
	url.searchParams.set("originator", "refarm");

	callbacks.onAuth({ url: url.toString(), instructions: "A browser window should open. Complete login to continue." });

	let code: string | undefined;

	try {
		if (callbacks.onManualCodeInput) {
			let manualInput: string | undefined;
			const manualPromise = callbacks.onManualCodeInput().then((v) => {
				manualInput = v;
				server.cancelWait();
			}).catch(() => server.cancelWait());

			const result = await server.waitForCode();
			if (result?.code) {
				code = result.code;
			} else if (manualInput) {
				code = parseCodeFromInput(manualInput).code;
			}
			if (!code) { await manualPromise; if (manualInput) code = parseCodeFromInput(manualInput).code; }
		} else {
			const result = await server.waitForCode();
			if (result?.code) code = result.code;
		}

		if (!code) {
			const input = await callbacks.onPrompt({ message: "Paste the authorization code or full redirect URL:" });
			code = parseCodeFromInput(input).code;
		}

		if (!code) throw new Error("Missing authorization code");
		callbacks.onProgress?.("Exchanging code for tokens…");

		const creds = await exchangeCode(code, verifier);
		const accountId = extractAccountId(creds.access);
		return { ...creds, ...(accountId ? { accountId } : {}) };
	} finally {
		server.close();
	}
}

export const openaiCodexOAuthProvider: OAuthProviderInterface = {
	id: "openai-codex",
	name: "ChatGPT Plus/Pro (OpenAI Codex)",
	usesCallbackServer: true,
	login: (callbacks) => loginOpenAICodex(callbacks),
	refreshToken: (creds) => refreshCodexToken(creds.refresh),
	getApiKey: (creds) => creds.access,
};
