import { loadConfig } from "@refarm.dev/config";
import chalk from "chalk";
import { startSpinner } from "../utils/spinner.js";
import type { CollectContext, CredentialProvider } from "./types.js";

// Default client_id for the refarm GitHub OAuth App.
// Override in .refarm/config.json: { "providers": { "github": { "clientId": "..." } } }
// or via env:                      REFARM_PROVIDER_GITHUB_CLIENT_ID=...
// Device flow does not use a client_secret — this value is safe to commit.
const DEFAULT_CLIENT_ID = "Ov23lier7kyBcgIUQsih";
const DEFAULT_SCOPES = "repo read:org";
const DEVICE_CODE_URL = "https://github.com/login/device/code";
const TOKEN_URL = "https://github.com/login/oauth/access_token";
const GRANT_TYPE = "urn:ietf:params:oauth:grant-type:device_code";

interface DeviceCodeResponse {
	device_code: string;
	user_code: string;
	verification_uri: string;
	expires_in: number;
	interval: number;
	error?: string;
}

interface TokenResponse {
	access_token?: string;
	error?: string;
}

async function requestDeviceCode(
	clientId: string,
	scopes: string,
): Promise<DeviceCodeResponse> {
	const res = await fetch(DEVICE_CODE_URL, {
		method: "POST",
		headers: { Accept: "application/json", "Content-Type": "application/json" },
		body: JSON.stringify({ client_id: clientId, scope: scopes }),
	});
	return res.json() as Promise<DeviceCodeResponse>;
}

async function pollForToken(
	clientId: string,
	deviceCode: string,
	intervalSec: number,
): Promise<string> {
	let delay = intervalSec;
	while (true) {
		await new Promise((r) => setTimeout(r, delay * 1000));
		const res = await fetch(TOKEN_URL, {
			method: "POST",
			headers: { Accept: "application/json", "Content-Type": "application/json" },
			body: JSON.stringify({
				client_id: clientId,
				device_code: deviceCode,
				grant_type: GRANT_TYPE,
			}),
		});
		const data = (await res.json()) as TokenResponse;
		if (data.access_token) return data.access_token;
		if (data.error === "slow_down") delay += 5;
		if (data.error === "expired_token")
			throw new Error("Authorization expired. Run 'refarm sow' again.");
		if (data.error === "access_denied")
			throw new Error("Authorization declined.");
		// authorization_pending → keep polling
	}
}

async function resolveUsername(token: string): Promise<string> {
	const res = await fetch("https://api.github.com/user", {
		headers: { Authorization: `Bearer ${token}`, "User-Agent": "refarm-cli" },
	});
	if (!res.ok) return "unknown";
	const data = (await res.json()) as { login?: string };
	return data.login ?? "unknown";
}

export const githubCredentialProvider: CredentialProvider = {
	id: "github",
	label: "GitHub",

	async collect(ctx: CollectContext): Promise<string> {
		const cfg = loadConfig() as { providers?: { github?: { clientId?: string; scopes?: string } } };
		const clientId = cfg.providers?.github?.clientId ?? DEFAULT_CLIENT_ID;
		const scopes = cfg.providers?.github?.scopes ?? DEFAULT_SCOPES;

		console.log(chalk.bold("\n  GitHub"));
		console.log(chalk.gray("  Authorize refarm to access your repositories.\n"));

		const device = await requestDeviceCode(clientId, scopes);
		if (device.error) throw new Error(`GitHub: ${device.error}`);

		console.log(
			`  ${chalk.bold("Code:")} ${chalk.cyan.bold(device.user_code)}`,
		);
		console.log(chalk.gray(`  → ${device.verification_uri}\n`));
		ctx.tryOpenUrl(device.verification_uri);

		const stop = startSpinner("Waiting for authorization…");
		try {
			const token = await pollForToken(clientId, device.device_code, device.interval);
			stop();
			const login = await resolveUsername(token);
			console.log(chalk.green(`  ✓ GitHub — authorized as ${login}`));
			return token;
		} catch (err) {
			stop();
			throw err;
		}
	},
};
