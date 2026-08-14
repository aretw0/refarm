/**
 * ONE VIEW OF EVERY CREDENTIAL THIS NODE HOLDS, assembled once per invocation.
 *
 * Readers are synchronous and pure; the namespaced secret store is not. Rather than make five call
 * sites async and contaminate two apps, the caller loads everything once and hands over this. A
 * command then answers every credential question from ONE consistent snapshot, instead of re-reading
 * between two questions and getting two different worlds.
 *
 * WHY THE LEGACY PATH IS HERE AT ALL, since it is fair to ask: it is a transition, not a design.
 * Credentials stored before the namespaced store existed live in the flat token map, and dropping
 * the read would leave a working node with no credential until its operator authenticated again.
 * `legacyAccounts` is the number that says when the transition is over — when it is empty on every
 * node that matters, the legacy branch is deletable rather than maintainable, and this file is where
 * that deletion happens.
 */
import { reconcileCatalog, upsertDescriptor } from "./catalog.js";
import { readLegacyCredentials } from "./migrate.js";
import { readCredentialAt } from "./read-credential.js";
import { isRefusal, resolveModelAccount } from "./resolve.js";
import { credentialSecretLocation, LEGACY_REF_PREFIX } from "./secret-location.js";
import { REFUSAL_CODES, type ModelAccountBinding, type ModelAccountDescriptor } from "./types.js";

/**
 * What a caller learns when it asks for a provider's credential.
 *
 * FIVE OUTCOMES, because collapsing any two of them produces a wrong repair. `none` sends the
 * operator to log in; `incomplete` sends him to repair a secret that went missing under a
 * descriptor; `ambiguous` sends him to bind or name one; `unreadable` says the store could not be
 * consulted at all, which is not the same as it being empty.
 */
export type CredentialForProvider =
	| { readonly kind: "found"; readonly credential: Record<string, unknown>; readonly descriptor: ModelAccountDescriptor }
	| { readonly kind: "none" }
	| { readonly kind: "incomplete"; readonly descriptor: ModelAccountDescriptor }
	| { readonly kind: "ambiguous"; readonly candidates: readonly { credentialId: string; alias: string }[] }
	| { readonly kind: "unreadable"; readonly reason: string };

export interface AccountView {
	/** Every account this node holds, legacy and namespaced, health already reconciled. */
	readonly accounts: readonly ModelAccountDescriptor[];
	/** Those still in the flat token map. Empty means the transition is over. */
	readonly legacyAccounts: readonly ModelAccountDescriptor[];
	readonly credentialFor: (provider: string) => CredentialForProvider;
}

export interface BuildAccountViewInput {
	readonly tokens: Record<string, unknown>;
	readonly catalog: readonly ModelAccountDescriptor[];
	/** Pre-loaded namespaced secrets, keyed by `secretRef`. Absence of a key means absent. */
	readonly secrets: ReadonlyMap<string, unknown>;
	readonly bindings?: readonly ModelAccountBinding[];
	readonly workspaceId?: string | null;
}

/** PURE. The whole credential picture, from inputs the caller has already gathered. */
export function buildAccountView(input: BuildAccountViewInput): AccountView {
	const legacy = readLegacyCredentials(input.tokens);
	const merged = input.catalog.reduce<ModelAccountDescriptor[]>(
		(acc, entry) => upsertDescriptor(acc, entry),
		legacy,
	);
	// Legacy refs are present by definition — their secret is the flat map entry that produced the
	// descriptor — so they are declared present here rather than looked up in a store they do not
	// live in.
	const presentRefs = [
		...merged.filter((e) => e.secretRef.startsWith(LEGACY_REF_PREFIX)).map((e) => e.secretRef),
		...[...input.secrets.keys()],
	];
	const accounts = reconcileCatalog(merged, presentRefs);

	const credentialFor = (provider: string): CredentialForProvider => {
		const resolved = resolveModelAccount({
			provider,
			accounts,
			bindings: input.bindings ?? [],
			workspaceId: input.workspaceId ?? null,
		});
		if (isRefusal(resolved)) {
			if (resolved.code === REFUSAL_CODES.ambiguous) {
				return { kind: "ambiguous", candidates: resolved.candidates };
			}
			if (resolved.code === REFUSAL_CODES.incomplete) {
				const descriptor = accounts.find(
					(a) => a.provider === provider && a.health === "incomplete",
				);
				return descriptor ? { kind: "incomplete", descriptor } : { kind: "none" };
			}
			return { kind: "none" };
		}
		const descriptor = accounts.find((a) => a.credentialId === resolved.credentialId);
		if (!descriptor) return { kind: "none" };
		const read = readCredentialAt(credentialSecretLocation(descriptor), {
			legacyOauthCredentials: input.tokens.oauthCredentials as Record<string, unknown> | undefined,
			namespacedSecret: (namespace, id) => input.secrets.get(`${namespace}/${id}`),
		});
		if (read.kind === "found") return { kind: "found", credential: read.credential, descriptor };
		if (read.kind === "absent") return { kind: "incomplete", descriptor };
		return { kind: "unreadable", reason: read.reason };
	};

	return {
		accounts,
		legacyAccounts: accounts.filter((a) => a.secretRef.startsWith(LEGACY_REF_PREFIX)),
		credentialFor,
	};
}
