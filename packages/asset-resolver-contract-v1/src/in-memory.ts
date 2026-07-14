import {
	ASSET_RESOLVER_CAPABILITY,
	verifyContentHash,
	type AssetRef,
	type AssetResolution,
	type AssetResolver,
} from "./index.js";
import {
	runAssetResolverV1Conformance,
	type AssetResolverConformanceHarness,
	type AssetResolverConformanceResult,
} from "./conformance.js";

/**
 * The reference backend for asset-resolver:v1 — a content-addressed store held in a
 * `Map<hash, bytes>`. It is the minimal implementation that proves the contract is
 * satisfiable with ZERO runtime dependencies (no filesystem, no network): store by
 * digest, resolve by hash, verify before returning. The fs and p2p backends in
 * `./node.ts` are the same contract with a durable/remote backend instead of a Map;
 * this is the worked example a new backend author reads to see the intended shape.
 *
 * Because the store is keyed by the bytes' true hash, it also demonstrates the
 * dedup-for-free property (identical bytes land at the same key) and gives the
 * conformance suite a pure, deterministic backend to run against.
 */

/** The runtime-agnostic digest for the in-memory backend: lowercase-hex SHA-256 via
 * Web Crypto (available in both the vitest/node env and the browser). This is the
 * `digest` port the conformance suite injects — the same fn the store keys bytes by. */
export async function webCryptoSha256Hex(bytes: Uint8Array): Promise<string> {
	// `crypto.subtle.digest` needs an ArrayBuffer view; a fresh copy avoids handing it
	// a Uint8Array whose backing buffer is larger than its view (SharedArrayBuffer etc.).
	const copy = new Uint8Array(bytes);
	const digest = await crypto.subtle.digest("SHA-256", copy);
	return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * The write side of the in-memory content-store, paired with a read resolver. `store`
 * hashes bytes and holds them under that hash; the paired `resolver` verifies before
 * returning — the round-trip that lets a caller carry a pointer (`hash`) instead of
 * the bytes and get verified bytes back.
 */
export interface InMemoryAssetStore {
	/** Read side (verify-before-trust) over the same `Map<hash, bytes>`. */
	resolver: AssetResolver;
	/** Store bytes under their content-address (the digest) and return that hash. A
	 * re-store of identical bytes is idempotent — same hash, same slot. */
	store(content: Uint8Array): Promise<string>;
	/** The hashes currently held. */
	hashes(): string[];
}

/**
 * A content-addressed asset resolver backed by an in-memory `Map<hash, bytes>`. The
 * verify-before-trust gate runs HERE (like every backend): a slot whose bytes do not
 * hash to the requested ref is REJECTED (`hash-mismatch`), never returned — so even a
 * tampered map entry cannot hand back unverified bytes. `digest` defaults to
 * `webCryptoSha256Hex`; inject a matching one if you keyed the map with another.
 */
export function createInMemoryAssetResolver(
	byHash: ReadonlyMap<string, Uint8Array>,
	digest: (bytes: Uint8Array) => Promise<string> | string = webCryptoSha256Hex,
): AssetResolver {
	return {
		capability: ASSET_RESOLVER_CAPABILITY,
		async resolve(ref: AssetRef): Promise<AssetResolution> {
			const bytes = byHash.get(ref.hash);
			if (bytes === undefined) return { ok: false, reason: "not-found" };
			const verified = await verifyContentHash(bytes, ref, digest);
			if (!verified) return { ok: false, reason: "hash-mismatch" };
			return { ok: true, bytes };
		},
	};
}

/**
 * Open an in-memory content-store for both reading and writing. The write side moves
 * bytes into the store under their digest; the read side resolves them back with the
 * hash gate. Read and write share the one Map, so a stored asset resolves under the
 * same hash — the content-addressed round-trip with no durable backend.
 */
export function createInMemoryAssetStore(
	digest: (bytes: Uint8Array) => Promise<string> | string = webCryptoSha256Hex,
): InMemoryAssetStore {
	const byHash = new Map<string, Uint8Array>();
	return {
		resolver: createInMemoryAssetResolver(byHash, digest),
		async store(content: Uint8Array): Promise<string> {
			const hash = await digest(content);
			byHash.set(hash, content);
			return hash;
		},
		hashes() {
			return [...byHash.keys()];
		},
	};
}

/**
 * The reference conformance harness for asset-resolver:v1, backed by the in-memory
 * store. `makeResolver` builds a resolver holding exactly the given (already-hashed)
 * contents; `makeTamperedResolver` builds a resolver whose sole slot returns WRONG
 * bytes for the ref (a corrupt store / a lying peer), so the hash gate is exercised.
 * Pass the SAME `digest` here that you pass to `runAssetResolverV1Conformance`.
 */
export function createInMemoryAssetResolverConformanceHarness(
	digest: (bytes: Uint8Array) => Promise<string> | string = webCryptoSha256Hex,
): AssetResolverConformanceHarness {
	return {
		makeResolver(contents) {
			const byHash = new Map(contents.map((c) => [c.hash, c.bytes]));
			return createInMemoryAssetResolver(byHash, digest);
		},
		makeTamperedResolver(ref, wrongBytes) {
			// The store holds wrongBytes at the ref's hash — the gate must reject them.
			const byHash = new Map<string, Uint8Array>([[ref.hash, wrongBytes]]);
			return createInMemoryAssetResolver(byHash, digest);
		},
	};
}

/**
 * Convenience: run the full asset-resolver:v1 conformance suite against the in-memory
 * reference backend with the Web Crypto digest. A green result here is the proof that
 * the reference implementation satisfies the contract end to end.
 */
export function runInMemoryAssetResolverConformance(): Promise<AssetResolverConformanceResult> {
	return runAssetResolverV1Conformance(
		createInMemoryAssetResolverConformanceHarness(webCryptoSha256Hex),
		webCryptoSha256Hex,
	);
}
