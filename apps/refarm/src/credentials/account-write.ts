/**
 * WRITING A CREDENTIAL WHERE IT NOW BELONGS — and migrating the old one out in the same act.
 *
 * The secret goes to Silo's `model` namespace under an opaque credential id; the descriptor goes to
 * the non-secret catalog beside the config. The flat `oauthCredentials[provider]` slot is NOT
 * written, because two copies of a secret are two places to revoke and they drift.
 *
 * WHICH IS WHY THE LEGACY ENTRY IS REMOVED HERE. Leaving it would make a re-login of a provider
 * produce TWO accounts for it — the old flat one and the new namespaced one — and every dispatch
 * would then refuse as ambiguous on a node with one real credential. So a re-login migrates that
 * provider, and the legacy path shrinks by one every time the operator authenticates.
 *
 * RETIREMENT SPANS BOTH STORES, and ISS-134 is why that has to be said. A legacy credential exists
 * in two places — the flat secret, and the catalog RECORD that may have been persisted naming it.
 * Retiring one and not the other leaves the node counting a credential it just deleted, which is
 * precisely the ambiguity the paragraph above claims to prevent.
 *
 * ORDER IS THE SAFETY. Secret, then descriptor, then removal. A failure at the last step leaves a
 * duplicate, which is visible and repairable; the reverse order would lose a working credential
 * between two writes. The record leaves with the descriptor write rather than with the secret
 * removal, because a legacy descriptor is DERIVED from the flat map on every read: while the entry
 * survives, the view re-derives it, with the same deterministic id.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import {
	describeNewCredential,
	isIndistinguishableAccount,
	LEGACY_REF_PREFIX,
	legacySubjectOf,
	upsertDescriptor,
	type ModelAccountDescriptor,
} from "@refarm.dev/model-account-contract-v1";

import { CATALOG_FILE, MODEL_NAMESPACE, readCatalog } from "./account-view-loader.js";

export interface AccountWriteSilo {
	loadTokens(): Promise<unknown>;
	saveTokens(tokens: Record<string, unknown>): Promise<unknown>;
	saveSecret?(namespace: string, id: string, value: string): Promise<unknown>;
}

export interface WriteModelCredentialInput {
	readonly home: string;
	readonly silo: AccountWriteSilo;
	readonly provider: string;
	readonly credentials: Record<string, unknown>;
	/** The operator's name for this account. Absent means the contract picks a free one. */
	readonly alias?: string;
}

export interface WriteModelCredentialResult {
	/** Absent when the write was refused — see `refusal`. */
	readonly descriptor?: ModelAccountDescriptor;
	/** True when this write also retired a flat-map entry for the same provider. */
	readonly migratedFromLegacy: boolean;
	/** Set when the secret could not be stored namespaced, so the caller can refuse honestly. */
	readonly refusal?: string;
	/** Set when a legacy entry for this provider was left in place, and WHY — it belongs to another
	 *  account, or this node cannot say whose it is. Silence here would repeat ISS-128 quietly. */
	readonly legacyKept?: string;
}

function writeCatalog(home: string, catalog: readonly ModelAccountDescriptor[]): void {
	const file = path.join(home, CATALOG_FILE);
	fs.mkdirSync(path.dirname(file), { recursive: true });
	fs.writeFileSync(file, `${JSON.stringify(catalog, null, 2)}\n`);
}

