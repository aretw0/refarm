/**
 * READING A CREDENTIAL FROM WHEREVER IT LIVES.
 *
 * `credentialSecretLocation` answers WHERE. This answers what is there, and it keeps three states
 * apart that every existing reader in this repository collapses into two:
 *
 *   found       the credential is here
 *   absent      the place exists and holds nothing
 *   unreadable  the place could not be consulted, or holds something unusable
 *
 * The third is the one that matters. A caller that cannot reach the namespaced store has not
 * established that a credential is missing — and reporting `absent` there sends the operator to
 * authenticate again over material that was fine. Every reader taught to use this stops being able
 * to make that mistake.
 *
 * PURE. The namespaced store is reached through an injected loader, so this can be tested against a
 * node that does not exist and cannot itself read a secret.
 */
import type { CredentialSecretLocation } from "./secret-location.js";

export type CredentialRead =
	| { readonly kind: "found"; readonly credential: Record<string, unknown> }
	| { readonly kind: "absent"; readonly reason: string }
	| { readonly kind: "unreadable"; readonly reason: string };

export interface CredentialSources {
	/** The flat `tokens.oauthCredentials` map, for credentials stored before the namespaced store. */
	readonly legacyOauthCredentials?: Record<string, unknown> | undefined;
	/** Reaches the silo's namespaced secrets. Absent means "cannot consult", never "empty". */
	readonly namespacedSecret?: (namespace: string, id: string) => unknown;
}

function classify(value: unknown, where: string): CredentialRead {
	if (value === undefined || value === null) {
		return { kind: "absent", reason: `nothing is stored at ${where}` };
	}
	if (typeof value !== "object") {
		return { kind: "unreadable", reason: `${where} holds a value that is not a credential` };
	}
	return { kind: "found", credential: value as Record<string, unknown> };
}

/** PURE. What is stored at this location, in three states. */
export function readCredentialAt(
	location: CredentialSecretLocation,
	sources: CredentialSources,
): CredentialRead {
	switch (location.kind) {
		case "legacy":
			return classify(
				sources.legacyOauthCredentials?.[location.provider],
				`oauthCredentials["${location.provider}"]`,
			);
		case "namespaced": {
			if (!sources.namespacedSecret) {
				// NOT `absent`. Nothing was consulted, so nothing was established.
				return {
					kind: "unreadable",
					reason: "this reader cannot consult the namespaced secret store",
				};
			}
			return classify(
				sources.namespacedSecret(location.namespace, location.id),
				`${location.namespace}/${location.id}`,
			);
		}
		default:
			return {
				kind: "unreadable",
				reason: `the credential points at "${location.secretRef}", which this build does not know how to read`,
			};
	}
}
