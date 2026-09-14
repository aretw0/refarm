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
	provisionableAccounts,
	readCredentialAt,
	readLegacyCredentials,
	type ModelAccountDescriptor,
	type ModelAuthorization,
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

/** The namespaced secret store, which the flat token store is not. Optional so a host wired
 *  without one keeps its exact previous behaviour rather than failing to boot. */
export interface NamespacedSecrets {
	load(namespace: string, id: string): Promise<unknown>;
	save(namespace: string, id: string, value: string): Promise<unknown>;
}

export interface DeclaredAccounts {
	readonly catalog: readonly ModelAccountDescriptor[];
	readonly authorization: ModelAuthorization;
}

export const MODEL_SECRET_NAMESPACE = "model";

export interface SiloModelEnvInjectorOptions {
	store: SiloModelTokenStore;
	env?: NodeJS.ProcessEnv;
	warn?: (message: string) => void;
	refreshOAuthToken?: (oauthProvider: string, creds: OAuthCreds) => Promise<OAuthCreds | null>;
	/** What this node holds and what it declared it may spend. Absent leaves the injector exactly
	 *  as it was — the flat map only — which is what an un-adopted host should keep doing. */
	accounts?: () => Promise<DeclaredAccounts>;
	/** Where a namespaced credential is read and RENEWED back to. Without it a refreshed
	 *  namespaced credential is refused rather than written to the flat map (a second copy). */
	secrets?: NamespacedSecrets;
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
function credentialLocationFor(
	tokens: SiloModelTokens,
	provider: string,
	catalog: readonly ModelAccountDescriptor[] = [],
) {
	// THE CATALOG FIRST, and ISS-081/ISS-140 are why. This resolved only through
	// `readLegacyCredentials`, so on a node whose credentials `sow` had already migrated into the
	// namespaced store it found NOTHING — not to inject and not to refresh. The comment below the
	// refresh write-back called its namespaced branch "unreachable today"; the writer arrived and
	// the reader did not follow, so the branch stayed unreachable for the opposite reason.
	const described = catalog.find((account) => account.provider === provider && account.health === "healthy");
	if (described) return credentialSecretLocation(described);
	const descriptor = readLegacyCredentials(tokens as Record<string, unknown>).find(
		(account) => account.provider === provider,
	);
	return descriptor ? credentialSecretLocation(descriptor) : null;
}

/** PURE. A stored blob read as an OAuth credential, or nothing. The three fields are what the
 *  refresh path and the host both require; a blob missing any of them is not one this can use. */
function asOAuthCreds(candidate: unknown): OAuthCreds | undefined {
	if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return undefined;
	const c = candidate as Partial<OAuthCreds>;
	if (typeof c.access !== "string" || typeof c.refresh !== "string" || typeof c.expires !== "number") {
		return undefined;
	}
	return {
		access: c.access,
		refresh: c.refresh,
		expires: c.expires,
		...(typeof c.accountId === "string" && c.accountId.trim().length > 0
			? { accountId: c.accountId.trim() }
			: {}),
	};
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

	/**
	 * Provision the accounts this node DECLARED it may spend (ISS-131 tier 3, ISS-140).
	 *
	 * One credential env var per provider is what the host reads, so this injects at most one
	 * account per provider and REFUSES where two were authorised — naming the collision rather than
	 * choosing. A silent choice here would spend an account the operator did not pick while the
	 * budget record named the other, which is the confused deputy with a receipt.
	 */
	async function injectDeclaredAccounts(
		tokens: SiloModelTokens,
		declared: DeclaredAccounts,
	): Promise<void> {
		const { provision, ambiguous } = provisionableAccounts(declared);
		for (const { provider, aliases } of ambiguous) {
			warn(
				`[farmhand] ${provider} has ${aliases.length} authorised accounts (${aliases.join(", ")}) and the host reads one credential per provider, so NONE was provisioned. Authorise exactly one, or bind per workspace once the host scopes routes per task.`,
			);
		}
		const providerBaseUrls: string[] = [];
		for (const account of provision) {
			const envKey = modelCredentialEnvKey(account.provider);
			if (!envKey) continue;
			const creds = await credentialForAccount(tokens, account);
			if (!creds) continue;
			// THE ENDPOINT TRAVELS WITH THE CREDENTIAL (ISS-141). Some providers announce where a
			// seat talks as part of issuing its token — Copilot returns a different host per seat —
			// so the host cannot resolve it from a static table and the global MODEL_BASE_URL would
			// redirect every other provider along with it.
			const announced = await announcedBaseUrl(tokens, account);
			if (announced) providerBaseUrls.push(`${account.provider}=${announced}`);
			let effective = creds;
			if (Date.now() >= creds.expires && options.refreshOAuthToken) {
				const refreshed = await options.refreshOAuthToken(account.provider, creds);
				if (!refreshed) {
					warn(
						`[farmhand] OAuth token refresh failed for ${account.provider} "${account.alias}" - the agent may fail against it`,
					);
					continue;
				}
				effective = refreshed;
				await writeRenewedCredential(account, refreshed);
			}
			setManagedEnv(envKey, effective.access);
			if (account.provider === "openai-codex" && effective.accountId) {
				setManagedEnv("OPENAI_CODEX_ACCOUNT_ID", effective.accountId);
			}
		}
		if (providerBaseUrls.length > 0) {
			setManagedEnv("MODEL_PROVIDER_BASE_URLS", providerBaseUrls.join(","));
		}
	}

	/** The endpoint a credential announces for itself, when it announces one and the value is one
	 *  the host and guest will both accept. Malformed is DROPPED: a value with whitespace fails the
	 *  host's forward policy and takes the whole variable — and every other provider — with it. */
	async function announcedBaseUrl(
		tokens: SiloModelTokens,
		account: ModelAccountDescriptor,
	): Promise<string | undefined> {
		const location = credentialSecretLocation(account);
		let raw: unknown;
		const read = readCredentialAt(location, {
			legacyOauthCredentials: tokens.oauthCredentials as Record<string, unknown> | undefined,
			namespacedSecret: () => undefined,
		});
		if (read.kind === "found") raw = read.credential;
		else if (location.kind === "namespaced" && options.secrets) {
			try {
				const value = await options.secrets.load(location.namespace, location.id);
				raw = typeof value === "string" ? JSON.parse(value) : value;
			} catch {
				return undefined;
			}
		}
		const baseUrl = (raw as { baseUrl?: unknown } | undefined)?.baseUrl;
		if (typeof baseUrl !== "string") return undefined;
		const trimmed = baseUrl.trim();
		if (!/^https?:\/\/[\x21-\x7e]+$/u.test(trimmed) || trimmed.includes(",")) return undefined;
		return trimmed;
	}

	/** One account's stored credential, read from wherever its descriptor says it lives. */
	async function credentialForAccount(
		tokens: SiloModelTokens,
		account: ModelAccountDescriptor,
	): Promise<OAuthCreds | undefined> {
		const location = credentialSecretLocation(account);
		const read = readCredentialAt(location, {
			legacyOauthCredentials: tokens.oauthCredentials as Record<string, unknown> | undefined,
			namespacedSecret: (_namespace, _id) => undefined,
		});
		if (read.kind === "found") return asOAuthCreds(read.credential);
		// `unknown` is a secretRef this build cannot place. Reading a namespace off it would be
		// inventing one, so the account is simply not provisioned and the dispatch fails loudly.
		if (location.kind !== "namespaced" || !options.secrets) return undefined;
		const { namespace, id } = location;
		try {
			const value = await options.secrets.load(namespace, id);
			if (value === undefined || value === null) return undefined;
			return asOAuthCreds(typeof value === "string" ? JSON.parse(value) : value);
		} catch {
			// Unreadable is not absent, and this injector cannot tell the host which it was. Leaving
			// the credential out fails the dispatch loudly rather than sending a malformed token.
			return undefined;
		}
	}

	/** A renewed credential goes back WHERE IT CAME FROM. Writing a namespaced credential into the
	 *  flat map would create a second copy of a secret the catalog does not describe. */
	async function writeRenewedCredential(
		account: ModelAccountDescriptor,
		refreshed: OAuthCreds,
	): Promise<void> {
		const location = credentialSecretLocation(account);
		if (location.kind === "legacy") {
			const tokens = await options.store.loadTokens();
			const allOAuth =
				tokens.oauthCredentials && typeof tokens.oauthCredentials === "object"
					? (tokens.oauthCredentials as Record<string, unknown>)
					: {};
			await options.store.saveTokens({
				oauthCredentials: { ...allOAuth, [location.provider]: refreshed },
			});
			return;
		}
		if (location.kind !== "namespaced" || !options.secrets) {
			warn(
				`[farmhand] refreshed ${account.provider} "${account.alias}" credential could not be stored: this host has no namespaced secret writer, so the renewal will be repeated every start`,
			);
			return;
		}
		await options.secrets.save(location.namespace, location.id, JSON.stringify(refreshed));
	}

	/** The route and the ONE credential the flat token map describes. Unchanged behaviour, moved
	 *  into its own function so its early returns stop short-circuiting the declared-account pass
	 *  that now follows it. */
	async function injectFromTokens(
		tokens: SiloModelTokens,
		catalog: readonly ModelAccountDescriptor[],
	): Promise<void> {
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
								const location = credentialLocationFor(tokens, credentialProvider, catalog);
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
	}

	return {
		managedEnvKeys() {
			return [...managedEnvKeys];
		},
		async inject() {
			try {
				const tokens = await options.store.loadTokens();
				clearManagedEnv();
				const declared = options.accounts ? await options.accounts() : null;
				await injectFromTokens(tokens, declared?.catalog ?? []);
				// LAST, AND IT OVERWRITES. What the operator DECLARED outranks what the flat map
				// happens to still hold: the declaration is the node's answer to which accounts it
				// may spend, and the flat map is a store this design is migrating away from.
				if (declared) await injectDeclaredAccounts(tokens, declared);
			} catch {
				// Silo unavailable - environment fallback still applies.
			}
		},
	};
}
