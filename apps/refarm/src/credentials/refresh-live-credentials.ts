/**
 * RENEWING WITHOUT RESTARTING.
 *
 * The last piece of the failure measured 2026-08-19: a credential handed to the host at spawn goes
 * stale about a day later, and every dispatch then fails with `token expired`. Two halves fix it —
 * the host reading a FILE it can be handed again (`MODEL_ACCOUNT_CREDENTIALS_PATH`), and something
 * rewriting that file before the token lapses. This is the second half.
 *
 * It runs on the dispatch path, so it does the least it can: renews only what is EXPIRED, and only
 * for the provider whose tokens actually expire. A node whose credentials are live pays one map
 * lookup and no network call at all.
 *
 * NO RESTART, deliberately. Restarting to pick up a renewed credential kills work in flight — on a
 * node meant to serve a phone and a PWA, that includes the operator's own work from somewhere else.
 */
import { copilotRequestIdentity, resolveCopilotIdentity } from "@refarm.dev/github-copilot-wire";
import type { ModelAccountDescriptor } from "@refarm.dev/model-account-contract-v1";
import fs from "node:fs";
import path from "node:path";

import { isExpired, renewExpiredCopilotCredentials } from "./copilot-renew.js";
import { writeLiveCredentials } from "./live-credential-file.js";

export interface RefreshLiveCredentialsDeps {
	readonly home: string;
	readonly accounts: readonly ModelAccountDescriptor[];
	readonly credentials: ReadonlyMap<string, unknown>;
	/** Serialises the renewed map into the shape the host parses. */
	readonly buildMap: (
		accounts: readonly { credentialId: string; provider: string }[],
		credentials: ReadonlyMap<string, unknown>,
	) => string;
	readonly clientId: string;
	readonly userAgent: string;
	readonly fetch: typeof globalThis.fetch;
	readonly save: (credentialId: string, credential: Record<string, unknown>) => Promise<void>;
	readonly now?: () => number;
}

export type RefreshOutcome =
	/** Nothing had lapsed. No network call was made. */
	| { readonly kind: "none-stale" }
	/** Renewed, and the file the running host re-reads was rewritten. */
	| { readonly kind: "refreshed"; readonly accounts: readonly string[]; readonly path: string }
	/** Something lapsed and could not be renewed. The dispatch proceeds and will say what the
	 *  provider thinks — a failed renewal must not remove a credential that might still work. */
	| { readonly kind: "could-not-renew"; readonly because: string };

export async function refreshLiveCredentials(
	deps: RefreshLiveCredentialsDeps,
): Promise<RefreshOutcome> {
	const now = (deps.now ?? Date.now)();
	const stale = deps.accounts.filter(
		(account) =>
			account.provider === "github-copilot" &&
			isExpired(deps.credentials.get(account.credentialId), now),
	);
	if (stale.length === 0) return { kind: "none-stale" };

	try {
		const identity = copilotRequestIdentity(
			resolveCopilotIdentity(
				JSON.parse(fs.readFileSync(path.join(deps.home, "config.json"), "utf8")) as unknown,
			),
			deps.clientId,
			deps.userAgent,
		);
		const renewed = await renewExpiredCopilotCredentials(stale, deps.credentials, {
			fetch: deps.fetch,
			identityHeaders: identity.headers,
			save: deps.save,
		});
		// STILL EXPIRED means the exchange refused. Saying so beats writing a file that changes
		// nothing and reporting success.
		const remaining = stale.filter((a) => isExpired(renewed.get(a.credentialId), now));
		if (remaining.length === deps.accounts.length || remaining.length === stale.length) {
			return {
				kind: "could-not-renew",
				because:
					`the model credential for ${remaining.map((a) => a.alias).join(", ")} has expired and ` +
					"could not be renewed. The dispatch will go out with what this node holds and the " +
					"provider will say what it thinks of it.",
			};
		}
		const written = writeLiveCredentials(deps.home, deps.buildMap(deps.accounts, renewed));
		if (!written) return { kind: "could-not-renew", because: "the renewed map was empty." };
		return {
			kind: "refreshed",
			accounts: stale.filter((a) => !remaining.includes(a)).map((a) => a.alias),
			path: written,
		};
	} catch (error) {
		return {
			kind: "could-not-renew",
			because: error instanceof Error ? error.message : String(error),
		};
	}
}
