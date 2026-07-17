import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { runIdentityV1Conformance } from "@refarm.dev/identity-contract-v1";
import { describe, expect, it } from "vitest";

import {
	createReferenceSigner,
	createReferenceWasmIdentityProvider,
	createWasmIdentityProvider,
} from "./index.js";

// This suite drives the REAL transpiled sovereign identity component, so it needs
// `pnpm build:component` (cargo component build + jco transpile) to have produced
// `pkg/`. Gitignored + rebuilt, so — like vault-surface-ref/quality-checker-ref —
// this SKIPS when the pkg is absent instead of failing the repo-wide test run. The
// factories in ./index.js import `pkg/` lazily, so importing this module is safe;
// only entering these bodies would touch the WASM.
const pkgEntry = fileURLToPath(new URL("../pkg/identity_provider.js", import.meta.url));
const componentBuilt = existsSync(pkgEntry);

describe.skipIf(!componentBuilt)("sovereign identity WASM plugin — the key never leaves the sandbox", () => {
	it("passes the identity:v1 conformance suite (parity with the reference provider)", async () => {
		const provider = await createReferenceWasmIdentityProvider();
		const result = await runIdentityV1Conformance(provider);
		expect(result.failures).toEqual([]);
		expect(result.pass).toBe(true);
	});

	it("SOVEREIGN: the signer surface exposes no key material — sign takes only a payload", async () => {
		const signer = await createReferenceSigner();
		// The only functions on the surface: sign(payload), verify(...), publicKey(),
		// deriveFromSession(sessionKey). None returns a private key; sign takes NO key.
		const surface = Object.keys(signer).sort();
		expect(surface).toEqual(["deriveFromSession", "publicKey", "sign", "verify"]);
		// sign's arity is 1 (payload only) — there is no key parameter to pass in.
		expect(signer.sign.length).toBe(1);
	});

	it("SANDBOX: instantiating with the deny-all table still signs (no capability needed)", async () => {
		// createReferenceSigner() wires the deny-all WASI table; a successful sign
		// proves the signer is pure compute — it never reaches for fs/io/net.
		const signer = await createReferenceSigner();
		signer.deriveFromSession(new TextEncoder().encode("session-A"));
		const payload = new TextEncoder().encode("consent");
		const sig = signer.sign(payload);
		expect(sig.length).toBe(64); // ed25519 signature
		const ok = signer.verify(payload, sig, signer.publicKey());
		expect(ok).toBe(true);
	});

	it("a signature does not verify under a foreign public key", async () => {
		const signer = await createReferenceSigner();
		signer.deriveFromSession(new TextEncoder().encode("alice"));
		const payload = new TextEncoder().encode("transfer");
		const sig = signer.sign(payload);
		const alicePub = signer.publicKey();

		signer.deriveFromSession(new TextEncoder().encode("bob"));
		const bobPub = signer.publicKey();
		expect(bytesEqual(alicePub, bobPub)).toBe(false);

		expect(signer.verify(payload, sig, bobPub)).toBe(false);
	});

	it("the provider re-unlocks the key per sign — TS only ever holds the session key", async () => {
		const signer = await createReferenceSigner();
		const provider = createWasmIdentityProvider(signer);
		const alice = await provider.create("Alice");
		const bob = await provider.create("Bob");
		expect(alice.publicKey).not.toBe(bob.publicKey);

		// Sign as Alice, then as Bob — the adapter re-derives each key inside the
		// sandbox before signing; both verify against their own identity.
		const sigA = await provider.sign(alice.id, "hello");
		const sigB = await provider.sign(bob.id, "hello");
		expect((await provider.verify(sigA.signature, "hello")).valid).toBe(true);
		expect((await provider.verify(sigB.signature, "hello")).valid).toBe(true);

		// A tampered payload does not verify.
		expect((await provider.verify(sigA.signature, "tampered")).valid).toBe(false);
	});

	it("deriveFromSession returns an opaque handle + identity (contract hook)", async () => {
		const provider = await createReferenceWasmIdentityProvider();
		if (!provider.deriveFromSession) throw new Error("expected deriveFromSession");
		const handle = await provider.deriveFromSession({
			protocol: "opaque",
			session: new TextEncoder().encode("opaque-session-key"),
			displayName: "Citizen",
		});
		expect(handle.identity.publicKey).toMatch(/^[0-9a-f]{64}$/);
		expect(handle.handle.length).toBeGreaterThan(0);
		// The same session unlocks the same identity — deterministic.
		const again = await provider.deriveFromSession({
			protocol: "opaque",
			session: new TextEncoder().encode("opaque-session-key"),
		});
		expect(again.identity.publicKey).toBe(handle.identity.publicKey);
	});
});

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
	if (a.length !== b.length) return false;
	for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
	return true;
}
