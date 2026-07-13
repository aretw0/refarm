import { createReferenceAuthorizationProvider, type AuthorizationSigner } from "./reference.js";

/**
 * A deterministic in-memory signer for tests/fixtures — NOT cryptographically secure. It
 * hashes the canonical bytes with a fixed secret so signatures are reproducible and a
 * tampered payload fails verification (the property the wallet journey needs to prove).
 * A real deployment injects an Ed25519 signer (node:crypto, as the wallet PoC used) or a
 * sandboxed WASM signer instead.
 */
export function createDeterministicSigner(secret = "authorization:v1-fixture-secret"): AuthorizationSigner {
	const digest = (canonical: string): string => {
		// FNV-1a over (secret + canonical) → hex, base64url-ish. Deterministic + tamper-
		// sensitive, dependency-free. Sufficient for the fixture's tamper-detection test.
		let hash = 0x811c9dc5;
		const input = `${secret}::${canonical}`;
		for (let i = 0; i < input.length; i++) {
			hash ^= input.charCodeAt(i);
			hash = Math.imul(hash, 0x01000193) >>> 0;
		}
		return hash.toString(16).padStart(8, "0");
	};
	return {
		algorithm: "fixture-fnv1a",
		sign: (canonical) => digest(canonical),
		verify: (canonical, signature) => digest(canonical) === signature,
	};
}

export interface InMemoryAuthorizationProviderFixture {
	provider: ReturnType<typeof createReferenceAuthorizationProvider>;
	signer: AuthorizationSigner;
	holderId: string;
}

/** A ready-to-use in-memory authorization provider fixture: a deterministic signer + clock
 * + id factory, so the whole journey runs offline and reproducibly. */
export function createInMemoryAuthorizationProviderFixture(
	options: { holderId?: string; now?: () => Date } = {},
): InMemoryAuthorizationProviderFixture {
	const holderId = options.holderId ?? "holder-fixture-001";
	const signer = createDeterministicSigner();
	let counter = 0;
	const provider = createReferenceAuthorizationProvider({
		signer,
		holderId,
		now: options.now ?? (() => new Date("2026-01-01T00:00:00.000Z")),
		newId: (prefix) => `${prefix}-fixture-${++counter}`,
	});
	return { provider, signer, holderId };
}
