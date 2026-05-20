export interface OAuthCreds {
	access: string;
	refresh: string;
	expires: number;
}

export interface SiloModelTokens {
	modelProvider?: unknown;
	modelId?: unknown;
	model?: unknown;
	oauthProvider?: unknown;
	oauthCredentials?: unknown;
	modelApiKey?: unknown;
}

export interface SiloModelTokenStore {
	loadTokens(): Promise<SiloModelTokens>;
	saveTokens(tokens: Record<string, unknown>): Promise<unknown>;
}

export interface SiloModelEnvInjectorOptions {
	store: SiloModelTokenStore;
	env?: NodeJS.ProcessEnv;
	warn?: (message: string) => void;
	refreshOAuthToken?: (
		oauthProvider: string,
		creds: OAuthCreds,
	) => Promise<OAuthCreds | null>;
}

export const MODEL_ENV_KEY: Record<string, string> = {
	openai: "OPENAI_API_KEY",
	"openai-codex": "OPENAI_API_KEY",
	anthropic: "ANTHROPIC_API_KEY",
	groq: "GROQ_API_KEY",
	mistral: "MISTRAL_API_KEY",
	xai: "XAI_API_KEY",
	deepseek: "DEEPSEEK_API_KEY",
	together: "TOGETHER_API_KEY",
	openrouter: "OPENROUTER_API_KEY",
	gemini: "GEMINI_API_KEY",
};

function stringValue(value: unknown): string | undefined {
	return typeof value === "string" && value.trim().length > 0
		? value.trim()
		: undefined;
}

function oauthCredentialsFor(
	tokens: SiloModelTokens,
	provider: string,
): OAuthCreds | undefined {
	const allOAuth =
		tokens.oauthCredentials && typeof tokens.oauthCredentials === "object"
			? (tokens.oauthCredentials as Record<string, unknown>)
			: {};
	const value = allOAuth[provider];
	if (!value || typeof value !== "object") return undefined;
	const candidate = value as Partial<OAuthCreds>;
	return typeof candidate.access === "string" &&
		typeof candidate.refresh === "string" &&
		typeof candidate.expires === "number"
		? {
				access: candidate.access,
				refresh: candidate.refresh,
				expires: candidate.expires,
			}
		: undefined;
}

export function createSiloModelEnvInjector(
	options: SiloModelEnvInjectorOptions,
): { inject(): Promise<void> } {
	const env = options.env ?? process.env;
	const warn = options.warn ?? ((message) => console.warn(message));
	const managedEnvKeys = new Set<string>();

	function setManagedEnv(key: string, value: string): void {
		if (env[key] && !managedEnvKeys.has(key)) return;
		env[key] = value;
		managedEnvKeys.add(key);
	}

	return {
		async inject() {
			try {
				const tokens = await options.store.loadTokens();
				const provider = stringValue(tokens.modelProvider);
				const oauthProvider = stringValue(tokens.oauthProvider);

				if (provider) setManagedEnv("MODEL_PROVIDER", provider);
				const modelId = stringValue(tokens.modelId) ?? stringValue(tokens.model);
				if (modelId) setManagedEnv("MODEL_ID", modelId);

				if (oauthProvider) {
					const creds = oauthCredentialsFor(tokens, oauthProvider);
					if (creds) {
						let effectiveCreds = creds;
						if (Date.now() >= creds.expires && options.refreshOAuthToken) {
							const refreshed = await options.refreshOAuthToken(oauthProvider, creds);
							if (refreshed) {
								effectiveCreds = refreshed;
								const allOAuth =
									tokens.oauthCredentials && typeof tokens.oauthCredentials === "object"
										? (tokens.oauthCredentials as Record<string, unknown>)
										: {};
								await options.store.saveTokens({
									oauthCredentials: {
										...allOAuth,
										[oauthProvider]: refreshed,
									},
								});
							} else {
								warn(
									`[farmhand] OAuth token refresh failed for ${oauthProvider} - agent may fail`,
								);
								return;
							}
						}
						const envKey = MODEL_ENV_KEY[provider ?? oauthProvider];
						if (envKey) setManagedEnv(envKey, effectiveCreds.access);
						return;
					}
				}

				const apiKey = stringValue(tokens.modelApiKey);
				if (apiKey && provider) {
					const envKey = MODEL_ENV_KEY[provider];
					if (envKey) setManagedEnv(envKey, apiKey);
				}
			} catch {
				// Silo unavailable - farmhand-start.sh .env fallback still applies.
			}
		},
	};
}
