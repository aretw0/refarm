export const ASSET_RESOLVER_CAPABILITY = "asset-resolver:v1" as const;

/**
 * A content-addressed reference to an asset: its SHA-256 identity. The bytes are
 * addressed BY their hash, so the same content resolves to the same ref whether
 * it lives on the local filesystem, in OPFS, or on a p2p network — the identity
 * is the content, not a path or a URL. `alg` is fixed to sha-256 for v1; it is
 * carried explicitly so a future algorithm is an additive ref, not a breaking
 * one.
 */
export interface AssetRef {
	/** Lowercase hex SHA-256 of the asset bytes — the content-addressed identity. */
	hash: string;
	/** Hash algorithm. Fixed to "sha-256" in v1. */
	alg?: "sha-256";
}

/** The outcome of resolving a ref: the verified bytes, or a structured miss. */
export type AssetResolution =
	| { ok: true; bytes: Uint8Array }
	| { ok: false; reason: AssetResolutionMiss };

/**
 * Why a resolution did not yield trusted bytes.
 * - `not-found`: no backend had the content.
 * - `hash-mismatch`: a backend returned bytes whose hash did NOT match the ref.
 *   This is the security-critical case — untrusted/p2p bytes that fail the check
 *   are REJECTED, never returned. A resolver must never hand back unverified bytes.
 */
export type AssetResolutionMiss = "not-found" | "hash-mismatch";

/**
 * The one contract for resolving a content-addressed asset. Surface-neutral by
 * design — a backend (filesystem today; OPFS or a p2p/peerd network later)
 * implements `resolve` and is otherwise interchangeable, exactly like a
 * StorageProvider. The contract's INVARIANT: a resolver NEVER returns bytes whose
 * hash does not match the ref. Verification happens inside the resolver, before
 * bytes cross the boundary — so a caller that gets `{ok:true, bytes}` can trust
 * them without re-hashing, and streaming an asset from an untrusted peer is safe
 * because the hash gate rejects tampered bytes.
 */
export interface AssetResolver {
	readonly capability: typeof ASSET_RESOLVER_CAPABILITY;
	/** Resolve a content-addressed ref to verified bytes, or a structured miss. */
	resolve(ref: AssetRef): Promise<AssetResolution>;
}

/**
 * Verify that `bytes` hash to `ref.hash` under `ref.alg` (sha-256). Pure and
 * dependency-injected: the caller supplies the digest fn (`node:crypto` on the
 * server, `crypto.subtle` in the browser) so this stays runtime-agnostic. This is
 * the gate every backend runs before returning bytes — the reason untrusted/p2p
 * content can be resolved safely.
 */
export async function verifyContentHash(
	bytes: Uint8Array,
	ref: AssetRef,
	digest: (bytes: Uint8Array) => Promise<string> | string,
): Promise<boolean> {
	if (ref.alg !== undefined && ref.alg !== "sha-256") return false;
	const actual = await digest(bytes);
	return timingSafeHexEqual(actual, ref.hash);
}

/** Lowercase-hex SHA-256 shape guard (64 hex chars). */
export function isSha256Hex(value: unknown): value is string {
	return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}

/**
 * Constant-time comparison of two lowercase hex strings. A hash check should not
 * leak, via timing, how many leading characters matched — cheap insurance since
 * these are attacker-influenced (a p2p peer chooses the bytes).
 */
function timingSafeHexEqual(a: string, b: string): boolean {
	if (a.length !== b.length) return false;
	let mismatch = 0;
	for (let i = 0; i < a.length; i += 1) {
		mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
	}
	return mismatch === 0;
}

export {
	runAssetResolverV1Conformance,
	type AssetResolverConformanceHarness,
	type AssetResolverConformanceResult,
} from "./conformance.js";
