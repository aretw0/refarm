import { createHash } from "node:crypto";
import { existsSync } from "node:fs";

/**
 * Node-flavored hash convenience (imports node:crypto, so kept out of the pure index — import from
 * `@refarm.dev/std/node`). This is the one `createHash("sha256").digest("hex")` the substrate's
 * node consumers should share instead of re-writing it.
 */

/** Lowercase-hex SHA-256 of the given bytes or string, via node:crypto. */
export function sha256Hex(input: Uint8Array | string): string {
	return createHash("sha256").update(input).digest("hex");
}

/**
 * The env naming the auth policy file. The SAME variable the Rust sidecar reads
 * (`sidecar::auth::AUTH_POLICY_ENV`) and the same file — deliberately not a second
 * mechanism. One policy, one env, both runtimes.
 */
export const AUTH_POLICY_ENV = "REFARM_AUTH_POLICY";

/**
 * Is an auth policy configured for this process? This is the `authPolicyPresent` input the pure
 * bind guard (`@refarm.dev/std` → `refuseUnguardedNonLoopbackBind`) takes, resolved the same way
 * the Rust daemon resolves it: `REFARM_AUTH_POLICY` set, non-blank, and pointing at a file that
 * exists.
 *
 * SCOPE — read this before trusting it for more than it claims. This answers exactly one
 * question: "is a credential policy configured on this MACHINE." It does NOT read the policy,
 * validate it, or relate it to the caller, and it says nothing whatsoever about whether the
 * surface asking can verify a bearer.
 *
 * WHAT IT IS NO LONGER THE ANSWER TO (O5,
 * docs/superpowers/specs/2026-07-30-open-by-declaration-surfaces-design.md). It used to decide
 * whether a Node listener could bind off-loopback. That criterion measured the wrong thing
 * entirely: a listener that verifies nothing could open itself to other devices because some
 * OTHER surface had credentials — the appearance of a gate without a gate, which S3 forbids.
 * A surface's bind is now decided by the `surfaces` declaration
 * (`refuseBindOutsideDeclaration` in `@refarm.dev/std`), read from the FILESYSTEM
 * `.refarm/config.json`, exactly as the Rust guard decides its own.
 *
 * WHAT IT IS STILL THE ANSWER TO. A surface that DOES verify bearers needs to know a policy
 * exists — that is the question this function was always about. And O6's question about the
 * routes `refarm web serve` PROXIES is a machine-level question too: those requests are gated
 * by the daemon's policy upstream, not by anything the proxy does, so "is a credential policy
 * live on this machine" is precisely what has to be true before an open surface may carry them.
 *
 * Deliberately NOT cached: a long-lived process may have the policy provisioned after boot, and a
 * cached `false` would then be a stale reason to keep refusing.
 */
export function authPolicyPresent(env: NodeJS.ProcessEnv = process.env): boolean {
	const path = env[AUTH_POLICY_ENV]?.trim();
	if (!path) return false;
	return existsSync(path);
}
