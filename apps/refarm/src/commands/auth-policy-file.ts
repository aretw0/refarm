import { createHash } from "node:crypto";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * The auth policy FILE — reading it, writing it, and hashing a token for it.
 *
 * Extracted from `auth.ts` for one reason: `auth verify` (the SAS confirmation) writes
 * the same file, and having it import `auth.ts` while `auth.ts` registers it as a
 * subcommand would close an import cycle. The three functions below were already the
 * whole of the file contract; they are now stated once instead of twice, which also
 * means a future change to the write (mode, atomicity) cannot land on one writer and
 * miss the other.
 *
 * ONE invariant, shared by every caller: the policy stores only a token's SHA-256,
 * never the raw token, and the file is 0600.
 */

/** SHA-256 as lowercase hex — the exact digest the daemon (auth.rs) matches. */
export function sha256Hex(input: string): string {
	return createHash("sha256").update(input).digest("hex");
}

export interface AuthCredential {
	identity: string;
	tokenSha256: string;
}

export interface AuthPolicyFile {
	credentials: AuthCredential[];
	// workspaces/memberships (Slice 2) and `scopedCredentials` (the SAS slice) are
	// preserved verbatim if present.
	[key: string]: unknown;
}

/**
 * Read the policy file, tolerant of a missing file (→ empty policy) but NOT of a
 * corrupt one (a present-but-broken policy must not be silently overwritten).
 */
export async function readPolicy(policyPath: string): Promise<AuthPolicyFile> {
	let raw: string;
	try {
		raw = await readFile(policyPath, "utf8");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return { credentials: [] };
		throw error;
	}
	const parsed = JSON.parse(raw) as AuthPolicyFile;
	return { ...parsed, credentials: Array.isArray(parsed.credentials) ? parsed.credentials : [] };
}

/**
 * Write the policy, 0600, creating the directory if needed.
 *
 * `chmod` after the write because `writeFile`'s `mode` only applies when the file is
 * CREATED — a rewrite would otherwise inherit whatever the file happened to carry.
 */
export async function writePolicy(policyPath: string, policy: AuthPolicyFile): Promise<void> {
	await mkdir(path.dirname(policyPath), { recursive: true });
	await writeFile(policyPath, `${JSON.stringify(policy, null, 2)}\n`, { mode: 0o600 });
	await chmod(policyPath, 0o600);
}
