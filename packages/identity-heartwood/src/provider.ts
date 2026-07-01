import * as heartwood from "@refarm.dev/heartwood";
import {
	IDENTITY_CAPABILITY,
	type Identity,
	type IdentityProvider,
	type SignatureResult,
	type VerificationResult,
} from "@refarm.dev/identity-contract-v1";

export const HEARTWOOD_IDENTITY_ALGORITHM = "ed25519-heartwood-v1" as const;

interface StoredIdentity {
  identity: Identity;
  secretKeyHex: string;
}

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0 || /[^a-fA-F0-9]/.test(hex)) {
    throw new Error("invalid hex");
  }
  const bytes = new Uint8Array(hex.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

function encodePayload(data: string): Uint8Array {
  return new TextEncoder().encode(data);
}

function encodeSignature(identityId: string, signatureHex: string): string {
  return `${HEARTWOOD_IDENTITY_ALGORITHM}:${encodeURIComponent(identityId)}:${signatureHex}`;
}

function decodeSignature(envelope: string): { identityId: string; signatureHex: string } | null {
  const [algorithm, encodedIdentityId, signatureHex, ...extra] = envelope.split(":");
  if (
    algorithm !== HEARTWOOD_IDENTITY_ALGORITHM ||
    !encodedIdentityId ||
    !signatureHex ||
    extra.length > 0
  ) {
    return null;
  }
  return {
    identityId: decodeURIComponent(encodedIdentityId),
    signatureHex,
  };
}

export class HeartwoodIdentityProvider implements IdentityProvider {
  readonly pluginId = "@refarm.dev/identity-heartwood";
  readonly capability = IDENTITY_CAPABILITY;

  private readonly identities = new Map<string, StoredIdentity>();

  async create(displayName?: string): Promise<Identity> {
    const keypair = heartwood.generateKeypair();
    const publicKey = bytesToHex(keypair.publicKey);
    const identity: Identity = {
      id: `did:refarm:heartwood:${publicKey}`,
      publicKey,
      displayName,
      createdAt: new Date().toISOString(),
    };

    this.identities.set(identity.id, {
      identity,
      secretKeyHex: bytesToHex(keypair.secretKey),
    });

    return identity;
  }

  async sign(identityId: string, data: string): Promise<SignatureResult> {
    const stored = this.identities.get(identityId);
    if (!stored) {
      throw new Error(`identity not found: ${identityId}`);
    }

    const signature = heartwood.sign(encodePayload(data), hexToBytes(stored.secretKeyHex));
    return {
      signature: encodeSignature(identityId, bytesToHex(signature)),
      algorithm: HEARTWOOD_IDENTITY_ALGORITHM,
    };
  }

  async verify(signature: string, data: string): Promise<VerificationResult> {
    const decoded = decodeSignature(signature);
    if (!decoded) {
      throw new Error("unsupported heartwood identity signature");
    }

    const stored = this.identities.get(decoded.identityId);
    if (!stored) {
      throw new Error(`identity not found for signature: ${decoded.identityId}`);
    }

    const valid = heartwood.verify(
      encodePayload(data),
      hexToBytes(decoded.signatureHex),
      hexToBytes(stored.identity.publicKey),
    );

    return {
      valid,
      identity: stored.identity,
    };
  }

  async get(identityId: string): Promise<Identity | null> {
    return this.identities.get(identityId)?.identity ?? null;
  }
}

export function createHeartwoodIdentityProvider(): IdentityProvider {
  return new HeartwoodIdentityProvider();
}
