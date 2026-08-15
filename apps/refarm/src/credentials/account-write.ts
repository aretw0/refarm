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
 * ORDER IS THE SAFETY. Secret, then descriptor, then removal. A failure at the last step leaves a
 * duplicate, which is visible and repairable; the reverse order would lose a working credential
 * between two writes.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import {
	describeNewCredential,
	isIndistinguishableAccount,
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
	const described = describeNewCredential({
		provider: input.provider,
		...(accountId ? { accountId } : {}),
		...(input.alias ? { alias: input.alias } : {}),
		existing: catalog,
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

	// 2. The descriptor. A failure here leaves an `unclaimed` secret, which the catalog reports.
	writeCatalog(input.home, upsertDescriptor(catalog, descriptor));

	// 3. The legacy entry for this provider, retired. A failure here leaves a duplicate, which shows
	//    up as `ambiguous` and is repairable — the only one of the three that loses nothing.
	const tokens = ((await input.silo.loadTokens()) ?? {}) as Record<string, unknown>;
	const flat = tokens.oauthCredentials as Record<string, unknown> | undefined;
	if (flat && Object.hasOwn(flat, input.provider)) {
		const { [input.provider]: _retired, ...rest } = flat;
		await input.silo.saveTokens({ oauthCredentials: rest });
		return { descriptor, migratedFromLegacy: true };
	}
	return { descriptor, migratedFromLegacy: false };
}