export async function writeModelCredential(
	input: WriteModelCredentialInput,
): Promise<WriteModelCredentialResult> {
	const serialised = JSON.stringify(input.credentials);
	const catalog = readCatalog(input.home);
	const accountId =
		typeof input.credentials.accountId === "string" && input.credentials.accountId.length > 0
			? input.credentials.accountId
			: undefined;
	// THE LEGACY DECISION IS TAKEN FIRST, before the credential is described, because it changes
	// what "already on this node" means. It used to be taken last, after the descriptor was named
	// and written — so a login that was about to retire a record was still named SECOND to it. That
	// is how the operator's single openai-codex account came back as "account-2" (ISS-134).
	const tokens = ((await input.silo.loadTokens()) ?? {}) as Record<string, unknown>;
	const flat = tokens.oauthCredentials as Record<string, unknown> | undefined;
	const legacyRef = `${LEGACY_REF_PREFIX}${input.provider}`;
	const legacyHeld = Boolean(flat && Object.hasOwn(flat, input.provider));
	// Asked of the contract, never parsed here — one reader of the legacy shape.
	const legacySubject = legacyHeld ? legacySubjectOf(flat![input.provider]) : undefined;
	//
	//    Retirement used to be keyed on the PROVIDER, and ISS-128 measured what that costs: a legacy
	//    `openai-codex` holding account A, a login for account B, and A was deleted while the call
	//    returned `migratedFromLegacy: true`. It reported the deletion as a successful migration.
	//
	//    KEEPING IS THE SAFE DIRECTION, and it is the same choice this function's write ordering
	//    already makes: a duplicate is visible in the catalog and repairable, a deleted credential
	//    is neither.
	const legacyKept = !legacyHeld
		? undefined
		: !legacySubject
			? `the stored ${input.provider} credential does not say which account it belongs to, so this ` +
				"node cannot say whose it is. It was KEPT rather than replaced; remove it deliberately " +
				"once you know."
			: legacySubject !== accountId
				? `the stored ${input.provider} credential belongs to a different account, so it was KEPT. ` +
					"Both are now on this node; bind the one a workspace should spend."
				: undefined;
	const retiring = legacyHeld && legacyKept === undefined;

	// What this provider ALREADY has, once the record this act is about to retire is discounted.
	// A record that is leaving in this same write is not a sibling of what is arriving.
	const standing = retiring ? catalog.filter((entry) => entry.secretRef !== legacyRef) : catalog;

	const described = describeNewCredential({
		provider: input.provider,
		...(accountId ? { accountId } : {}),
		...(input.alias ? { alias: input.alias } : {}),
		existing: standing,
		secretDigest: `sha256:${createHash("sha256").update(serialised).digest("hex").slice(0, 32)}`,
	});

	// REFUSED RATHER THAN WRITTEN. The provider gave no account id and this node already holds one
	// for it, so storing would either replace a working credential or duplicate it, and nothing here
	// can tell which. Measured 2026-08-15: this is exactly how the operator's first Copilot account
	// disappeared under his second.
	if (isIndistinguishableAccount(described)) {
		return {
			migratedFromLegacy: false,
			refusal:
				`${described.reason} Already stored: ${described.existingAliases.join(", ")}. ` +
				"Nothing was written.",
		};
	}
	const descriptor = described;

	if (typeof input.silo.saveSecret !== "function") {
		// REFUSED, not silently fallen back to the flat map. A fallback would write the secret to the
		// store this design is moving away from, and the operator would never learn that the account
		// he just added cannot coexist with another.
		return {
			descriptor,
			migratedFromLegacy: false,
			refusal: "this build's credential store cannot hold namespaced secrets, so a second account of one provider cannot be kept",
		};
	}

	// 1. The secret, first. A failure here leaves the catalog untouched.
	await input.silo.saveSecret(MODEL_NAMESPACE, descriptor.credentialId, serialised);

	// 2. The descriptor — and, when retiring, the record that named the old secret leaves in the SAME
	//    write. Retirement used to be one store deep: the flat secret went and the catalog record
	//    pointing at it stayed, so the node kept counting a credential it had just deleted.
	//
	//    THE RECORD GOES BEFORE THE SECRET, which inverts nothing: a legacy descriptor is DERIVED
	//    from the flat map on every read, so a failure between here and step 3 leaves the entry
	//    present and the view re-derives its descriptor — with the same deterministic id, so a
	//    binding written against it still resolves. The reverse order would leave a record naming a
	//    secret that no longer exists, which is the state ISS-132 had to make visible.
	writeCatalog(input.home, upsertDescriptor(standing, descriptor));

	// 3. The legacy entry for this provider, retired ONLY WHEN IT IS PROVABLY THIS ACCOUNT.
	if (retiring) {
		const { [input.provider]: _retired, ...rest } = flat!;
		await input.silo.saveTokens({ oauthCredentials: rest });
		return { descriptor, migratedFromLegacy: true };
	}
	return {
		descriptor,
		migratedFromLegacy: false,
		...(legacyKept ? { legacyKept } : {}),
	};
}
