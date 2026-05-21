import { modelCredentialEnvKey } from "@refarm.dev/config";

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
				const envProvider = stringValue(env.MODEL_PROVIDER);
				const envDefaultProvider = stringValue(env.MODEL_DEFAULT_PROVIDER);
				const routeProviderOverridden = Boolean(envProvider ?? envDefaultProvider);
				const effectiveProvider = envProvider ?? envDefaultProvider ?? provider;

				if (provider && !routeProviderOverridden) setManagedEnv("MODEL_PROVIDER", provider);
				const modelId = stringValue(tokens.modelId) ?? stringValue(tokens.model);
				if (modelId && (!routeProviderOverridden || effectiveProvider === provider)) {
					setManagedEnv("MODEL_ID", modelId);
				}

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
						const envKey = modelCredentialEnvKey(provider ?? oauthProvider);
						if (envKey) setManagedEnv(envKey, effectiveCreds.access);
						return;
					}
				}

				const apiKey = stringValue(tokens.modelApiKey);
				if (apiKey && provider) {
					const envKey = modelCredentialEnvKey(provider);
					if (envKey) setManagedEnv(envKey, apiKey);
				}
			} catch {
				// Silo unavailable - environment fallback still applies.
			}
		},
	};
}
