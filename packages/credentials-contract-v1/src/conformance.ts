import {
	CREDENTIALS_CAPABILITY,
	type CredentialsConformanceResult,
	type CredentialsProvider,
	type VerifiableCredential,
} from "./types.js";

function baseCredential(overrides: Partial<VerifiableCredential> = {}): VerifiableCredential {
  return {
    "@context": [
      "https://www.w3.org/2018/credentials/v1",
      "https://refarm.dev/contexts/credentials/v1",
    ],
    type: ["VerifiableCredential", "RefarmConformanceCredential"],
    issuer: "pending",
    issuanceDate: new Date().toISOString(),
    credentialSubject: {
      id: "did:refarm:subject:conformance",
      capability: "credentials:v1",
    },
    evidence: {
      preserved: true,
    },
    ...overrides,
  };
}

export async function runCredentialsV1Conformance(
  provider: CredentialsProvider,
  identities: { issuerIdentityId: string; holderIdentityId: string },
): Promise<CredentialsConformanceResult> {
  const failures: string[] = [];

  if (provider.capability !== CREDENTIALS_CAPABILITY) {
    failures.push("provider.capability must be 'credentials:v1'");
  }
  if (!provider.pluginId || provider.pluginId.trim().length === 0) {
    failures.push("provider.pluginId must be a non-empty string");
  }

  let issued: VerifiableCredential | null = null;

  try {
    issued = await provider.issue(baseCredential(), identities.issuerIdentityId);
    if (!issued.proof?.signature) failures.push("issue() must attach proof.signature");
    const verified = await provider.verify(issued);
    if (!verified.valid) failures.push(`verify(issue()) failed: ${verified.failures.join("; ")}`);
  } catch (error) {
    failures.push(`issue()/verify() threw: ${String(error)}`);
  }

  if (issued) {
    try {
      const tampered: VerifiableCredential = {
        ...issued,
        credentialSubject: {
          ...issued.credentialSubject,
          capability: "tampered",
        },
      };
      const result = await provider.verify(tampered);
      if (result.valid) failures.push("verify() must reject tampered credentials");
    } catch (error) {
      failures.push(`tamper verify threw: ${String(error)}`);
    }

    try {
      const expired = await provider.issue(
        baseCredential({ expirationDate: "2000-01-01T00:00:00.000Z" }),
        identities.issuerIdentityId,
      );
      const result = await provider.verify(expired);
      if (result.valid) failures.push("verify() must reject expired credentials");
    } catch (error) {
      failures.push(`expired verify threw: ${String(error)}`);
    }

    try {
      const presentation = await provider.present([issued], identities.holderIdentityId);
      const result = await provider.verify(presentation);
      if (!result.valid) {
        failures.push(`verify(presentation) failed: ${result.failures.join("; ")}`);
      }
    } catch (error) {
      failures.push(`present()/verify() threw: ${String(error)}`);
    }

    try {
      const stored = await provider.store(issued);
      const listed = await provider.list({ issuer: issued.issuer });
      const roundTrip = listed.find((credential) => credential.id === stored.id);
      if (!roundTrip) {
        failures.push("list() must include stored credential");
      } else if ((roundTrip.evidence as { preserved?: boolean } | undefined)?.preserved !== true) {
        failures.push("wallet round-trip must preserve unknown fields");
      }
      const removed = await provider.remove(stored.id);
      if (!removed.removed) failures.push("remove() must report removed=true for stored credential");
      const afterRemove = await provider.list({ issuer: issued.issuer });
      if (afterRemove.some((credential) => credential.id === stored.id)) {
        failures.push("remove() must remove stored credential from list()");
      }
    } catch (error) {
      failures.push(`wallet round-trip threw: ${String(error)}`);
    }
  }

  const failed = failures.length;
  return {
    pass: failed === 0,
    total: 8,
    failed,
    failures,
  };
}
