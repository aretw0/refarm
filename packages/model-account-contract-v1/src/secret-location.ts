/**
 * WHERE A CREDENTIAL'S SECRET ACTUALLY LIVES — the dual-read period, in one place.
 *
 * The spec's migration forbids dual-WRITING a secret value, and for a good reason: two copies of a
 * secret are two places to revoke, and they drift. So a new login writes only to the namespaced
 * store, while every credential stored before it stays in the flat `oauthCredentials` map.
 *
 * That means BOTH must stay readable for as long as both exist. This function is the alternative to
 * that knowledge spreading across the four call sites that read credentials today — each of which
 * would otherwise have to guess, and would guess differently.
 *
 * READERS BEFORE WRITERS. Switching the writer first would leave a new credential that nothing can
 * read; teaching the readers first makes the writer switch safe.
 */
import type { ModelAccountDescriptor } from "./types.js";

/** Marks a descriptor whose secret is in the flat token map rather than a silo namespace. */
export const LEGACY_REF_PREFIX = "legacy:oauthCredentials/";

/** The silo namespace new credentials are written to (D2). */
export const MODEL_SECRET_NAMESPACE = "model";

/**
 * THREE STATES. `unknown` is not a formality: a descriptor written by a newer refarm, or a
 * corrupted one, must not be read as either store. Loading the wrong one returns "no credential"
 * for a credential that exists, and sends the operator to log in again over working material.
 */
export type CredentialSecretLocation =
	| { readonly kind: "legacy"; readonly provider: string }
	| { readonly kind: "namespaced"; readonly namespace: string; readonly id: string }
	| { readonly kind: "unknown"; readonly secretRef: string };

/** PURE. Where to look for this descriptor's secret. */
export function credentialSecretLocation(
	descriptor: ModelAccountDescriptor,
): CredentialSecretLocation {
	const ref = descriptor.secretRef;
	if (ref.startsWith(LEGACY_REF_PREFIX)) {
		return { kind: "legacy", provider: ref.slice(LEGACY_REF_PREFIX.length) };
	}
	const namespaced = `${MODEL_SECRET_NAMESPACE}/`;
	if (ref.startsWith(namespaced)) {
		return {
			kind: "namespaced",
			namespace: MODEL_SECRET_NAMESPACE,
			id: ref.slice(namespaced.length),
		};
	}
	return { kind: "unknown", secretRef: ref };
}
