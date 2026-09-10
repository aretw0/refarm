/**
 * THE CREDENTIAL FILE A RUNNING NODE RE-READS.
 *
 * MEASURED 2026-08-19: every dispatch failed with `token expired` about a day after the runtime
 * started, and only a restart fixed it. The credential was fine and the host already re-reads its
 * map on every call — what was missing was a source anything could rewrite. A process cannot have
 * its own environment updated from outside; a file it re-reads can.
 *
 * The host prefers `MODEL_ACCOUNT_CREDENTIALS_PATH` over the inline copy and falls back to it when
 * the file is missing or empty, so nothing that works today stops working.
 *
 * THE NAME ENDS IN `.token` ON PURPOSE. `SOVEREIGN_LAYOUT` classifies that suffix as a secret, so
 * this file is never carried into a backup bundle and the manifest names it as something to
 * re-obtain. That rule is inherited rather than restated.
 */
import fs from "node:fs";
import path from "node:path";

export const LIVE_CREDENTIALS_FILE = "model-accounts.token";
export const MODEL_ACCOUNT_CREDENTIALS_PATH_ENV_VAR = "MODEL_ACCOUNT_CREDENTIALS_PATH";

/** Where the file lives for a node home. */
export function liveCredentialsPath(home: string): string {
	return path.join(home, LIVE_CREDENTIALS_FILE);
}

/**
 * Write the map the running host should pick up next.
 *
 * ATOMIC, via a temp file and a rename: the host reads this on a dispatch path, and a half-written
 * map read mid-write would blank a seat that is perfectly good. 0600 because it is a credential.
 *
 * Returns the path written, or `null` when the map is empty — an empty file is not a credential
 * map, and writing one would take a working node down to the inline fallback for no reason.
 */
export function writeLiveCredentials(home: string, credentialMap: string): string | null {
	const contents = credentialMap.trim();
	if (!contents || contents === "{}") return null;
	const target = liveCredentialsPath(home);
	const temporary = `${target}.writing`;
	fs.mkdirSync(path.dirname(target), { recursive: true });
	fs.writeFileSync(temporary, `${contents}\n`, { mode: 0o600 });
	fs.renameSync(temporary, target);
	return target;
}
