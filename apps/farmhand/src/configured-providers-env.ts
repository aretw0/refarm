/**
 * ADR-012 routing config: tell the guest agent WHICH providers are configured, so its
 * named routing profiles (`cheap`/`balanced`/`reliable`) can resolve to a provider the
 * operator actually has a key for.
 *
 * The guest CANNOT see the API keys themselves — they are secret-shaped and the host's
 * env-forward gate blocks them from reaching a plugin (ADR-012 revision + the
 * `MODEL_SKILLS` gate lesson). So instead the host derives, from which credential env
 * vars are present, a NON-secret comma-separated list of provider NAMES and injects it
 * as `MODEL_CONFIGURED_PROVIDERS` (allow-listed as text-content in the tractor gate).
 * The agent reads it in `provider_config::configured_providers`.
 *
 * The list contains provider names only — never a key, never a value. The keyless local
 * floor (`ollama`) is always resolvable on the guest side regardless of this list.
 */

import { MODEL_CREDENTIAL_ENV_KEYS } from "@refarm.dev/config";

export const MODEL_CONFIGURED_PROVIDERS_ENV_VAR = "MODEL_CONFIGURED_PROVIDERS";

/**
 * The set of providers whose credential env var is present (non-empty) in `env`. Pure
 * over the injected env map so it is unit-testable. Provider names are returned in the
 * stable declaration order of `MODEL_CREDENTIAL_ENV_KEYS`.
 */
export function configuredProviders(env: NodeJS.ProcessEnv): string[] {
	const configured: string[] = [];
	for (const [provider, credentialKey] of Object.entries(MODEL_CREDENTIAL_ENV_KEYS)) {
		const value = env[credentialKey];
		if (typeof value === "string" && value.trim().length > 0) {
			configured.push(provider);
		}
	}
	return configured;
}

/**
 * Build the `MODEL_CONFIGURED_PROVIDERS` value from the environment. A comma-separated
 * list of the configured provider names, or the empty string when none are configured
 * (the guest still has the `ollama` floor). No keys, no secrets — names only.
 */
export function buildConfiguredProvidersEnv(env: NodeJS.ProcessEnv): string {
	return configuredProviders(env).join(",");
}

/**
 * Set `MODEL_CONFIGURED_PROVIDERS` on `env` so the guest's routing profiles can resolve
 * against the real configured set. A no-op (env left untouched) when no provider has a
 * key — the guest then only sees the keyless `ollama` floor, which is correct. Returns
 * the count injected. Best-effort by construction; it only reads env.
 */
export function injectConfiguredProvidersEnv(env: NodeJS.ProcessEnv = process.env): {
	count: number;
} {
	const providers = configuredProviders(env);
	if (providers.length === 0) return { count: 0 };
	env[MODEL_CONFIGURED_PROVIDERS_ENV_VAR] = providers.join(",");
	return { count: providers.length };
}
