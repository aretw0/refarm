import {
	MODEL_BASE_URL_ENV_VAR,
	MODEL_DEFAULT_PROVIDER_ENV_VAR,
	MODEL_FALLBACK_MODEL_ID_ENV_VAR,
	MODEL_FALLBACK_PROVIDER_ENV_VAR,
	MODEL_ID_ENV_VAR,
	MODEL_PROVIDER_ENV_VAR,
	modelCredentialEnvKey,
} from "@refarm.dev/config";
import {
	credentialSecretLocation,
	readCredentialAt,
	readLegacyCredentials,
} from "@refarm.dev/model-account-contract-v1";

export interface OAuthCreds {
	access: string;
	refresh: string;
	expires: number;
	accountId?: string;
}

export interface SiloModelTokens {
	modelProvider?: unknown;
	modelId?: unknown;
	model?: unknown;
	modelBaseUrl?: unknown;
	modelFallbackProvider?: unknown;
	modelFallbackModelId?: unknown;
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
	refreshOAuthToken?: (oauthProvider: string, creds: OAuthCreds) => Promise<OAuthCreds | null>;
}

function stringValue(value: unknown): string | undefined {
	return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

/**
 * WHERE THIS CREDENTIAL LIVES, asked once and reused by the refresh write below.
 *
 * The refresh path is the reason this matters more here than in any other reader. It reads a
 * credential, renews it upstream, and writes the result back — and if the write rebuilt its
 * destination from the provider name instead of reusing what the read resolved, a refreshed
 * credential would land on the flat provider key no matter where it came from. That is the
 * one-slot collision returning through a code path nobody is watching, at a moment nobody chose.
 */
function credentialLocationFor(tokens: SiloModelTokens, provider: string) {
	const descriptor = readLegacyCredentials(tokens as Record<string, unknown>).find(
		(account) => account.provider === provider,
	);
	return descriptor ? credentialSecretLocation(descriptor) : null;
}

function oauthCredentialsFor(tokens: SiloModelTokens, provider: string): OAuthCreds | undefined {
	const location = credentialLocationFor(tokens, provider);
	if (!location) return undefined;
	const read = readCredentialAt(location, {
		legacyOauthCredentials: tokens.oauthCredentials as Record<string, unknown> | undefined,
	});
	if (read.kind !== "found") return undefined;
	const candidate = read.credential as Partial<OAuthCreds>;
	return typeof candidate.access === "string" &&
		typeof candidate.refresh === "string" &&
		typeof candidate.expires === "number"
		? {
				access: candidate.access,
				refresh: candidate.refresh,
				expires: candidate.expires,
				...(typeof candidate.accountId === "string" && candidate.accountId.trim().length > 0
					? { accountId: candidate.accountId.trim() }
					: {}),
			}
		: undefined;
}

export function createSiloModelEnvInjector(options: SiloModelEnvInjectorOptions): {
	inject(): Promise<void>;
	managedEnvKeys(): string[];
} {
	const env = options.env ?? process.env;
	const warn = options.warn ?? ((message) => console.warn(message));
	const managedEnvKeys = new Set<string>();

	function setManagedEnv(key: string, value: string): void {
		if (env[key] && !managedEnvKeys.has(key)) return;
		env[key] = value;
		managedEnvKeys.add(key);
	}

	function clearManagedEnv(): void {
		for (const key of managedEnvKeys) {
			delete env[key];
		}
		managedEnvKeys.clear();
	}

	return {
		managedEnvKeys() {
			return [...managedEnvKeys];
		},
		async inject() {
			try {
				const tokens = await options.store.loadTokens();
				clearManagedEnv();
				const provider = stringValue(tokens.modelProvider);
				const oauthProvider = stringValue(tokens.oauthProvider);
				const envProvider = stringValue(env[MODEL_PROVIDER_ENV_VAR]);
				const envDefaultProvider = stringValue(env[MODEL_DEFAULT_PROVIDER_ENV_VAR]);
				const routeProviderOverridden = Boolean(envProvider ?? envDefaultProvider);
				const effectiveProvider = envProvider ?? envDefaultProvider ?? provider;

				if (provider && !routeProviderOverridden) setManagedEnv(MODEL_PROVIDER_ENV_VAR, provider);
				const modelId = stringValue(tokens.modelId) ?? stringValue(tokens.model);
				if (modelId && (!routeProviderOverridden || effectiveProvider === provider)) {
					setManagedEnv(MODEL_ID_ENV_VAR, modelId);
				}
				const baseUrl = stringValue(tokens.modelBaseUrl);
				if (baseUrl && (!routeProviderOverridden || effectiveProvider === provider)) {
					setManagedEnv(MODEL_BASE_URL_ENV_VAR, baseUrl);
				}
				const fallbackProvider = stringValue(tokens.modelFallbackProvider);
				if (fallbackProvider) {
					const envFallbackProvider = stringValue(env[MODEL_FALLBACK_PROVIDER_ENV_VAR]);
					const fallbackProviderOverridden = Boolean(envFallbackProvider);
					setManagedEnv(MODEL_FALLBACK_PROVIDER_ENV_VAR, fallbackProvider);
					const fallbackModelId = stringValue(tokens.modelFallbackModelId);
					if (
						fallbackModelId &&
						(!fallbackProviderOverridden || envFallbackProvider === fallbackProvider)
					) {
						setManagedEnv(MODEL_FALLBACK_MODEL_ID_ENV_VAR, fallbackModelId);
					}
				}

				const credentialProviderMatchesRoute =
					!routeProviderOverridden || effectiveProvider === provider;

				// WHICHEVER PROVIDER ACTUALLY HAS A CREDENTIAL, asked of the credentials rather than of a
				// pointer beside them.
				//
				// The route's provider comes first: `model set` clears `oauthProvider` on any provider
				// change, so a node switched back to a provider whose credential is sitting right there
				// had it made unreachable — measured 2026-08-15, the injector exported nothing and said
				// nothing.
				//
				// `oauthProvider` remains the FALLBACK, and that is a real case rather than politeness:
				// a subscription login records it, and a route still naming a keyed provider should
				// dispatch through the subscription that was actually authenticated. Preferring the
				// route unconditionally would have broken that, which is what its test caught.
				const credentialProvider =
					provider && oauthCredentialsFor(tokens, provider) ? provider : (oauthProvider ?? provider);
				if (credentialProvider && credentialProviderMatchesRoute) {
					const creds = oauthCredentialsFor(tokens, credentialProvider);
					if (creds) {
						let effectiveCreds = creds;
						if (Date.now() >= creds.expires && options.refreshOAuthToken) {
							const refreshed = await options.refreshOAuthToken(credentialProvider, creds);
							if (refreshed) {
								effectiveCreds = refreshed;
								// WRITES BACK WHERE IT READ FROM. The location is resolved once, from the
								// same descriptor the read used, rather than rebuilt from the provider
								// name — a refreshed credential must not migrate stores just because it
								// was renewed.
								const location = credentialLocationFor(tokens, credentialProvider);
								if (location?.kind === "legacy") {
									const allOAuth =
										tokens.oauthCredentials && typeof tokens.oauthCredentials === "object"
											? (tokens.oauthCredentials as Record<string, unknown>)
											: {};
									await options.store.saveTokens({
										oauthCredentials: {
											...allOAuth,
											[location.provider]: refreshed,
										},
									});
								} else {
									// A namespaced credential is renewed in the silo's `model` namespace, and
									// this injector has no writer for it. REFUSING to write is the correct
									// outcome: writing it to the flat map instead would silently create a
									// second copy of a secret in a store the catalog does not describe.
									//
									// UNREACHABLE TODAY, and said plainly rather than left to look tested:
									// `credentialLocationFor` resolves through `readLegacyCredentials`, which
									// only ever produces legacy refs. This branch becomes live the moment a
									// login writes a namespaced credential, and it exists now so that the
									// writer's arrival is not also the arrival of a silent second copy.
									warn(
										`[farmhand] refreshed ${credentialProvider} credential is not stored in the flat token map; leaving it to the owner of its store`,
									);
								}
							} else {
								warn(`[farmhand] OAuth token refresh failed for ${credentialProvider} - agent may fail`);
								return;
							}
						}
						if (credentialProvider && !routeProviderOverridden && provider !== credentialProvider) {
							setManagedEnv(MODEL_PROVIDER_ENV_VAR, credentialProvider);
						}
						const envKey = modelCredentialEnvKey(credentialProvider);
						if (envKey) setManagedEnv(envKey, effectiveCreds.access);
						if (credentialProvider === "openai-codex" && effectiveCreds.accountId) {
							setManagedEnv("OPENAI_CODEX_ACCOUNT_ID", effectiveCreds.accountId);
						}
						return;
					}
				}

				const apiKey = stringValue(tokens.modelApiKey);
				if (apiKey && provider && credentialProviderMatchesRoute) {
					const envKey = modelCredentialEnvKey(provider);
					if (envKey) setManagedEnv(envKey, apiKey);
				}
			} catch {
				// Silo unavailable - environment fallback still applies.
			}
		},
	};
}
