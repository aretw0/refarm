import {
	IDENTITY_CAPABILITY,
	type Identity,
	type IdentityProvider,
	runIdentityV1Conformance,
	type SignatureResult,
	type VerificationResult,
} from "@refarm.dev/identity-contract-v1";
import { describe, expect, it } from "vitest";

import { NostrIdentityManager } from "./index.js";

class NostrIdentityConformanceProvider implements IdentityProvider {
	readonly pluginId = "@refarm.me/identity-nostr-conformance";
	readonly capability = IDENTITY_CAPABILITY;

	private readonly manager = new NostrIdentityManager();
	private readonly identities = new Map<string, Identity>();
	private readonly signatures = new Map<
		string,
		{ identityId: string; data: string }
	>();
	private counter = 0;

	async create(displayName?: string): Promise<Identity> {
		const keypair = this.manager.generateKeypair();
		const id = `nostr-identity-${++this.counter}`;

		const identity: Identity = {
			id,
			publicKey: `${keypair.publicKey.slice(0, 16)}-${id}`,
			displayName,
			createdAt: new Date().toISOString(),
		};

		this.identities.set(id, identity);
		return identity;
	}

	async sign(identityId: string, data: string): Promise<SignatureResult> {
		if (!this.identities.has(identityId)) {
			throw new Error(`identity not found: ${identityId}`);
		}

		const signature = await sha256Hex(`${identityId}:${data}`);
		this.signatures.set(signature, { identityId, data });

		return {
			signature,
			algorithm: "sha256(identityId:data)",
		};
	}

	async verify(signature: string, data: string): Promise<VerificationResult> {
		const entry = this.signatures.get(signature);
		if (!entry) {
			throw new Error("signature not found");
		}

		const identity = this.identities.get(entry.identityId);
		if (!identity) {
			throw new Error("identity missing for signature");
		}

		const expected = await sha256Hex(`${entry.identityId}:${data}`);
		return {
			valid: signature === expected && entry.data === data,
			identity,
		};
	}

	async get(identityId: string): Promise<Identity | null> {
		return this.identities.get(identityId) ?? null;
	}
}

async function sha256Hex(input: string): Promise<string> {
	const bytes = new TextEncoder().encode(input);
	const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
	return Array.from(new Uint8Array(digest))
		.map((value) => value.toString(16).padStart(2, "0"))
		.join("");
}

describe("@refarm.me/identity-nostr identity:v1 conformance", () => {
	it("passes identity:v1 contract checks", async () => {
		const provider = new NostrIdentityConformanceProvider();
		const result = await runIdentityV1Conformance(provider);

		expect(result.pass).toBe(true);
		expect(result.failed).toBe(0);
	});

	it("marks signature as invalid when payload changes", async () => {
		const provider = new NostrIdentityConformanceProvider();
		const identity = await provider.create("Nostr Test");
		const signed = await provider.sign(identity.id, "payload-v1");
		const verification = await provider.verify(signed.signature, "payload-v2");

		expect(verification.valid).toBe(false);
		expect(verification.identity.id).toBe(identity.id);
	});
});
