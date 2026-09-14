/**
 * THE DESCRIPTOR CATALOG — what the node knows about its accounts, and nothing it must not say.
 *
 * D2 measured two constraints this file exists to respect rather than work around:
 *  - `saveIdentityMetadata()` is a shallow GLOBAL identity map and cannot own a multi-record
 *    catalog.
 *  - `listSecrets(namespace)` RETURNS SECRET VALUES and therefore cannot back `credential list`.
 *
 * So the catalog is its own thing, holds descriptors only, and is reconciled against a listing of
 * secret REFERENCES — never against secret material.
 *
 * NOTHING IS DELETED HERE. A descriptor without a secret is `incomplete`; a secret without a
 * descriptor is `unclaimed`. Both are the operator's material and may be the only copy; a tidy-up
 * that removed either would be irreversible and silent, which is the class of accident this whole
 * area has spent a week removing.
 *
 * PURE, and deterministic in order, so `credential list` reads the same twice.
 */
import { createHash } from "node:crypto";

import {
	newCredentialId,
	REFUSAL_CODES,
	type ModelAccountDescriptor,
	type ModelAccountRefusal,
} from "./types.js";

/** A revision that moves when the secret OR the metadata moves, so a snapshot pins both. */
export function descriptorRevision(input: {
	secretDigest: string;
	provider: string;
	alias: string;
	identitySubject?: string;
}): string {
	const digest = createHash("sha256")
		.update(
			JSON.stringify([input.secretDigest, input.provider, input.alias, input.identitySubject ?? ""]),
		)
		.digest("hex");
	return `sha256:${digest.slice(0, 32)}`;
}

/**
 * Match descriptors against the secret references that actually exist.
 *
 * `secretRefs` comes from the secret-DESCRIPTOR listing, which returns ids and never values.
 */
export function reconcileCatalog(
	descriptors: readonly ModelAccountDescriptor[],
	secretRefs: readonly string[],
): ModelAccountDescriptor[] {
	const present = new Set(secretRefs);
	const described = new Set(descriptors.map((d) => d.secretRef));
	const matched: ModelAccountDescriptor[] = descriptors.map((d) => ({
		...d,
		health: present.has(d.secretRef) ? ("healthy" as const) : ("incomplete" as const),
	}));
	const orphans: ModelAccountDescriptor[] = secretRefs
		.filter((ref) => !described.has(ref))
		.map((ref) => ({
			// DERIVED FROM THE REF, not a shared constant. Two orphans sharing one id would collapse
			// into a single row in `credential list` and one of the operator's secrets would vanish
			// from the only surface that reports it.
			credentialId: newCredentialId(`unclaimed:${ref}`),
			provider: "unknown",
			alias: ref,
			identity: { status: "unverified" as const },
			secretRef: ref,
			health: "unclaimed" as const,
			revision: "sha256:unclaimed",
		}));
	return [...matched, ...orphans].sort((a, b) => a.secretRef.localeCompare(b.secretRef));
}

/** Add or replace by opaque id. Siblings are returned untouched, by identity. */
export function upsertDescriptor(
	catalog: readonly ModelAccountDescriptor[],
	descriptor: ModelAccountDescriptor,
): ModelAccountDescriptor[] {
	const without = catalog.filter((e) => e.credentialId !== descriptor.credentialId);
	return [...without, descriptor];
}

/** Rename, changing the alias and NOTHING else. Uniqueness is per provider (D1). */
export function renameAlias(
	catalog: readonly ModelAccountDescriptor[],
	credentialId: string,
	alias: string,
): ModelAccountDescriptor[] | ModelAccountRefusal {
	const target = catalog.find((e) => e.credentialId === credentialId);
	if (!target) {
		return {
			code: REFUSAL_CODES.none,
			message: "no account on this node carries that id",
			candidates: catalog.map((e) => ({ credentialId: e.credentialId, alias: e.alias })),
		};
	}
	const clash = catalog.find(
		(e) => e.provider === target.provider && e.alias === alias && e.credentialId !== credentialId,
	);
	if (clash) {
		return {
			code: REFUSAL_CODES.ambiguous,
			message: `another ${target.provider} account already uses the alias "${alias}"`,
			candidates: [{ credentialId: clash.credentialId, alias: clash.alias }],
		};
	}
	return catalog.map((e) => (e.credentialId === credentialId ? { ...e, alias } : e));
}
