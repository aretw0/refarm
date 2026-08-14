/**
 * READING THE OLD SHAPE — additive, reversible, and never a rewrite.
 *
 * The spec's migration is five steps and the first is the only one S0 performs: read legacy
 * `oauthCredentials[provider]` and `modelApiKey` as an implicit `<provider>/default` credential,
 * identity `unverified`. Nothing here writes. Nothing dual-writes a secret value. The operator's
 * silo is left exactly as it is until he next authenticates, which is what makes this reversible:
 * deleting this file restores the old behaviour completely.
 */
import { newCredentialId, type ModelAccountDescriptor } from "./types.js";

/** The alias a legacy credential is READ under. It is a display string and means nothing. */
export const LEGACY_ALIAS = "default";

function legacyDescriptor(provider: string): ModelAccountDescriptor {
	return {
		// Seeded by provider so a re-read produces the same id, and so a binding written against a
		// legacy account survives a restart.
		credentialId: newCredentialId(`legacy:${provider}`),
		provider,
		alias: LEGACY_ALIAS,
		identity: { status: "unverified" },
		secretRef: `model/${provider}`,
		// Claimed healthy here and CONFIRMED by `reconcileCatalog` against the secrets that actually
		// exist. This function cannot see the store, so it must not pretend to have checked.
		health: "healthy",
		revision: "sha256:legacy",
	};
}

/** PURE. Legacy silo tokens read as accounts. Never returns secret material. */
export function readLegacyCredentials(tokens: Record<string, unknown>): ModelAccountDescriptor[] {
	const found: ModelAccountDescriptor[] = [];
	const oauth = tokens.oauthCredentials;
	if (oauth && typeof oauth === "object" && !Array.isArray(oauth)) {
		for (const provider of Object.keys(oauth as Record<string, unknown>)) {
			found.push(legacyDescriptor(provider));
		}
	}
	const apiProvider = typeof tokens.modelProvider === "string" ? tokens.modelProvider : undefined;
	const hasApiKey = typeof tokens.modelApiKey === "string" && tokens.modelApiKey.length > 0;
	// NOT double-counted. A silo holding an oauth entry AND naming the same provider as its API
	// model would otherwise yield two descriptors for one credential, and the resolver would read
	// that as two accounts and refuse as ambiguous — on a node with exactly one.
	if (apiProvider && hasApiKey && !found.some((a) => a.provider === apiProvider)) {
		found.push(legacyDescriptor(apiProvider));
	}
	return found.sort((a, b) => a.provider.localeCompare(b.provider));
}
