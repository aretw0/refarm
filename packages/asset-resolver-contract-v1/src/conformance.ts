import {
	verifyContentHash,
	type AssetRef,
	type AssetResolver,
	type AssetResolutionMiss,
} from "./index.js";

/**
 * The asset-resolver:v1 CONFORMANCE suite — prove ANY backend (filesystem today, OPFS or a
 * p2p/peerd network later) honors the contract's security-critical invariant: a resolver NEVER
 * returns bytes whose hash does not match the ref. Backends are interchangeable, so without a
 * shared conformance test a new backend (a peer fetcher, an OPFS store) could silently return
 * unverified bytes. This is that shared test.
 *
 * The suite is runtime-agnostic: the caller injects a `digest` (node:crypto or crypto.subtle) and
 * a `harness` that can (a) build a resolver over a known set of stored bytes and (b) build a
 * resolver whose backend is TAMPERED (returns wrong bytes for a ref) so the hash gate can be
 * exercised. A backend that can't tamper (a pure store) may omit `makeTamperedResolver` — those
 * checks are then skipped and reported.
 */

export interface AssetResolverConformanceHarness {
	/** Build a resolver that HAS the given contents (keyed by their true hash). The suite stores
	 * one blob, then resolves its ref and expects the bytes back. */
	makeResolver(contents: ReadonlyArray<{ hash: string; bytes: Uint8Array }>): Promise<AssetResolver> | AssetResolver;
	/** Build a resolver whose backend returns `wrongBytes` for `ref` (a tampered/malicious peer),
	 * so the hash gate must reject it. Optional — omit for a backend that can't misbehave. */
	makeTamperedResolver?: (
		ref: AssetRef,
		wrongBytes: Uint8Array,
	) => Promise<AssetResolver> | AssetResolver;
}

export interface AssetResolverConformanceResult {
	pass: boolean;
	total: number;
	failed: number;
	failures: string[];
	skipped: string[];
}

/**
 * Run the asset-resolver:v1 conformance checks against a backend. Asserts:
 *  1. resolve(known ref) → {ok:true, bytes} and the bytes verify against the ref.
 *  2. resolve(absent ref) → {ok:false, reason:"not-found"}.
 *  3. resolve(tampered backend) → {ok:false, reason:"hash-mismatch"} — bytes NEVER returned.
 *  4. an invalid ref alg is not silently accepted.
 * Returns a pass/fail report; never throws (a backend bug is a failure line).
 */
export async function runAssetResolverV1Conformance(
	harness: AssetResolverConformanceHarness,
	digest: (bytes: Uint8Array) => Promise<string> | string,
): Promise<AssetResolverConformanceResult> {
	const failures: string[] = [];
	const skipped: string[] = [];
	const check = (condition: boolean, label: string): void => {
		if (!condition) failures.push(label);
	};

	// Deterministic known content (no Math.random): a fixed byte blob + its true hash.
	const bytes = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
	const hash = await digest(bytes);
	const ref: AssetRef = { hash };

	// 1. A present ref resolves to verified bytes.
	try {
		const resolver = await harness.makeResolver([{ hash, bytes }]);
		check(resolver.capability === "asset-resolver:v1", "resolver.capability must be asset-resolver:v1");
		const result = await resolver.resolve(ref);
		if (!result.ok) {
			failures.push(`resolve(known) returned a miss (${result.reason}); expected the bytes`);
		} else {
			check(await verifyContentHash(result.bytes, ref, digest), "resolve(known) returned bytes that do NOT verify against the ref");
		}
	} catch (e) {
		failures.push(`resolve(known) threw: ${String(e)}`);
	}

	// 2. An absent ref is a structured not-found (not a throw, not empty bytes).
	try {
		const resolver = await harness.makeResolver([]);
		const missHash = "0".repeat(64);
		const result = await resolver.resolve({ hash: missHash });
		check(result.ok === false, "resolve(absent) should be a miss");
		if (result.ok === false) {
			const reason: AssetResolutionMiss = result.reason;
			check(reason === "not-found", `resolve(absent).reason is "${reason}", expected "not-found"`);
		}
	} catch (e) {
		failures.push(`resolve(absent) threw: ${String(e)}`);
	}

	// 3. THE security invariant: tampered bytes are rejected as hash-mismatch, never returned.
	if (harness.makeTamperedResolver) {
		try {
			const wrongBytes = new Uint8Array([9, 9, 9, 9]);
			const resolver = await harness.makeTamperedResolver(ref, wrongBytes);
			const result = await resolver.resolve(ref);
			if (result.ok) {
				failures.push("SECURITY: resolve() returned tampered bytes — the hash gate did not reject them");
			} else {
				check(result.reason === "hash-mismatch", `tampered resolve reason is "${result.reason}", expected "hash-mismatch"`);
			}
		} catch (e) {
			failures.push(`tampered resolve threw: ${String(e)}`);
		}
	} else {
		skipped.push("hash-mismatch (no makeTamperedResolver — backend cannot misbehave)");
	}

	// 4. A ref with an unsupported alg must not verify (defense against a downgraded ref).
	check(
		(await verifyContentHash(bytes, { hash, alg: "sha-256" }, digest)) === true,
		"verifyContentHash rejected a valid sha-256 ref",
	);
	check(
		(await verifyContentHash(bytes, { hash, alg: "sha-512" as never }, digest)) === false,
		"verifyContentHash accepted an unsupported alg — a downgraded ref must not verify",
	);

	return { pass: failures.length === 0, total: 4, failed: failures.length, failures, skipped };
}
