/**
 * READING THE OLD SHAPE — additive, reversible, and never a rewrite.
 *
 * The spec's migration is five steps and the first is the only one S0 performs: read legacy
 * `oauthCredentials[provider]` and `modelApiKey` as an implicit `<provider>/default` credential,
 * identity `unverified`. Nothing here writes. Nothing dual-writes a secret value. The operator's
 * silo is left exactly as it is until he next authenticates, which is what makes this reversible:
 * deleting this file restores the old behaviour completely.
 */
import { LEGACY_REF_PREFIX } from "./secret-location.js";
import { newCredentialId, type ModelAccountDescriptor } from "./types.js";

/** The alias a legacy credential is READ under. It is a display string and means nothing. */
export const LEGACY_ALIAS = "default";

/** PURE. The provider's own account id inside a legacy blob, when it put one there.
 *  EXPORTED so the write path asks this module what a legacy blob says, rather than parsing the
 *  shape a second time — two readers of one shape is the defect ISS-113 and ISS-124 both were. */
export function legacySubjectOf(blob: unknown): string | undefined {
	if (!blob || typeof blob !== "object" || Array.isArray(blob)) return undefined;
	const id = (blob as Record<string, unknown>).accountId;
	return typeof id === "string" && id.length > 0 ? id : undefined;
}

function legacyDescriptor(provider: string, blob?: unknown): ModelAccountDescriptor {
	// THE BLOB IS OPENED NOW, and ISS-128 is why. This took only the provider, so a legacy account
	// had NO identity — and with no subject to compare, the write path's by-provider retirement had
	// to assume the entry belonged to whoever was logging in. Measured in a lab against the real
	// write path: a second openai-codex login deleted the first account and reported
	// `migratedFromLegacy: true`. The information was never missing; nothing read it.
	const subject = legacySubjectOf(blob);
	return {
		// Seeded by provider so a re-read produces the same id, and so a binding written against a
		// legacy account survives a restart.
		credentialId: newCredentialId(`legacy:${provider}`),
		provider,
		alias: LEGACY_ALIAS,
		// STILL UNVERIFIED, even knowing the subject. The provider confirmed nothing in this
		// session — the id was read off a stored blob. `verified` travels into budget and status
		// output where identity claims are believed, so knowing WHO does not license claiming
		// CONFIRMED. Absence stays absence: a blob with no id yields no subject, never an invented
		// one, because inventing would make two accounts look like one.
		identity: subject ? { status: "unverified", subject } : { status: "unverified" },
		// SELF-DESCRIBING, not inferred. A legacy secret is in the flat token map, NOT in the
		// `model` namespace, and a reader that looked for it there would report a working
		// credential as missing.
		secretRef: `${LEGACY_REF_PREFIX}${provider}`,
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
		const entries = oauth as Record<string, unknown>;
		for (const provider of Object.keys(entries)) {
			found.push(legacyDescriptor(provider, entries[provider]));
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
