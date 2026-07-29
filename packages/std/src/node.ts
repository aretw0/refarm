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
 * SCOPE — read this before trusting it for more than it claims. This answers "did the operator
 * opt into the identity gate", which is exactly what the BIND decision needs: a bind wide enough
 * to reach other devices should only be possible once the operator has set up credentials. It
 * does NOT verify credentials, and today no Node surface does: the bearer check lives in the Rust
 * sidecar's `auth_middleware`. So a TS listener that binds non-loopback because this returned
 * true is opened on the operator's word, not on an enforced gate.
 *
 * That is a real gap, and it is the reason the WS listener in the Rust daemon refuses a
 * non-loopback bind outright regardless of policy: a guard must not approve what it does not
 * gate. The TS surfaces are one step behind that standard on purpose — they are opt-in,
 * loopback-by-default, and the operator must both set a policy AND pass an explicit host — but
 * the honest next step is for these surfaces to actually verify the bearer token against the
 * policy file before serving a request, not merely to observe that the file exists.
 *
 * Deliberately NOT cached: a long-lived process may have the policy provisioned after boot, and a
 * cached `false` would then be a stale reason to keep refusing.
 */
export function authPolicyPresent(env: NodeJS.ProcessEnv = process.env): boolean {
	const path = env[AUTH_POLICY_ENV]?.trim();
	if (!path) return false;
	return existsSync(path);
}
