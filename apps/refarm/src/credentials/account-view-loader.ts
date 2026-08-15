/**
 * BUILDING THE ACCOUNT VIEW FROM THIS NODE — the one place that does the I/O.
 *
 * `buildAccountView` is pure and needs everything handed to it. This gathers those inputs from the
 * three stores that actually hold them, and it is deliberately the ONLY module that knows where
 * they are: the silo's flat tokens, the descriptor catalog beside the config, and the silo's `model`
 * secret namespace.
 *
 * SECRETS ARE LOADED FOR DESCRIBED ACCOUNTS ONLY. Enumerating the namespace would pull in
 * `unclaimed` material this node cannot attribute, and the view's job is to answer about accounts,
 * not to sweep a store.
 */
import fs from "node:fs";
import path from "node:path";

import {
	buildAccountView,
	type AccountView,
	type ModelAccountBinding,
	type ModelAccountDescriptor,
} from "@refarm.dev/model-account-contract-v1";

/** Where the non-secret descriptor catalog lives. Not in the silo — descriptors are not secrets. */
export const CATALOG_FILE = ".refarm/model-accounts.json";
export const MODEL_NAMESPACE = "model";

export interface AccountViewSilo {
	loadTokens(): Promise<unknown>;
	loadSecret?(namespace: string, id: string): Promise<unknown>;
}

export interface LoadAccountViewOptions {
	readonly home: string;
	readonly silo: AccountViewSilo;
	readonly workspaceId?: string | null;
}

function readJson<T>(file: string, fallback: T): T {
	try {
		return JSON.parse(fs.readFileSync(file, "utf8")) as T;
	} catch {
		return fallback;
	}
}

/** The descriptor catalog, or an empty one. A missing file is a node that has never written one. */
export function readCatalog(home: string): ModelAccountDescriptor[] {
	const parsed = readJson<unknown>(path.join(home, CATALOG_FILE), []);
	return Array.isArray(parsed) ? (parsed as ModelAccountDescriptor[]) : [];
}

/** Workspace bindings, which the node's own config owns and which persist the OPAQUE id. */
export function readBindings(home: string): ModelAccountBinding[] {
	const config = readJson<{ modelBindings?: Record<string, string> }>(
		path.join(home, ".refarm", "config.json"),
		{},
	);
	return Object.entries(config.modelBindings ?? {}).map(([workspaceId, credentialId]) => ({
		workspaceId,
		credentialId,
	}));
}

export async function loadAccountView(options: LoadAccountViewOptions): Promise<AccountView> {
	const tokens = ((await options.silo.loadTokens()) ?? {}) as Record<string, unknown>;
	const catalog = readCatalog(options.home);
	const secrets = new Map<string, unknown>();
	for (const descriptor of catalog) {
		const prefix = `${MODEL_NAMESPACE}/`;
		if (!descriptor.secretRef.startsWith(prefix)) continue;
		if (typeof options.silo.loadSecret !== "function") continue;
		const id = descriptor.secretRef.slice(prefix.length);
		try {
			const value = await options.silo.loadSecret(MODEL_NAMESPACE, id);
			if (value === undefined || value === null) continue;
			// PARSED HERE, because the silo stores a STRING and the readers expect a credential.
			// Measured 2026-08-15: with the string handed through untouched, a correctly bound account
			// resolved and then reported `unreadable` — the binding worked and the credential looked
			// broken, which is the most confusing possible pair.
			//
			// A string that is not JSON is left out rather than passed on: that is an `incomplete`
			// entry, which sends the operator to repair, and is the honest reading of material this
			// build cannot make sense of.
			if (typeof value === "string") {
				try {
					secrets.set(descriptor.secretRef, JSON.parse(value) as unknown);
				} catch {
					// Not a credential this build can read; left absent so the catalog reports it.
				}
				continue;
			}
			secrets.set(descriptor.secretRef, value);
		} catch {
			// Unreadable is not absent, and the view distinguishes them — but this loader cannot say
			// which without inventing a shape. Leaving the key out marks the account `incomplete`,
			// which sends the operator to repair rather than to re-authenticate.
		}
	}
	return buildAccountView({
		tokens,
		catalog,
		secrets,
		bindings: readBindings(options.home),
		workspaceId: options.workspaceId ?? null,
	});
}
