import { describe, expect, it } from "vitest";

import { createInMemoryIdentityProvider } from "./in-memory.js";

describe("in-memory identity provider — deriveFromSession (recovery primitive)", () => {
	it("the SAME session deterministically unlocks the SAME identity (recovery)", async () => {
		const provider = createInMemoryIdentityProvider();
		if (!provider.deriveFromSession) throw new Error("expected deriveFromSession");
		const session = new TextEncoder().encode("citizen-opaque-session");

		const first = await provider.deriveFromSession({ protocol: "opaque", session, displayName: "Cidadão" });
		// A different provider instance (a NEW device) with the same session recovers the same id.
		const onNewDevice = createInMemoryIdentityProvider();
		const recovered = await onNewDevice.deriveFromSession!({ protocol: "opaque", session });

		expect(recovered.identity.id).toBe(first.identity.id);
		expect(recovered.identity.publicKey).toBe(first.identity.publicKey);
		expect(recovered.handle.length).toBeGreaterThan(0);
	});

	it("a DIFFERENT session yields a different identity", async () => {
		const provider = createInMemoryIdentityProvider();
		const a = await provider.deriveFromSession!({ protocol: "opaque", session: new TextEncoder().encode("alice") });
		const b = await provider.deriveFromSession!({ protocol: "opaque", session: new TextEncoder().encode("bob") });
		expect(a.identity.id).not.toBe(b.identity.id);
	});

	it("a recovered identity can sign and be fetched — recovery restores signing capability", async () => {
		const provider = createInMemoryIdentityProvider();
		const session = new TextEncoder().encode("recover-me");
		const handle = await provider.deriveFromSession!({ protocol: "opaque", session });

		// get() resolves it (it was registered on derive) …
		expect(await provider.get(handle.identity.id)).not.toBeNull();
		// … and it can sign, and the signature verifies against the recovered identity.
		const sig = await provider.sign(handle.identity.id, "hello");
		const result = await provider.verify(sig.signature, "hello");
		expect(result.valid).toBe(true);
		expect(result.identity.id).toBe(handle.identity.id);
	});
});
